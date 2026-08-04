import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPi67SkillPackSource } from "./pi67-skill-pack-overlay.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const lockPath = resolve(repositoryRoot, "eng/capabilities/capability-sources.lock.json");
const outputRoot = resolve(repositoryRoot, "artifacts/capabilities/current");

export async function assertPreparedDesktopCapabilities() {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const catalog = JSON.parse(await readFile(join(outputRoot, "catalog.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(outputRoot, "manifest.json"), "utf8"));
  assertCapabilitySourceLock(lock);
  assertCapabilitiesMetadata(lock, catalog, manifest);
  for (const entry of catalog.entries) {
    const expected = manifest.packages.find((candidate) => candidate.id === entry.id);
    const actual = await treeSha256(join(outputRoot, entry.packagePath));
    if (actual !== expected.treeSha256) {
      throw new Error(`Prepared capability package failed integrity validation: ${entry.id}`);
    }
  }
  return { catalog, manifest };
}

export function assertCapabilitiesMetadata(lock, catalog, manifest) {
  if (
    catalog?.schema !== "pi67.capability-catalog.v1"
    || manifest?.schema !== "pi67.desktop-capabilities.v1"
    || catalog.catalogVersion !== lock.catalogVersion
    || manifest.catalogVersion !== lock.catalogVersion
    || !Array.isArray(catalog.entries)
    || !Array.isArray(catalog.generatedFrom)
    || !Array.isArray(manifest.packages)
  ) throw new Error("Prepared capability metadata does not match the locked catalog.");

  const expectedSources = new Map(lock.sources.map((source) => [source.id, source]));
  const generated = new Map(catalog.generatedFrom.map((source) => [source.id, source]));
  const entries = new Map(catalog.entries.map((entry) => [entry.id, entry]));
  const packages = new Map(manifest.packages.map((entry) => [entry.id, entry]));
  if (
    expectedSources.size !== generated.size
    || expectedSources.size !== entries.size
    || expectedSources.size !== packages.size
  ) throw new Error("Prepared capability package set does not match the source lock.");

  for (const [id, source] of expectedSources) {
    const generatedSource = generated.get(id);
    const entry = entries.get(id);
    const packageIdentity = packages.get(id);
    if (
      generatedSource?.commit !== source.commit
      || generatedSource?.version !== source.version
      || generatedSource?.repository !== source.repository
      || entry?.commit !== source.commit
      || entry?.version !== source.version
      || entry?.repository !== source.repository
      || typeof entry?.packagePath !== "string"
      || !/^[a-f0-9]{64}$/u.test(packageIdentity?.treeSha256 ?? "")
    ) throw new Error(`Prepared capability metadata is stale: ${id}`);
  }
}

export async function treeSha256(root) {
  const hash = createHash("sha256");
  const visit = async (directory) => {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).split(sep).join("/");
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        hash.update(`f\0${relativePath}\0`);
        hash.update(await readFile(path));
        hash.update("\0");
      } else {
        throw new Error(`Unsupported generated capability entry: ${path}`);
      }
    }
  };
  await visit(root);
  return hash.digest("hex");
}

export function assertCapabilitySourceLock(lock) {
  if (
    lock.schema !== "pi67.capability-sources-lock.v1"
    || !Array.isArray(lock.sources)
    || !Array.isArray(lock.skillPacks)
  ) throw new Error("Capability source lock is invalid.");

  const ids = lock.sources.map((source) => source.id);
  if (new Set(ids).size !== ids.length || ids.length !== 4) throw new Error("Capability source ids are invalid.");
  for (const source of lock.sources) {
    if (!/^[0-9a-f]{40}$/u.test(source.commit) || !source.repository.startsWith("https://github.com/")) {
      throw new Error(`Capability source ${source.id} is not pinned to a canonical Git commit.`);
    }
    assertLocalSibling(source.localSibling, "capability local sibling");
  }
  const packNames = lock.skillPacks.map((pack) => pack?.name);
  if (new Set(packNames).size !== packNames.length || packNames.length !== 1) {
    throw new Error("Bundled Skill Pack source ids are invalid.");
  }
  for (const pack of lock.skillPacks) {
    assertPi67SkillPackSource(pack);
    assertLocalSibling(pack.localSibling, "Skill Pack local sibling");
  }
}

function assertLocalSibling(path, label) {
  if (
    typeof path !== "string"
    || path.length === 0
    || path.includes("\0")
    || isAbsolute(path)
  ) throw new Error(`${label} must identify one direct sibling repository.`);
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  const candidate = resolve(repositoryRoot, path);
  if (
    parts.length !== 2
    || parts[0] !== ".."
    || !/^[A-Za-z0-9._-]+$/u.test(parts[1] ?? "")
    || resolve(dirname(candidate)) !== resolve(dirname(repositoryRoot))
  ) throw new Error(`${label} must identify one direct sibling repository.`);
}
