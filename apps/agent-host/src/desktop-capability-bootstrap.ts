import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  isContainedRelativePath,
  parseCapabilityCatalog,
  parseCapabilityManifest
} from "./desktop-capability-catalog.js";
import { managedSkillPackPackagePaths } from "./managed-skill-pack-state.js";

const STATE_SCHEMA = "pi67.desktop-capability-state.v1";
const MAX_METADATA_BYTES = 1_000_000;

export interface DesktopCapabilityBootstrapOptions {
  capabilitiesRoot?: string;
  agentDir: string;
  environment?: NodeJS.ProcessEnv;
  profileOwnership?: "desktop" | "shared";
  createToken?: () => string;
}

export interface DesktopCapabilityBootstrapResult {
  enabled: boolean;
  catalogVersion?: string;
  managedRoot?: string;
  packagePaths: string[];
  rules: "installed" | "unavailable";
  agents: "installed" | "user-owned" | "unavailable";
}

export async function bootstrapDesktopCapabilities(
  options: DesktopCapabilityBootstrapOptions
): Promise<DesktopCapabilityBootstrapResult> {
  const environment = options.environment ?? process.env;
  const configuredRoot = options.capabilitiesRoot ?? environment.PI67_CAPABILITIES_ROOT;
  if (environment.PI67_DESKTOP !== "1" || !configuredRoot) {
    return { enabled: false, packagePaths: [], rules: "unavailable", agents: "unavailable" };
  }
  const capabilitiesRoot = resolve(configuredRoot);
  const agentDir = resolve(options.agentDir);
  const managedRoot = join(agentDir, "desktop-capabilities");
  const createToken = options.createToken ?? randomUUID;
  let manifestValue: unknown;
  let catalogValue: unknown;
  try {
    [manifestValue, catalogValue] = await Promise.all([
      readBoundedJson(join(capabilitiesRoot, "manifest.json")),
      readBoundedJson(join(capabilitiesRoot, "catalog.json"))
    ]);
  } catch (error) {
    if (environment.PI67_PACKAGED !== "1" && isNodeError(error, "ENOENT")) {
      return { enabled: false, packagePaths: [], rules: "unavailable", agents: "unavailable" };
    }
    throw error;
  }
  const manifest = parseCapabilityManifest(manifestValue);
  const catalog = parseCapabilityCatalog(catalogValue);
  if (!manifest || !catalog || manifest.catalogVersion !== catalog.catalogVersion) {
    throw new Error("Desktop capability metadata is invalid or inconsistent.");
  }
  const manifestById = new Map(manifest.packages.map((entry) => [entry.id, entry]));
  if (
    manifestById.size !== catalog.entries.length
    || catalog.entries.some((entry) => !manifestById.has(entry.id))
  ) throw new Error("Desktop capability catalog does not match its integrity manifest.");

  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  await mkdir(managedRoot, { recursive: true, mode: 0o700 });
  const bundledPackagePaths: string[] = [];
  for (const entry of catalog.entries) {
    const integrity = manifestById.get(entry.id)!;
    const source = containedPath(capabilitiesRoot, entry.packagePath, "Capability package path");
    const destination = join(managedRoot, "packages", entry.id);
    const sourceHash = await capabilityTreeSha256(source, integrity.includeNodeModules);
    if (sourceHash !== integrity.treeSha256) {
      throw new Error(`Desktop capability ${entry.id} failed bundled integrity verification.`);
    }
    await replaceDirectoryIfChanged(
      source,
      destination,
      integrity.treeSha256,
      managedRoot,
      createToken,
      integrity.includeNodeModules
    );
    bundledPackagePaths.push(destination);
  }

  const pi67Core = bundledPackagePaths[catalog.entries.findIndex((entry) => entry.id === "pi67-core")];
  const rules = pi67Core && existsSync(join(pi67Core, "rules"))
    ? await materializeRules(join(pi67Core, "rules"), join(agentDir, "rules", "pi67-desktop"), agentDir, createToken)
    : "unavailable";
  const agents = pi67Core
    ? await materializeAgentsFile(join(pi67Core, "AGENTS.md"), join(agentDir, "AGENTS.md"))
    : "unavailable";
  await writeState(managedRoot, {
    schema: STATE_SCHEMA,
    catalogVersion: catalog.catalogVersion,
    packages: catalog.entries.map((entry, index) => ({
      id: entry.id,
      displayName: entry.displayName,
      resourceTypes: entry.resourceTypes,
      treeSha256: manifestById.get(entry.id)!.treeSha256,
      installed: true,
      packageIndex: index
    })),
    rules,
    agents,
    profileOwnership: options.profileOwnership ?? "desktop",
    preparedAt: Date.now()
  }, createToken);
  if (process.platform !== "win32") await chmod(managedRoot, 0o700);

  const packagePaths = [
    ...await managedSkillPackPackagePaths(agentDir),
    ...bundledPackagePaths
  ];
  environment.PI67_MANAGED_CAPABILITIES_ROOT = managedRoot;
  environment.PI67_CAPABILITY_PACKAGE_PATHS = JSON.stringify(packagePaths);
  environment.PI67_KNOWN_PACKAGE_BASELINES = JSON.stringify(
    catalog.recommendedExternal
      .filter((entry) => (
        entry.admissionPolicy === "known-baseline-or-user-approval"
        && entry.baselineContentSha256 !== undefined
        && entry.recommendedVersion !== undefined
      ))
      .map((entry) => ({
        source: entry.source,
        packageName: entry.source.slice("npm:".length),
        packageVersion: entry.recommendedVersion,
        baselineContentSha256: entry.baselineContentSha256
      }))
  );
  return {
    enabled: true,
    catalogVersion: catalog.catalogVersion,
    managedRoot,
    packagePaths,
    rules,
    agents
  };
}

