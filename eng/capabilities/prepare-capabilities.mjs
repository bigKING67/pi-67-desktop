import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { compileBundledSkillSuites, parseSkillMetadata, readPi67SkillPackMetadata } from "./bundled-skill-suites.mjs";
import { resolveBundledGitToolchain, resolveExactCapabilitySource } from "./capability-source-resolver.mjs";
import {
  assertPi67SkillPackSource,
  preparePi67SkillPackOverlay
} from "./pi67-skill-pack-overlay.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const lockPath = resolve(repositoryRoot, "eng/capabilities/capability-sources.lock.json");
const skillSuitesPath = resolve(repositoryRoot, "eng/capabilities/bundled-skill-suites.json");
const outputRoot = resolve(repositoryRoot, "artifacts/capabilities/current");
const sourceCacheRoot = resolve(repositoryRoot, "artifacts/capabilities/sources");
const generatedSkillPackRoot = resolve(repositoryRoot, "artifacts/capabilities/generated/skill-packs");
const toolchainManifestPath = resolve(repositoryRoot, "artifacts/toolchain/current/manifest.json");
const execFileAsync = promisify(execFile);
const COMMERCE_SKILLS = new Set([
  "commerce-growth-os",
  "commerce-commercial-strategy",
  "commerce-operations",
  "commerce-analytics",
  "consumer-marketing-os",
  "brand-strategy-communications",
  "content-creative-social-marketing",
  "growth-performance-lifecycle-marketing"
]);

