import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";

const ADAPTER_ID = "pi67-ai-berkshire-v1";
const ADAPTER_PATH = "scripts/pi67-sync-ai-berkshire-skill-pack.mjs";
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
    || definition.adapterSourceId !== "pi67-core"
    || !VERSION_PATTERN.test(definition.version ?? "")
    || !GIT_OBJECT_PATTERN.test(definition.commit ?? "")
    || !SHA256_PATTERN.test(definition.manifestSha256 ?? "")
    || !SHA256_PATTERN.test(definition.bundleSha256 ?? "")
    || definition.ref !== "refs/heads/main"
    || !isHttpsUrl(definition.repository)
  ) throw new Error("Bundled Pi-67 Skill Pack source is invalid.");
}

export async function preparePi67SkillPackOverlay({
  definition,
  pi67SourceRoot,
  upstreamSourceRoot,
  outputRoot
}) {
  assertPi67SkillPackSource(definition);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(join(outputRoot, "shared-skills"), { recursive: true });
  const registryPath = join(outputRoot, "shared-skill-packs.json");
  const lockPath = join(outputRoot, "shared-skill-packs.lock.json");
  await Promise.all([
    copyFile(join(pi67SourceRoot, "shared-skill-packs.json"), registryPath),
    copyFile(join(pi67SourceRoot, "shared-skill-packs.lock.json"), lockPath)
  ]);
  const report = JSON.parse(await capture(process.execPath, [
    join(pi67SourceRoot, ADAPTER_PATH),
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

function validateGeneratedPack({ definition, report, registry, lock, pack, locked }) {
  if (
    report?.schemaId !== "pi67-ai-berkshire-skill-pack-sync/v1"
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
