#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SKILL_PACK_LOCK_SCHEMA,
  buildPackLockEntry,
  hashDirectory,
  hashSkillSet,
} from "./skill-pack-integrity.mjs";
import {
  buildAiBerkshireBundles as buildBundles,
  inspectAiBerkshireSource as inspectSource,
  validateAiBerkshireBundles as validateBuiltBundles,
} from "./ai-berkshire-skill-pack-adapter.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const PACK_NAME = "ai-berkshire-investment-suite";
const INITIAL_PACK_VERSION = "1.0.0";
const UPSTREAM = "https://github.com/xbtlin/ai-berkshire";
const SYNC_HELPER = "eng/capabilities/ai-berkshire-skill-pack-sync.mjs";

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}
if (options.apply && !options.yes) failUsage("--apply requires --yes");

const sourceDir = path.resolve(
  options.source || process.env.AI_BERKSHIRE_REPO || path.join(REPO_ROOT, "..", "ai-berkshire"),
);
const destRoot = path.resolve(options.destRoot || path.join(REPO_ROOT, "packages/pi-workspace-resources/skills"));
const registryPath = path.resolve(options.packRegistry || path.join(REPO_ROOT, "shared-skill-packs.json"));
const lockPath = path.resolve(options.packLock || path.join(REPO_ROOT, "shared-skill-packs.lock.json"));

const report = {
  schemaVersion: 1,
  schemaId: "desktop-ai-berkshire-skill-pack-sync/v1",
  generatedAt: new Date().toISOString(),
  mode: options.apply ? "apply" : "dry-run",
  source: displayPath(sourceDir),
  destinationRoot: displayPath(destRoot),
  packRegistry: displayPath(registryPath),
  packLock: displayPath(lockPath),
  packName: PACK_NAME,
  packVersion: null,
  sourceExists: fs.existsSync(sourceDir),
  registryChanged: false,
  lockChanged: false,
  reviewLevel: "none",
  skillSetChange: { added: [], removed: [] },
  provenance: { sourceCommit: "", sourceManifestSha256: "", bundleSha256: "" },
  counts: { skills: 0, identical: 0, create: 0, replace: 0, remove: 0, applied: 0 },
  skills: [],
  result: "INVALID_INPUT",
};

let tempRoot;
try {
  const source = inspectSource(sourceDir);
  report.provenance.sourceCommit = source.commit;
  report.counts.skills = source.skills.length;
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi67-desktop-ai-berkshire-pack-"));
  const buildRoot = path.join(tempRoot, "bundles");
  const sourceManifestFile = path.join(tempRoot, "source-manifest.json");
  buildBundles(source, buildRoot, sourceManifestFile);
  validateBuiltBundles(buildRoot, source.skills);

  const registry = readRegistry(registryPath);
  const lock = readLock(lockPath);
  const previousPack = registry.packs.find((entry) => entry.name === PACK_NAME) || null;
  const previousLock = lock.packs.find((entry) => entry.name === PACK_NAME) || null;
  const skillNames = source.skills.map((skill) => skill.name);
  const skillHashes = skillNames.map((name) => ({
    name,
    sha256: hashDirectory(path.join(buildRoot, name)),
  }));
  const bundleSha256 = hashSkillSet(skillHashes);
  const versionDecision = choosePackVersion(
    previousPack,
    previousLock,
    source.commit,
    skillNames,
    bundleSha256,
    options.packVersion,
  );
  report.packVersion = versionDecision.version;
  report.reviewLevel = versionDecision.reviewLevel;
  report.skillSetChange = versionDecision.skillSetChange;

  for (const name of skillNames) {
    const sourcePath = path.join(buildRoot, name);
    const destination = path.join(destRoot, name);
    const sourceHash = hashDirectory(sourcePath);
    const destinationExists = fs.existsSync(path.join(destination, "SKILL.md"));
    const destinationHash = destinationExists ? hashDirectory(destination) : "missing";
    const status = !destinationExists ? "create" : sourceHash === destinationHash ? "identical" : "replace";
    report.counts[status] += 1;
    report.skills.push({
      name,
      status,
      source: `${displayPath(sourceDir)}/codex-skills/${name}`,
      destination: displayPath(destination),
      sourceHash,
      destinationHash,
    });
  }
  for (const name of versionDecision.skillSetChange.removed) {
    const destination = path.join(destRoot, name);
    if (!fs.existsSync(destination)) continue;
    const destinationHash = hashDirectory(destination);
    const previousHash = previousLock?.skills?.find((skill) => skill?.name === name)?.sha256 || "";
    if (!previousHash || destinationHash !== previousHash) {
      throw new Error(`refusing to remove a vendored Skill that differs from the previous lock: ${name}`);
    }
    report.counts.remove += 1;
    report.skills.push({
      name,
      status: "remove",
      source: null,
      destination: displayPath(destination),
      sourceHash: null,
      destinationHash,
    });
  }

  const registryUpdate = buildRegistryUpdate(registry, registryPath, versionDecision.version, skillNames);
  const lockUpdate = buildLockUpdate(
    lock,
    lockPath,
    versionDecision.version,
    source.commit,
    sourceManifestFile,
    skillNames,
    buildRoot,
  );
  report.registryChanged = registryUpdate.changed;
  report.lockChanged = lockUpdate.changed;
  report.provenance.sourceManifestSha256 = lockUpdate.entry.manifest_sha256;
  report.provenance.bundleSha256 = lockUpdate.entry.bundle_sha256;

  const hasChanges = report.counts.create > 0 || report.counts.replace > 0 || report.counts.remove > 0
    || report.registryChanged || report.lockChanged;
  report.result = hasChanges ? (options.apply ? "APPLIED" : "READY_TO_APPLY") : "NOOP";
  if (options.apply && hasChanges) {
    applyTransaction(
      buildRoot,
      destRoot,
      registryPath,
      registryUpdate.text,
      lockPath,
      lockUpdate.text,
      report,
    );
    report.counts.applied = report.counts.create + report.counts.replace + report.counts.remove;
    for (const skill of report.skills) {
      if (skill.status === "remove") {
        if (fs.existsSync(path.join(destRoot, skill.name))) throw new Error(`post-apply removal failed: ${skill.name}`);
        skill.destinationHash = "missing";
        continue;
      }
      skill.destinationHash = hashDirectory(path.join(destRoot, skill.name));
      if (skill.destinationHash !== skill.sourceHash) throw new Error(`post-apply hash mismatch: ${skill.name}`);
    }
  }
} catch (error) {
  report.error = String(error?.message || error);
  report.result = "INVALID_INPUT";
} finally {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
}