export async function prepareDesktopCapabilities() {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const skillSuiteDefinition = JSON.parse(await readFile(skillSuitesPath, "utf8"));
  assertLock(lock);
  const git = await resolveBundledGitToolchain(toolchainManifestPath);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(join(outputRoot, "packages"), { recursive: true });

  const sources = new Map();
  for (const source of lock.sources) {
    sources.set(source.id, await resolveExactCapabilitySource({
      source,
      repositoryRoot,
      sourceCacheRoot,
      git
    }));
  }
  const skillPackOverlays = [];
  for (const definition of lock.skillPacks) {
    const upstreamSourceRoot = await resolveExactCapabilitySource({
      source: {
        id: `skill-pack-${definition.name}`,
        repository: definition.repository,
        commit: definition.commit,
        localSibling: definition.localSibling
      },
      repositoryRoot,
      sourceCacheRoot,
      git
    });
    skillPackOverlays.push(await preparePi67SkillPackOverlay({
      definition,
      pi67SourceRoot: sources.get(definition.adapterSourceId),
      upstreamSourceRoot,
      outputRoot: join(generatedSkillPackRoot, definition.name)
    }));
  }
  const entries = [];
  entries.push(await preparePi67Core(
    sources.get("pi67-core"),
    lock.sources.find((item) => item.id === "pi67-core"),
    skillPackOverlays
  ));
  entries.push(await prepareBrowser67(sources.get("browser67"), lock.sources.find((item) => item.id === "browser67")));
  entries.push(await prepareDesignCraft(sources.get("design-craft"), lock.sources.find((item) => item.id === "design-craft")));
  entries.push(await prepareCommerceGrowthOs(
    sources.get("commerce-growth-os"),
    lock.sources.find((item) => item.id === "commerce-growth-os")
  ));
  const overlayNames = new Set(skillPackOverlays.map((pack) => pack.name));
  const skillPacks = [
    ...(await readPi67SkillPackMetadata(sources.get("pi67-core")))
      .filter((pack) => !overlayNames.has(pack.name)),
    ...skillPackOverlays.map(({ sourceRoot: _sourceRoot, skills: _skills, ...pack }) => pack)
  ].sort((left, right) => left.name.localeCompare(right.name));
  const bundledSkillSuites = compileBundledSkillSuites(skillSuiteDefinition, entries, { skillPacks });

  const catalog = {
    schema: "pi67.capability-catalog.v1",
    catalogVersion: lock.catalogVersion,
    generatedFrom: entries.map(({ packagePath: _packagePath, resourceTypes: _resourceTypes, ...entry }) => entry),
    entries,
    bundledSkillSuites,
    recommendedExternal: lock.recommendedExternal
  };
  await writeFile(join(outputRoot, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  const manifest = {
    schema: "pi67.desktop-capabilities.v1",
    catalogVersion: lock.catalogVersion,
    packages: await Promise.all(entries.map(async (entry) => ({
      id: entry.id,
      treeSha256: await treeSha256(join(outputRoot, entry.packagePath))
    })))
  };
  await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Prepared ${entries.length} Pi-67 Desktop first-party capability packages (${lock.catalogVersion}).`);
  return { catalog, manifest };
}

async function preparePi67Core(sourceRoot, source, skillPackOverlays) {
  const destination = join(outputRoot, "packages", source.id);
  await mkdir(join(destination, "skills"), { recursive: true });
  await copyAllowed(sourceRoot, destination, ["extensions", "prompts", "rules", "AGENTS.md", "README.md", "VERSION"]);
  const overlaySkillRoots = new Map();
  for (const overlay of skillPackOverlays) {
    for (const skillName of overlay.skills) {
      if (COMMERCE_SKILLS.has(skillName) || overlaySkillRoots.has(skillName)) {
        throw new Error(`Bundled Skill Pack overlay is invalid: ${skillName}`);
      }
      overlaySkillRoots.set(skillName, overlay.sourceRoot);
    }
  }
  const sourceSkillNames = (await readdir(join(sourceRoot, "shared-skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !COMMERCE_SKILLS.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  const skillNames = [...new Set([...sourceSkillNames, ...overlaySkillRoots.keys()])]
    .sort((left, right) => left.localeCompare(right));
  for (const skillName of skillNames) {
    const skillSourceRoot = overlaySkillRoots.get(skillName) ?? join(sourceRoot, "shared-skills");
    await copyEntry(
      join(skillSourceRoot, skillName),
      join(destination, "skills", skillName),
      skillSourceRoot
    );
  }
  const extensions = (await readdir(join(destination, "extensions"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => `extensions/${entry.name}`)
    .sort();
  const prompts = (await readdir(join(destination, "prompts"), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => `prompts/${entry.name}`)
    .sort();
  await writePackageManifest(destination, {
    name: "@pi67/bundled-core",
    version: source.version,
    private: true,
    pi: {
      extensions,
      skills: skillNames.map((name) => `skills/${name}`),
      prompts
    }
  });
  return catalogEntry(
    source,
    "packages/pi67-core",
    ["extension", "skill", "prompt", "rule"],
    extensions.map((extensionPath) => {
      const id = basename(extensionPath);
      return { id, displayName: id };
    }),
    await bundledSkillEntries(destination, skillNames.map((name) => `skills/${name}`))
  );
}

async function prepareBrowser67(sourceRoot, source) {
  const destination = join(outputRoot, "packages", source.id);
  await copyAllowed(sourceRoot, destination, [
    "package.json",
    "package-lock.json",
    "LICENSE",
    "README.md",
    "bin",
    "src",
    "extension",
    "skills",
    "scripts/build-extension.mjs",
    "scripts/extension-install-doctor.mjs",
    "scripts/reload-extension-live.mjs",
    "scripts/setup-extension.mjs",
    "contracts/browser67-live-doctor.mjs",
    "contracts/browser67-live-doctor",
    "contracts/browser67-live-gate.mjs",
    "contracts/browser67-live-gate"
  ]);
  const packagePath = join(destination, "package.json");
  const packageManifest = JSON.parse(await readFile(packagePath, "utf8"));
  if (packageManifest.version !== source.version) {
    throw new Error("Bundled browser67 version does not match the capability source lock");
  }
  await writeFile(packagePath, `${JSON.stringify({
    ...packageManifest,
    gitHead: source.commit
  }, null, 2)}\n`, "utf8");
  await assertBrowser67PackageEntrypoints(destination);
  const skillPaths = (await readdir(join(destination, "skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => `skills/${entry.name}`)
    .sort();
  return catalogEntry(
    source,
    "packages/browser67",
    ["skill", "integration"],
    [],
    await bundledSkillEntries(destination, skillPaths)
  );
}

async function assertBrowser67PackageEntrypoints(packageRoot) {
  const checks = [[
    join(packageRoot, "bin", "browser67.mjs"),
    "setup",
    "--help"
  ], [
    join(packageRoot, "scripts", "extension-install-doctor.mjs"),
    "--help"
  ]];
  for (const arguments_ of checks) {
    const { stdout } = await execFileAsync(process.execPath, arguments_, {
      cwd: packageRoot,
      env: {
        ...process.env,
        PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter)
      },
      maxBuffer: 1_000_000,
      timeout: 30_000
    });
    if (!String(stdout).includes("Usage:")) {
      throw new Error(`Bundled browser67 entrypoint did not report usage: ${relative(packageRoot, arguments_[0])}`);
    }
  }
}

async function prepareDesignCraft(sourceRoot, source) {
  const destination = join(outputRoot, "packages", source.id);
  await copyAllowed(sourceRoot, destination, [
    "skills/design-craft",
    "LICENSE",
    "LICENSES",
    "README.md",
    "THIRD_PARTY_NOTICES.md",
    "VERSION",
    "package.json"
  ]);
  return catalogEntry(
    source,
    "packages/design-craft",
    ["skill"],
    [],
    await bundledSkillEntries(destination, ["skills/design-craft"])
  );
}

async function prepareCommerceGrowthOs(sourceRoot, source) {
  const destination = join(outputRoot, "packages", source.id);
  const pack = JSON.parse(await readFile(join(sourceRoot, "skill-pack.json"), "utf8"));
  if (!Array.isArray(pack.skills) || pack.pack_version !== source.version) {
    throw new Error("commerce-growth-os skill-pack.json does not match the locked package version.");
  }
  const skillPaths = [];
  for (const skill of pack.skills) {
    assertRelativePath(skill.source, "commerce skill source");
    const skillDestination = join(destination, "skills", skill.name);
    await copyEntry(join(sourceRoot, skill.source), skillDestination, sourceRoot);
    for (const resource of skill.resources ?? []) {
      assertRelativePath(resource.source, "commerce resource source");
      assertRelativePath(resource.target, "commerce resource target");
      await copyEntry(
        join(sourceRoot, resource.source),
        join(skillDestination, resource.target),
        sourceRoot
      );
    }
    skillPaths.push(`skills/${skill.name}`);
  }
  await copyAllowed(sourceRoot, destination, ["README.md", "skill-pack.json"]);
  await writePackageManifest(destination, {
    name: "@pi67/bundled-commerce-growth-os",
    version: source.version,
    private: true,
    pi: { skills: skillPaths }
  });
  return catalogEntry(
    source,
    "packages/commerce-growth-os",
    ["skill"],
    [],
    await bundledSkillEntries(destination, skillPaths)
  );
}

async function bundledSkillEntries(destination, skillPaths) {
  return Promise.all(skillPaths.map(async (skillPath) => {
    const id = basename(skillPath);
    const metadata = parseSkillMetadata(await readFile(join(destination, skillPath, "SKILL.md"), "utf8"));
    if (metadata.name !== id) {
      throw new Error(`Bundled Skill identity does not match its directory: ${skillPath}`);
    }
    return { id, displayName: metadata.name, description: metadata.description };
  }));
}

function catalogEntry(source, packagePath, resourceTypes, bundledExtensions = [], bundledSkills = []) {
  return {
    id: source.id,
    displayName: source.displayName,
    origin: source.origin,
    bundled: true,
    defaultEnabled: true,
    version: source.version,
    repository: source.repository,
    commit: source.commit,
    packagePath,
    resourceTypes,
    bundledExtensions,
    bundledSkills
  };
}

async function copyAllowed(sourceRoot, destinationRoot, paths) {
  for (const path of paths) {
    assertRelativePath(path, "capability allowlist path");
    const source = join(sourceRoot, path);
    try {
      await copyEntry(source, join(destinationRoot, path), sourceRoot);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) continue;
      throw error;
    }
  }
}

async function copyEntry(source, destination, sourceRoot) {
  if (!isContained(source, sourceRoot)) throw new Error("Capability copy escaped its locked source root.");
  const metadata = await lstatPromise(source);
  if (metadata.isSymbolicLink()) throw new Error(`Capability sources cannot contain symlinks: ${source}`);
  if (metadata.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const entries = (await readdir(source, { withFileTypes: true }))
      .filter((entry) => entry.name !== ".DS_Store")
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      await copyEntry(join(source, entry.name), join(destination, entry.name), sourceRoot);
    }
    return;
  }
  if (!metadata.isFile()) throw new Error(`Unsupported capability source entry: ${source}`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(source), { mode: metadata.mode & 0o111 ? 0o755 : 0o644 });
}

async function writePackageManifest(destination, manifest) {
  await writeFile(join(destination, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function treeSha256(root) {
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

function assertLock(lock) {
  if (
    lock.schema !== "pi67.capability-sources-lock.v1"
    || !Array.isArray(lock.sources)
    || !Array.isArray(lock.skillPacks)
  ) {
    throw new Error("Capability source lock is invalid.");
  }
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

function assertRelativePath(path, label) {
  if (
    typeof path !== "string"
    || path.length === 0
    || path.includes("\0")
    || isAbsolute(path)
    || path.split(/[\\/]/u).includes("..")
  ) throw new Error(`${label} must be a contained relative path.`);
}

function isContained(candidate, root) {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function lstatPromise(path) {
  return import("node:fs/promises").then(({ lstat }) => lstat(path));
}

function isNodeError(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareDesktopCapabilities();
}
