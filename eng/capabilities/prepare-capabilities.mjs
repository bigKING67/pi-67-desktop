import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  compileBundledSkillSuites,
  parseSkillMetadata
} from "./bundled-skill-suites.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const lockPath = resolve(repositoryRoot, "eng/capabilities/capability-sources.lock.json");
const skillSuitesPath = resolve(repositoryRoot, "eng/capabilities/bundled-skill-suites.json");
const outputRoot = resolve(repositoryRoot, "artifacts/capabilities/current");
const sourceCacheRoot = resolve(repositoryRoot, "artifacts/capabilities/sources");
const toolchainManifestPath = resolve(repositoryRoot, "artifacts/toolchain/current/manifest.json");
const MAX_GIT_OUTPUT_BYTES = 8_192;
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
  const git = await bundledGitExecutable();
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(join(outputRoot, "packages"), { recursive: true });

  const sources = new Map();
  for (const source of lock.sources) {
    sources.set(source.id, await resolveExactSource(source, git));
  }
  const entries = [];
  entries.push(await preparePi67Core(sources.get("pi67-core"), lock.sources.find((item) => item.id === "pi67-core")));
  entries.push(await prepareBrowser67(sources.get("browser67"), lock.sources.find((item) => item.id === "browser67")));
  entries.push(await prepareDesignCraft(sources.get("design-craft"), lock.sources.find((item) => item.id === "design-craft")));
  entries.push(await prepareCommerceGrowthOs(
    sources.get("commerce-growth-os"),
    lock.sources.find((item) => item.id === "commerce-growth-os")
  ));
  const bundledSkillSuites = compileBundledSkillSuites(skillSuiteDefinition, entries);

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

async function preparePi67Core(sourceRoot, source) {
  const destination = join(outputRoot, "packages", source.id);
  await mkdir(join(destination, "skills"), { recursive: true });
  await copyAllowed(sourceRoot, destination, ["extensions", "prompts", "rules", "AGENTS.md", "README.md", "VERSION"]);
  const skillNames = (await readdir(join(sourceRoot, "shared-skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !COMMERCE_SKILLS.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const skillName of skillNames) {
    await copyEntry(
      join(sourceRoot, "shared-skills", skillName),
      join(destination, "skills", skillName),
      sourceRoot
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
    "skills"
  ]);
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

async function resolveExactSource(source, git) {
  const local = resolve(repositoryRoot, source.localSibling);
  if (await isExactCleanRepository(local, source.commit, git)) return local;
  const destination = join(sourceCacheRoot, source.id);
  await rm(destination, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  let lastError;
  const transports = [
    ...(await repositoryContainsCommit(local, source.commit, git) ? [local] : []),
    ...gitTransportCandidates(source.repository)
  ];
  for (const url of transports) {
    try {
      await run(git, ["clone", "--no-checkout", url, destination]);
      await run(git, ["-C", destination, "checkout", "--detach", source.commit]);
      if (await capture(git, ["-C", destination, "rev-parse", "HEAD"]) !== source.commit) {
        throw new Error("checked out commit did not match the lock");
      }
      return destination;
    } catch (error) {
      lastError = error;
      await rm(destination, { recursive: true, force: true });
    }
  }
  throw new Error(`Unable to obtain locked capability source ${source.id}: ${errorMessage(lastError)}`);
}

async function repositoryContainsCommit(path, commit, git) {
  try {
    if (!lstatSync(path).isDirectory()) return false;
    return await capture(git, ["-C", path, "rev-parse", "--verify", `${commit}^{commit}`]) === commit;
  } catch {
    return false;
  }
}

async function isExactCleanRepository(path, commit, git) {
  try {
    if (!lstatSync(path).isDirectory()) return false;
    const head = await capture(git, ["-C", path, "rev-parse", "HEAD"]);
    if (head !== commit) return false;
    return (await capture(git, ["-C", path, "status", "--porcelain=v1", "--untracked-files=all"])) === "";
  } catch {
    return false;
  }
}

function gitTransportCandidates(canonical) {
  const parsed = new URL(canonical);
  const path = parsed.pathname.replace(/^\/+|\/+$/gu, "");
  return [
    `https://gitclone.com/github.com/${path}`,
    `https://ghproxy.net/${canonical}`,
    canonical
  ];
}

async function bundledGitExecutable() {
  const manifest = JSON.parse(await readFile(toolchainManifestPath, "utf8"));
  const path = resolve(dirname(toolchainManifestPath), manifest.paths?.git ?? "");
  if (!isContained(path, dirname(toolchainManifestPath))) {
    throw new Error("Bundled Git escaped the Desktop toolchain root.");
  }
  await stat(path);
  return path;
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
  if (lock.schema !== "pi67.capability-sources-lock.v1" || !Array.isArray(lock.sources)) {
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

function capture(command, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise(stdout.trim());
      else reject(new Error(`${basename(command)} exited with ${signal ?? code}: ${(stderr || stdout).trim()}`));
    });
  });
}

function run(command, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const captureOutput = (chunk) => {
      if (output.length < MAX_GIT_OUTPUT_BYTES) {
        output += String(chunk).slice(0, MAX_GIT_OUTPUT_BYTES - output.length);
      }
    };
    child.stdout.on("data", captureOutput);
    child.stderr.on("data", captureOutput);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${basename(command)} exited with ${signal ?? code}: ${output.trim()}`));
    });
  });
}

function isNodeError(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareDesktopCapabilities();
}
