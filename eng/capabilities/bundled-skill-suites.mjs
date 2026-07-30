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

export function compileBundledSkillSuites(definition, entries) {
  if (
    !isRecord(definition)
    || definition.schema !== "pi67.bundled-skill-suites.v1"
    || !Array.isArray(definition.suites)
    || definition.suites.length === 0
    || definition.suites.length > 32
  ) throw new Error("Bundled Skill suite definition is invalid.");
  const availableSkills = new Set();
  for (const entry of entries) {
    for (const skill of entry.bundledSkills ?? []) {
      const key = bundledSkillKey(entry.id, skill.id);
      if (availableSkills.has(key)) throw new Error(`Bundled Skill identity is duplicated: ${key}`);
      availableSkills.add(key);
    }
  }
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
    return {
      id: suite.id,
      displayName: suite.displayName,
      description: suite.description,
      members
    };
  });
  const unassigned = [...availableSkills].filter((key) => !assignedSkills.has(key));
  if (unassigned.length > 0) {
    throw new Error(`Bundled Skills are missing suite membership: ${unassigned.join(", ")}`);
  }
  return suites;
}

function bundledSkillKey(packageId, skillId) {
  return `${packageId}:${skillId}`;
}

function isCatalogId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/u.test(value);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
