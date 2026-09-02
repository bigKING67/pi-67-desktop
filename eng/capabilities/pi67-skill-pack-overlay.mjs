import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";

const ADAPTER_ID = "desktop-ai-berkshire-v1";
const ADAPTER_PATH = "ai-berkshire-skill-pack-sync.mjs";
const SYNC_HELPER = "eng/capabilities/ai-berkshire-skill-pack-sync.mjs";
const REPORT_LIMIT_BYTES = 128 * 1024;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;
const GIT_OBJECT_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/u;

export function assertPi67SkillPackSource(definition) {
  if (
    !isRecord(definition)
    || !SKILL_NAME_PATTERN.test(definition.name ?? "")
    || definition.adapter !== ADAPTER_ID
    || definition.adapterSourceId !== "pi-workspace-resources"
    || !VERSION_PATTERN.test(definition.version ?? "")
    || !GIT_OBJECT_PATTERN.test(definition.commit ?? "")
    || !SHA256_PATTERN.test(definition.manifestSha256 ?? "")
    || !SHA256_PATTERN.test(definition.bundleSha256 ?? "")
    || !isValidSkillBaseline(definition.skills)
    || definition.ref !== "refs/heads/main"
    || !isHttpsUrl(definition.repository)
  ) throw new Error("Bundled Pi-67 Skill Pack source is invalid.");
}

export async function preparePi67SkillPackOverlay({
  definition,
  workspaceResourceRoot,
  upstreamSourceRoot,
  outputRoot,
  adapterRoot
}) {
  assertPi67SkillPackSource(definition);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(join(outputRoot, "shared-skills"), { recursive: true });
  const registryPath = join(outputRoot, "shared-skill-packs.json");
  const lockPath = join(outputRoot, "shared-skill-packs.lock.json");
  await Promise.all([
    copyFile(join(workspaceResourceRoot, "shared-skill-packs.json"), registryPath),
    copyFile(join(workspaceResourceRoot, "shared-skill-packs.lock.json"), lockPath)
  ]);
  await seedDesktopSkillPackBaseline({ definition, registryPath, lockPath });
  const report = JSON.parse(await capture(process.execPath, [
    join(adapterRoot, ADAPTER_PATH),
    "--source", upstreamSourceRoot,
    "--dest-root", join(outputRoot, "shared-skills"),
    "--pack-registry", registryPath,
    "--pack-lock", lockPath,
    "--apply",
    "--yes",
    "--json"
  ]));
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const pack = registry.packs?.find((entry) => entry?.name === definition.name);
  const locked = lock.packs?.find((entry) => entry?.name === definition.name);
  const skillNames = validateGeneratedPack({ definition, report, registry, lock, pack, locked });
  return {
    name: definition.name,
    version: definition.version,
    upstream: definition.repository,
    sourceCommit: definition.commit,
    sourceRoot: join(outputRoot, "shared-skills"),
    skills: skillNames,
    manifestSha256: definition.manifestSha256,
    bundleSha256: definition.bundleSha256
  };
}

async function seedDesktopSkillPackBaseline({ definition, registryPath, lockPath }) {
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  if (
    registry?.schema !== "pi67.shared-skill-packs.v1"
    || !Array.isArray(registry.packs)
    || lock?.schema !== "pi67.shared-skill-packs-lock.v1"
    || !Array.isArray(lock.packs)
  ) throw new Error("Pi-67 Skill Pack baseline is invalid.");
  const skillNames = definition.skills.map((skill) => skill.name);
  replacePack(registry.packs, {
    name: definition.name,
    version: definition.version,
    upstream: definition.repository,
    sync_helper: SYNC_HELPER,
    skills: skillNames
  });
  replacePack(lock.packs, {
    name: definition.name,
    version: definition.version,
    upstream: definition.repository,
    source_commit: definition.commit,
    manifest_sha256: definition.manifestSha256,
    bundle_sha256: definition.bundleSha256,
    skills: definition.skills
  });
  await Promise.all([
    writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8"),
    writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8")
  ]);
}

function replacePack(packs, next) {
  const index = packs.findIndex((pack) => pack?.name === next.name);
  if (index >= 0) packs[index] = next;
  else packs.push(next);
  packs.sort((left, right) => String(left?.name).localeCompare(String(right?.name)));
}

function validateGeneratedPack({ definition, report, registry, lock, pack, locked }) {
  if (
    report?.schemaId !== "desktop-ai-berkshire-skill-pack-sync/v1"
    || report.result !== "APPLIED"
    || report.packName !== definition.name
    || report.packVersion !== definition.version
    || report.provenance?.sourceCommit !== definition.commit
    || report.provenance?.sourceManifestSha256 !== definition.manifestSha256
    || report.provenance?.bundleSha256 !== definition.bundleSha256
    || registry?.schema !== "pi67.shared-skill-packs.v1"
    || lock?.schema !== "pi67.shared-skill-packs-lock.v1"
    || pack?.version !== definition.version
    || pack?.upstream !== definition.repository
    || locked?.version !== definition.version
    || locked?.upstream !== definition.repository
    || locked?.source_commit !== definition.commit
    || locked?.manifest_sha256 !== definition.manifestSha256
    || locked?.bundle_sha256 !== definition.bundleSha256
    || JSON.stringify(locked?.skills) !== JSON.stringify(definition.skills)
    || !Array.isArray(pack.skills)
    || !Array.isArray(locked.skills)
  ) throw new Error(`Generated Pi-67 Skill Pack ${definition.name} did not match its Desktop lock.`);
  if (
    pack.skills.some((name) => !SKILL_NAME_PATTERN.test(name ?? ""))
    || locked.skills.some((skill) => (
      !SKILL_NAME_PATTERN.test(skill?.name ?? "")
      || !SHA256_PATTERN.test(skill?.sha256 ?? "")
    ))
  ) throw new Error(`Generated Pi-67 Skill Pack ${definition.name} has invalid member provenance.`);
  const skillNames = [...pack.skills].sort((left, right) => left.localeCompare(right));
  const lockedNames = locked.skills.map((skill) => skill?.name)
    .sort((left, right) => left.localeCompare(right));
  if (
    skillNames.length === 0
    || new Set(skillNames).size !== skillNames.length
    || JSON.stringify(skillNames) !== JSON.stringify(lockedNames)
  ) throw new Error(`Generated Pi-67 Skill Pack ${definition.name} has invalid member provenance.`);
  return skillNames;
}

function isValidSkillBaseline(skills) {
  if (!Array.isArray(skills) || skills.length === 0 || skills.length > 128) return false;
  const names = skills.map((skill) => skill?.name);
  return skills.every((skill) => (
    SKILL_NAME_PATTERN.test(skill?.name ?? "")
    && SHA256_PATTERN.test(skill?.sha256 ?? "")
  ))
    && new Set(names).size === names.length
    && JSON.stringify(names) === JSON.stringify([...names].sort((left, right) => left.localeCompare(right)));
}

function capture(command, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const append = (current, chunk) => `${current}${String(chunk)}`.slice(0, REPORT_LIMIT_BYTES);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${basename(command)} exited with ${signal ?? code}: ${(stderr || stdout).trim()}`));
    });
  });
}

function isHttpsUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
