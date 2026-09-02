import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SKILL_PACK_LOCK_SCHEMA = "pi67.shared-skill-packs-lock.v1";

const IGNORED_CACHE_DIRECTORIES = new Set(["__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"]);

export function hashDirectory(root) {
  if (!fs.existsSync(root)) return "";
  const hash = crypto.createHash("sha256");
  const files = [];
  walkFiles(root, files);
  for (const file of files.sort(compareCodePoints)) {
    hash.update(path.relative(root, file).replace(/\\/g, "/"));
    hash.update("\0");
    hash.update(canonicalHashBytes(fs.readFileSync(file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hashFile(file) {
  const hash = crypto.createHash("sha256");
  hash.update(canonicalHashBytes(fs.readFileSync(file)));
  return hash.digest("hex");
}

export function hashSkillSet(skills) {
  const hash = crypto.createHash("sha256");
  for (const skill of [...skills].sort((left, right) => left.name.localeCompare(right.name))) {
    hash.update(skill.name);
    hash.update("\0");
    hash.update(skill.sha256);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function buildPackLockEntry({
  name,
  version,
  upstream,
  sourceCommit,
  manifestFile,
  skillNames,
  skillRoot,
}) {
  const skills = skillNames.map((skillName) => ({
    name: skillName,
    sha256: hashDirectory(path.join(skillRoot, skillName)),
  }));
  return {
    name,
    version,
    upstream,
    source_commit: sourceCommit,
    manifest_sha256: hashFile(manifestFile),
    bundle_sha256: hashSkillSet(skills),
    skills,
  };
}

function walkFiles(root, output) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_CACHE_DIRECTORIES.has(entry.name)) continue;
    if (entry.isFile() && (/\.py[cod]$/i.test(entry.name) || entry.name === ".DS_Store")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walkFiles(full, output);
    else if (entry.isFile()) output.push(full);
  }
}

function canonicalHashBytes(content) {
  if (content.includes(0)) return content;
  const text = content.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(content)) return content;
  return Buffer.from(text.replace(/\r\n/g, "\n"), "utf8");
}
