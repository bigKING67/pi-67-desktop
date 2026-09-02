import { readFile } from "node:fs/promises";
import { join } from "node:path";

export function parseSkillMetadata(markdown) {
  const normalized = String(markdown).replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) throw new Error("Bundled Skill metadata is missing frontmatter.");
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) throw new Error("Bundled Skill metadata frontmatter is incomplete.");
  const lines = normalized.slice(4, end).split("\n");
  const name = frontmatterScalar(lines, "name");
  const description = frontmatterScalar(lines, "description").replace(/\s+/gu, " ").trim();
  if (!isCatalogId(name) || description.length === 0 || description.length > 2_000) {
    throw new Error("Bundled Skill metadata is invalid.");
  }
  return { name, description };
}

function frontmatterScalar(lines, key) {
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index < 0) return "";
  const value = lines[index].slice(key.length + 1).trim();
  if (/^[>|][-+]?$/u.test(value)) {
    const content = [];
    for (const line of lines.slice(index + 1)) {
      if (line.length > 0 && !/^\s/u.test(line)) break;
      content.push(line.trim());
    }
    return value.startsWith("|") ? content.join("\n").trim() : content.join(" ").trim();
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  return value;
}

export async function readPi67SkillPackMetadata(sourceRoot) {
  const registry = JSON.parse(await readFile(join(sourceRoot, "shared-skill-packs.json"), "utf8"));
  const lock = JSON.parse(await readFile(join(sourceRoot, "shared-skill-packs.lock.json"), "utf8"));
  if (
    registry?.schema !== "pi67.shared-skill-packs.v1"
    || !Array.isArray(registry.packs)
    || lock?.schema !== "pi67.shared-skill-packs-lock.v1"
    || !Array.isArray(lock.packs)
  ) throw new Error("pi-67 shared Skill Pack metadata is invalid.");
  const locks = new Map(lock.packs.map((entry) => [entry?.name, entry]));
  return registry.packs.map((pack) => {
    const locked = locks.get(pack?.name);
    if (
      typeof pack?.name !== "string"
      || typeof pack.version !== "string"
      || locked?.version !== pack.version
      || typeof locked.source_commit !== "string"
    ) throw new Error("pi-67 shared Skill Pack metadata is inconsistent.");
    const upstream = typeof pack.upstream === "string" && pack.upstream.length > 0
      ? pack.upstream
      : typeof locked.upstream === "string" && locked.upstream.length > 0
        ? locked.upstream
        : undefined;
    return {
      name: pack.name,
      version: pack.version,
      sourceCommit: locked.source_commit,
      ...(upstream ? { upstream } : {})
    };
  });
}

