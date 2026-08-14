import { hashManagedSkillSet } from "./managed-skill-pack-state.js";

const PACK_ID = "ai-berkshire-investment-suite";
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;
const SKILL_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/u;

export interface Pi67SkillPackRelease {
  id: typeof PACK_ID;
  version: string;
  upstream?: string;
  sourceCommit: string;
  registryCommit: string;
  manifestSha256: string;
  bundleSha256: string;
  skills: Array<{ name: string; sha256: string }>;
  independentlyInstallable: boolean;
}

export function parsePi67SkillPackRelease(
  registry: unknown,
  lock: unknown,
  registryCommit: string
): Pi67SkillPackRelease {
  if (!COMMIT_PATTERN.test(registryCommit)) throw new Error("Pi-67 registry commit 无效。");
  if (!isRecord(registry) || registry.schema !== "pi67.shared-skill-packs.v1" || !Array.isArray(registry.packs)) {
    throw new Error("Pi-67 Skill Pack registry schema 无效。");
  }
  if (!isRecord(lock) || lock.schema !== "pi67.shared-skill-packs-lock.v1" || !Array.isArray(lock.packs)) {
    throw new Error("Pi-67 Skill Pack lock schema 无效。");
  }
  if (registry.packs.length > 64 || lock.packs.length > 64) {
    throw new Error("Pi-67 Skill Pack registry 超出条目限制。");
  }
  const registryMatches = registry.packs.filter((entry) => isRecord(entry) && entry.name === PACK_ID);
  const lockMatches = lock.packs.filter((entry) => isRecord(entry) && entry.name === PACK_ID);
  if (registryMatches.length !== 1 || lockMatches.length !== 1) {
    throw new Error("Pi-67 registry 缺少唯一的 AI Berkshire Skill Pack。");
  }
  const pack = registryMatches[0]!;
  const locked = lockMatches[0]!;
  const bundledReleaseOnly = pack.distribution === "bundled-release-only";
  const upstream = isHttpsUrl(pack.upstream) && pack.upstream === locked.upstream
    ? String(pack.upstream)
    : undefined;
  const legacyBundledWithoutUpstream = bundledReleaseOnly
    && pack.upstream === undefined
    && locked.upstream === "";
  if (
    !VERSION_PATTERN.test(String(pack.version ?? ""))
    || pack.version !== locked.version
    || (!upstream && !legacyBundledWithoutUpstream)
    || !COMMIT_PATTERN.test(String(locked.source_commit ?? ""))
    || !SHA256_PATTERN.test(String(locked.manifest_sha256 ?? ""))
    || !SHA256_PATTERN.test(String(locked.bundle_sha256 ?? ""))
    || (pack.distribution !== undefined && pack.distribution !== "bundled-release-only")
    || !Array.isArray(pack.skills)
    || !Array.isArray(locked.skills)
    || pack.skills.length === 0
    || pack.skills.length > 256
    || locked.skills.length !== pack.skills.length
  ) throw new Error("Pi-67 AI Berkshire Skill Pack 元数据不一致。");
  const skills: Array<{ name: string; sha256: string }> = [];
  for (let index = 0; index < pack.skills.length; index += 1) {
    const name = pack.skills[index];
    const lockedSkill = locked.skills[index];
    if (
      typeof name !== "string"
      || !SKILL_PATTERN.test(name)
      || !isRecord(lockedSkill)
      || lockedSkill.name !== name
      || typeof lockedSkill.sha256 !== "string"
      || !SHA256_PATTERN.test(lockedSkill.sha256)
    ) throw new Error("Pi-67 AI Berkshire Skill Pack 成员完整性无效。");
    skills.push({ name, sha256: lockedSkill.sha256 });
  }
  if (new Set(skills.map((skill) => skill.name)).size !== skills.length) {
    throw new Error("Pi-67 AI Berkshire Skill Pack 成员重复。");
  }
  if (hashManagedSkillSet(skills) !== locked.bundle_sha256) {
    throw new Error("Pi-67 AI Berkshire Skill Pack bundle hash 无效。");
  }
  return {
    id: PACK_ID,
    version: String(pack.version),
    ...(upstream ? { upstream } : {}),
    sourceCommit: String(locked.source_commit),
    registryCommit,
    manifestSha256: String(locked.manifest_sha256),
    bundleSha256: String(locked.bundle_sha256),
    skills,
    independentlyInstallable: !bundledReleaseOnly
  };
}

export function compareSkillPackVersions(left: string, right: string): number {
  if (!VERSION_PATTERN.test(left) || !VERSION_PATTERN.test(right)) {
    throw new Error("Skill Pack version 必须使用 MAJOR.MINOR.PATCH。");
  }
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

export function parsePi67RegistryBranch(output: string): string {
  const lines = output.split(/\r?\n/gu).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) throw new Error("Pi-67 registry branch 解析失败。");
  const [commit, ref, ...rest] = lines[0]!.split(/\s+/gu);
  if (!commit || !COMMIT_PATTERN.test(commit) || ref !== "refs/heads/main" || rest.length > 0) {
    throw new Error("Pi-67 registry branch 解析失败。");
  }
  return commit;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