printReport(report, options.json);
if (report.result === "INVALID_INPUT") process.exit(1);

function parseArgs(argv) {
  const result = {
    apply: false,
    yes: false,
    json: false,
    help: false,
    source: "",
    destRoot: "",
    packRegistry: "",
    packLock: "",
    packVersion: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") result.source = requiredValue(argv, ++index, arg);
    else if (arg === "--dest-root") result.destRoot = requiredValue(argv, ++index, arg);
    else if (arg === "--pack-registry") result.packRegistry = requiredValue(argv, ++index, arg);
    else if (arg === "--pack-lock") result.packLock = requiredValue(argv, ++index, arg);
    else if (arg === "--pack-version") result.packVersion = requiredValue(argv, ++index, arg);
    else if (arg === "--dry-run") result.apply = false;
    else if (arg === "--apply") result.apply = true;
    else if (arg === "--yes" || arg === "-y") result.yes = true;
    else if (arg === "--json") result.json = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
    else failUsage(`unknown option: ${arg}`);
  }
  return result;
}

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) failUsage(`${option} requires a value`);
  return value;
}

function choosePackVersion(previousPack, previousLock, sourceCommit, skillNames, bundleSha256, requestedVersion) {
  if (!previousPack) {
    const version = requestedVersion || INITIAL_PACK_VERSION;
    parseSemver(version);
    return { version, reviewLevel: "routine", skillSetChange: { added: [...skillNames], removed: [] } };
  }
  const previousNames = Array.isArray(previousPack.skills) ? previousPack.skills : [];
  const added = skillNames.filter((name) => !previousNames.includes(name));
  const removed = previousNames.filter((name) => !skillNames.includes(name));
  if (requestedVersion) {
    parseSemver(requestedVersion);
    const sameSkillSet = added.length === 0 && removed.length === 0;
    const sameSourceCommit = previousLock?.source_commit === sourceCommit;
    if (!sameSourceCommit || !sameSkillSet || requestedVersion !== previousPack.version) {
      throw new Error(
        "--pack-version may only preserve the current version for a same-commit, same-Skill-set adapter refresh",
      );
    }
    return { version: requestedVersion, reviewLevel: "maintainer", skillSetChange: { added, removed } };
  }
  const unchanged = previousLock?.source_commit === sourceCommit && previousLock?.bundle_sha256 === bundleSha256;
  if (unchanged && added.length === 0 && removed.length === 0) {
    return { version: previousPack.version, reviewLevel: "none", skillSetChange: { added, removed } };
  }
  const version = parseSemver(previousPack.version);
  let next;
  let reviewLevel = "routine";
  if (removed.length > 0) {
    next = `${version.major + 1}.0.0`;
    reviewLevel = "manual";
  } else if (added.length > 0) {
    next = `${version.major}.${version.minor + 1}.0`;
    reviewLevel = "manual";
  } else {
    next = `${version.major}.${version.minor}.${version.patch + 1}`;
  }
  return { version: next, reviewLevel, skillSetChange: { added, removed } };
}