export function compileBundledSkillSuites(definition, entries, metadata = {}) {
  if (
    !isRecord(definition)
    || definition.schema !== "pi67.bundled-skill-suites.v1"
    || !Array.isArray(definition.suites)
    || definition.suites.length === 0
    || definition.suites.length > 32
  ) throw new Error("Bundled Skill suite definition is invalid.");
  const availableSkills = new Set();
  const packages = new Map();
  for (const entry of entries) {
    if (packages.has(entry.id)) throw new Error(`Bundled capability package is duplicated: ${entry.id}`);
    packages.set(entry.id, entry);
    for (const skill of entry.bundledSkills ?? []) {
      const key = bundledSkillKey(entry.id, skill.id);
      if (availableSkills.has(key)) throw new Error(`Bundled Skill identity is duplicated: ${key}`);
      availableSkills.add(key);
    }
  }
  const skillPacks = parseSkillPackMetadata(metadata.skillPacks);
  const suiteIds = new Set();
  const assignedSkills = new Set();
  const suites = definition.suites.map((suite) => {
    if (
      !isRecord(suite)
      || !isCatalogId(suite.id)
      || suiteIds.has(suite.id)
      || typeof suite.displayName !== "string"
      || suite.displayName.length === 0
      || suite.displayName.length > 100
      || typeof suite.description !== "string"
      || suite.description.length === 0
      || suite.description.length > 500
      || !isVersionSource(suite.versionSource)
      || (suite.upstream !== undefined && !isHttpsUrl(suite.upstream))
      || !["hybrid", "capability-package", "source-specific"].includes(suite.updatePolicy)
      || !["lark-cli", "desktop-capability", "source-specific"].includes(suite.updateManager)
      || !["available", "planned", "not-applicable"].includes(suite.independentUpdateState)
      || !Array.isArray(suite.members)
      || suite.members.length === 0
      || suite.members.length > 256
    ) throw new Error("Bundled Skill suite entry is invalid.");
    suiteIds.add(suite.id);
    const members = suite.members.map((member) => {
      if (!isRecord(member) || !isCatalogId(member.packageId) || !isCatalogId(member.skillId)) {
        throw new Error("Bundled Skill suite member is invalid.");
      }
      const key = bundledSkillKey(member.packageId, member.skillId);
      if (!availableSkills.has(key)) throw new Error(`Bundled Skill suite member is unavailable: ${key}`);
      if (assignedSkills.has(key)) throw new Error(`Bundled Skill suite member is duplicated: ${key}`);
      assignedSkills.add(key);
      return { packageId: member.packageId, skillId: member.skillId };
    });
    const version = resolveSuiteVersion(suite.versionSource, packages, skillPacks);
    const upstream = suite.upstream ?? version.upstream;
    return {
      id: suite.id,
      displayName: suite.displayName,
      description: suite.description,
      versionSource: version.kind,
      ...(version.version ? { bundledVersion: version.version } : {}),
      ...(upstream ? { upstream } : {}),
      ...(version.sourceCommit ? { sourceCommit: version.sourceCommit } : {}),
      updatePolicy: suite.updatePolicy,
      updateManager: suite.updateManager,
      independentUpdateState: suite.independentUpdateState,
      members
    };
  });
  const unassigned = [...availableSkills].filter((key) => !assignedSkills.has(key));
  if (unassigned.length > 0) {
    throw new Error(`Bundled Skills are missing suite membership: ${unassigned.join(", ")}`);
  }
  return suites;
}

function parseSkillPackMetadata(value) {
  if (value === undefined) return new Map();
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error("Bundled Skill Pack metadata is invalid.");
  }
  const packs = new Map();
  for (const item of value) {
    if (
      !isRecord(item)
      || !isCatalogId(item.name)
      || !isVersion(item.version)
      || (item.upstream !== undefined && !isHttpsUrl(item.upstream))
      || (item.sourceCommit !== undefined && !isCommit(item.sourceCommit))
      || packs.has(item.name)
    ) throw new Error("Bundled Skill Pack metadata is invalid.");
    packs.set(item.name, item);
  }
  return packs;
}

function resolveSuiteVersion(source, packages, skillPacks) {
  if (source.kind === "unversioned" || source.kind === "multiple-sources") {
    return { kind: source.kind };
  }
  if (source.kind === "capability-package") {
    const capability = packages.get(source.packageId);
    if (!capability || !isVersion(capability.version)) {
      throw new Error(`Bundled Skill suite version package is unavailable: ${source.packageId}`);
    }
    return {
      kind: "capability-package",
      version: capability.version,
      ...(isHttpsUrl(capability.repository) ? { upstream: capability.repository } : {}),
      ...(isCommit(capability.commit) ? { sourceCommit: capability.commit } : {})
    };
  }
  const pack = skillPacks.get(source.packName);
  if (!pack) throw new Error(`Bundled Skill suite version pack is unavailable: ${source.packName}`);
  return {
    kind: "skill-pack",
    version: pack.version,
    ...(pack.upstream ? { upstream: pack.upstream } : {}),
    ...(pack.sourceCommit ? { sourceCommit: pack.sourceCommit } : {})
  };
}

function isVersionSource(value) {
  if (!isRecord(value)) return false;
  if (value.kind === "unversioned" || value.kind === "multiple-sources") {
    return Object.keys(value).length === 1;
  }
  if (value.kind === "capability-package") {
    return isCatalogId(value.packageId) && Object.keys(value).length === 2;
  }
  if (value.kind === "pi67-skill-pack") {
    return isCatalogId(value.packName) && Object.keys(value).length === 2;
  }
  return false;
}

function bundledSkillKey(packageId, skillId) {
  return `${packageId}:${skillId}`;
}

function isCatalogId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/u.test(value);
}

function isVersion(value) {
  return typeof value === "string" && /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u.test(value);
}

function isCommit(value) {
  return typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value);
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