async function materializeRules(
  source: string,
  destination: string,
  containmentRoot: string,
  createToken: () => string
): Promise<"installed"> {
  const expected = await capabilityTreeSha256(source);
  await replaceDirectoryIfChanged(source, destination, expected, containmentRoot, createToken);
  return "installed";
}

async function materializeAgentsFile(
  source: string,
  destination: string
): Promise<"installed" | "user-owned" | "unavailable"> {
  try {
    const existing = await lstat(destination);
    if (existing.isSymbolicLink() || !existing.isFile()) return "user-owned";
    return "user-owned";
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
  try {
    const metadata = await lstat(source);
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_METADATA_BYTES) {
      return "unavailable";
    }
    await writeFile(destination, await readFile(source), { flag: "wx", mode: 0o600 });
    return "installed";
  } catch (error) {
    if (isNodeError(error, "EEXIST")) return "user-owned";
    if (isNodeError(error, "ENOENT")) return "unavailable";
    throw error;
  }
}

async function replaceDirectoryIfChanged(
  source: string,
  destination: string,
  expectedHash: string,
  containmentRoot: string,
  createToken: () => string,
  includeNodeModules = false
): Promise<void> {
  if (await directoryHashMatches(destination, expectedHash, includeNodeModules)) return;
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const token = createToken();
  const staging = join(dirname(destination), `.${basename(destination)}.${process.pid}.${token}.staging`);
  const backup = join(dirname(destination), `.${basename(destination)}.${process.pid}.${token}.backup`);
  if (!isContained(staging, containmentRoot) || !isContained(backup, containmentRoot)) {
    throw new Error("Desktop capability staging path escaped its managed root.");
  }
  let staged = false;
  let backedUp = false;
  try {
    await copyDirectory(source, staging, source, includeNodeModules);
    staged = true;
    if (await capabilityTreeSha256(staging, includeNodeModules) !== expectedHash) {
      throw new Error("Desktop capability copy failed integrity verification.");
    }
    try {
      await rename(destination, backup);
      backedUp = true;
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
    await rename(staging, destination);
    staged = false;
    if (backedUp) {
      await rm(backup, { recursive: true, force: true });
      backedUp = false;
    }
  } finally {
    if (staged) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    if (backedUp) {
      try {
        await rename(backup, destination);
      } catch {
        // Preserve the backup for manual recovery when the destination cannot be restored.
      }
    }
  }
}

async function copyDirectory(
  source: string,
  destination: string,
  sourceRoot: string,
  includeNodeModules: boolean
): Promise<void> {
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink()) throw new Error(`Desktop capabilities cannot contain symlinks: ${source}`);
  if (!metadata.isDirectory()) throw new Error(`Desktop capability package must be a directory: ${source}`);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const entries = (await readdir(source, { withFileTypes: true }))
    .filter((entry) => entry.name !== ".DS_Store" && (includeNodeModules || entry.name !== "node_modules"))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const input = join(source, entry.name);
    const output = join(destination, entry.name);
    if (!isContained(input, sourceRoot)) throw new Error("Desktop capability copy escaped its source root.");
    const child = await lstat(input);
    if (child.isSymbolicLink()) throw new Error(`Desktop capabilities cannot contain symlinks: ${input}`);
    if (child.isDirectory()) {
      await copyDirectory(input, output, sourceRoot, includeNodeModules);
    } else if (child.isFile()) {
      await writeFile(output, await readFile(input), { mode: child.mode & 0o111 ? 0o755 : 0o600 });
    } else {
      throw new Error(`Unsupported Desktop capability entry: ${input}`);
    }
  }
}

export async function capabilityTreeSha256(root: string, includeNodeModules = false): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (directory: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.name !== ".DS_Store" && (includeNodeModules || entry.name !== "node_modules"))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).split(sep).join("/");
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) throw new Error(`Desktop capabilities cannot contain symlinks: ${path}`);
      if (metadata.isDirectory()) {
        await visit(path);
      } else if (metadata.isFile()) {
        hash.update(`f\0${relativePath}\0`);
        hash.update(await readFile(path));
        hash.update("\0");
      } else {
        throw new Error(`Unsupported Desktop capability entry: ${path}`);
      }
    }
  };
  await visit(root);
  return hash.digest("hex");
}

async function directoryHashMatches(
  path: string,
  expected: string,
  includeNodeModules: boolean
): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isDirectory() && !metadata.isSymbolicLink()
      && await capabilityTreeSha256(path, includeNodeModules) === expected;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw error;
  }
}

async function readBoundedJson(path: string): Promise<unknown> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MAX_METADATA_BYTES) {
    throw new Error("Desktop capability metadata must be a bounded regular file.");
  }
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function writeState(root: string, value: unknown, createToken: () => string): Promise<void> {
  const path = join(root, "state.json");
  const temporary = join(root, `.state.${process.pid}.${createToken()}.tmp`);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  if (process.platform !== "win32") await chmod(path, 0o600);
}

function containedPath(root: string, path: string, label: string): string {
  if (!isContainedRelativePath(path)) throw new Error(`${label} is invalid.`);
  const candidate = resolve(root, path);
  if (!isContained(candidate, root)) throw new Error(`${label} escaped its root.`);
  return candidate;
}

function isContained(candidate: string, root: string): boolean {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return fromRoot === "" || (
    fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot)
  );
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