function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value || "");
  if (!match) throw new Error(`invalid existing AI Berkshire Pack version: ${value || "missing"}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function readRegistry(file) {
  const payload = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : { schema: "pi67.shared-skill-packs.v1", packs: [] };
  if (payload.schema !== "pi67.shared-skill-packs.v1" || !Array.isArray(payload.packs)) {
    throw new Error("invalid shared-skill-packs.json schema");
  }
  return payload;
}

function readLock(file) {
  const payload = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : { schema: SKILL_PACK_LOCK_SCHEMA, packs: [] };
  if (payload.schema !== SKILL_PACK_LOCK_SCHEMA || !Array.isArray(payload.packs)) {
    throw new Error("invalid shared-skill-packs.lock.json schema");
  }
  return payload;
}

function buildRegistryUpdate(original, file, version, skillNames) {
  const next = structuredClone(original);
  for (const pack of next.packs) {
    if (pack.name === PACK_NAME) continue;
    const collisions = (pack.skills || []).filter((name) => skillNames.includes(name));
    if (collisions.length > 0) throw new Error(`AI Berkshire Skill name collides with ${pack.name}: ${collisions.join(", ")}`);
  }
  const entry = { name: PACK_NAME, version, upstream: UPSTREAM, sync_helper: SYNC_HELPER, skills: [...skillNames] };
  const index = next.packs.findIndex((pack) => pack.name === PACK_NAME);
  if (index >= 0) next.packs[index] = entry;
  else next.packs.push(entry);
  next.packs.sort((left, right) => left.name.localeCompare(right.name));
  const text = `${JSON.stringify(next, null, 2)}\n`;
  const currentText = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return { changed: currentText !== text, text };
}

function buildLockUpdate(original, file, version, sourceCommit, manifestFile, skillNames, buildRoot) {
  const next = structuredClone(original);
  const entry = buildPackLockEntry({
    name: PACK_NAME,
    version,
    upstream: UPSTREAM,
    sourceCommit,
    manifestFile,
    skillNames,
    skillRoot: buildRoot,
  });
  const index = next.packs.findIndex((pack) => pack.name === PACK_NAME);
  if (index >= 0) next.packs[index] = entry;
  else next.packs.push(entry);
  next.packs.sort((left, right) => left.name.localeCompare(right.name));
  const text = `${JSON.stringify(next, null, 2)}\n`;
  const currentText = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return { changed: currentText !== text, entry, text };
}

function applyTransaction(buildRoot, destinationRoot, packRegistry, registryText, packLock, lockText, data) {
  fs.mkdirSync(destinationRoot, { recursive: true });
  const transactionRoot = path.join(destinationRoot, `.ai-berkshire-pack-sync-${process.pid}-${Date.now()}`);
  const stagedRoot = path.join(transactionRoot, "staged");
  const previousRoot = path.join(transactionRoot, "previous");
  const changedSkills = data.skills.filter((skill) => skill.status === "create" || skill.status === "replace");
  const removedSkills = data.skills.filter((skill) => skill.status === "remove");
  const activated = [];
  const movedPrevious = [];
  const registryExisted = fs.existsSync(packRegistry);
  const registryOriginal = registryExisted ? fs.readFileSync(packRegistry) : null;
  const lockExisted = fs.existsSync(packLock);
  const lockOriginal = lockExisted ? fs.readFileSync(packLock) : null;
  try {
    fs.mkdirSync(stagedRoot, { recursive: true });
    for (const skill of changedSkills) {
      fs.cpSync(path.join(buildRoot, skill.name), path.join(stagedRoot, skill.name), { recursive: true, errorOnExist: true });
    }
    for (const skill of changedSkills) {
      const target = path.join(destinationRoot, skill.name);
      if (!fs.existsSync(target)) continue;
      fs.mkdirSync(previousRoot, { recursive: true });
      fs.renameSync(target, path.join(previousRoot, skill.name));
      movedPrevious.push(skill.name);
    }
    for (const skill of removedSkills) {
      const target = path.join(destinationRoot, skill.name);
      if (!fs.existsSync(target)) throw new Error(`Skill removal target disappeared during transaction: ${skill.name}`);
      if (hashDirectory(target) !== skill.destinationHash) {
        throw new Error(`Skill removal target changed during transaction: ${skill.name}`);
      }
      fs.mkdirSync(previousRoot, { recursive: true });
      fs.renameSync(target, path.join(previousRoot, skill.name));
      movedPrevious.push(skill.name);
    }
    for (const skill of changedSkills) {
      fs.renameSync(path.join(stagedRoot, skill.name), path.join(destinationRoot, skill.name));
      activated.push(skill.name);
    }
    if (data.registryChanged) fs.writeFileSync(packRegistry, registryText, "utf8");
    if (data.lockChanged) fs.writeFileSync(packLock, lockText, "utf8");
    for (const skill of changedSkills) {
      if (hashDirectory(path.join(destinationRoot, skill.name)) !== skill.sourceHash) {
        throw new Error(`transactional activation hash mismatch: ${skill.name}`);
      }
    }
    fs.rmSync(transactionRoot, { recursive: true, force: true });
  } catch (error) {
    for (const name of activated.reverse()) fs.rmSync(path.join(destinationRoot, name), { recursive: true, force: true });
    for (const name of movedPrevious.reverse()) {
      const previous = path.join(previousRoot, name);
      if (fs.existsSync(previous)) fs.renameSync(previous, path.join(destinationRoot, name));
    }
    if (data.registryChanged) {
      if (registryExisted) fs.writeFileSync(packRegistry, registryOriginal);
      else fs.rmSync(packRegistry, { force: true });
    }
    if (data.lockChanged) {
      if (lockExisted) fs.writeFileSync(packLock, lockOriginal);
      else fs.rmSync(packLock, { force: true });
    }
    fs.rmSync(transactionRoot, { recursive: true, force: true });
    throw error;
  }
}

function displayPath(value) {
  const home = os.homedir();
  return value === home ? "~" : value.startsWith(`${home}${path.sep}`) ? `~${value.slice(home.length)}` : value;
}

function printReport(data, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  console.log("");
  console.log("Pi-67 Desktop AI Berkshire Investment Skill Pack sync");
  console.log(`Mode        : ${data.mode}`);
  console.log(`Source      : ${data.source}`);
  console.log(`Destination : ${data.destinationRoot}`);
  console.log(`Pack        : ${data.packName}@${data.packVersion || "unknown"}`);
  console.log(`Source SHA  : ${data.provenance.sourceCommit || "unknown"}`);
  console.log(`Review      : ${data.reviewLevel}`);
  console.log(`Result      : ${data.result}`);
  if (data.error) console.log(`Error       : ${data.error}`);
  for (const skill of data.skills) console.log(`  ${skill.status.padEnd(9)} ${skill.name}`);
  if (data.result === "READY_TO_APPLY") {
    console.log("");
    console.log("Next step:");
    console.log(`  bash ${SYNC_HELPER} --source ${data.source} --apply --yes`);
  }
}

function printHelp() {
  process.stdout.write(`pi67-sync-ai-berkshire-skill-pack refreshes Pi-67 Desktop's vendored AI Berkshire Pack.

Usage:
  scripts/pi67-sync-ai-berkshire-skill-pack.sh [options]

Options:
      --source DIR         Clean xbtlin/ai-berkshire checkout. Defaults to
                           $AI_BERKSHIRE_REPO, then ../ai-berkshire.
      --dest-root DIR      Vendored Desktop workspace Skills root.
      --pack-registry FILE Pack registry path.
      --pack-lock FILE     Immutable provenance lock path.
      --pack-version VER   Preserve the current version only for a same-commit,
                           same-Skill-set adapter refresh.
      --dry-run            Generate and compare without writing (default).
      --apply              Transactionally create or replace the vendored Pack.
  -y, --yes                Required with --apply.
      --json               Emit desktop-ai-berkshire-skill-pack-sync/v1 JSON.
  -h, --help               Show this help.

The helper never executes upstream code. It requires a clean, correctly
originated Git checkout, adapts Codex packages for shared Pi/Codex use, bundles
referenced Python tools, and updates registry/lock provenance transactionally.
`);
}

function failUsage(message) {
  console.error(message);
  console.error("Run with --help for usage.");
  process.exit(2);
}
