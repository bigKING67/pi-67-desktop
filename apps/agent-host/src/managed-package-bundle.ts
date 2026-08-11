import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { safeAtomicReplaceFile } from "@pi67/pi-runtime";

const MANIFEST_SCHEMA = "pi67.managed-npm-bundle.v1";
const STATE_SCHEMA = "pi67.managed-package-state.v1";
const MAX_METADATA_BYTES = 1_000_000;
const MAX_TREE_FILES = 50_000;
const MAX_TREE_BYTES = 768 * 1024 * 1024;

interface ManagedPackageEntry {
  id: string;
  packageName: string;
  source: string;
  version: string;
  packageIntegrity: string;
  packagePath: string;
  extensionPaths: string[];
  defaultEnabled: true;
}

interface ManagedPackageManifest {
  schema: typeof MANIFEST_SCHEMA;
  catalogVersion: string;
  platform: string;
  architecture: string;
  lockfileSha256: string;
  treeSha256: string;
  fileCount: number;
  totalBytes: number;
  packages: ManagedPackageEntry[];
}

interface ManagedPackageState {
  schema: typeof STATE_SCHEMA;
  enabled: Record<string, boolean>;
}

export interface ManagedPackageBundleResult {
  enabled: boolean;
  activeRoot?: string;
  packagePaths: string[];
  extensionPaths: string[];
  activated: boolean;
}

export async function activateDesktopManagedPackages(options: {
  agentDir: string;
  capabilitiesRoot?: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  architecture?: string;
  createToken?: () => string;
}): Promise<ManagedPackageBundleResult> {
  const environment = options.environment ?? process.env;
  const configuredRoot = options.capabilitiesRoot ?? environment.PI67_CAPABILITIES_ROOT;
  if (environment.PI67_DESKTOP !== "1" || !configuredRoot) {
    return { enabled: false, packagePaths: [], extensionPaths: [], activated: false };
  }
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const capabilitiesRoot = resolve(configuredRoot);
  const managedCapabilitiesRoot = resolve(options.agentDir, "desktop-capabilities");
  const root = join(managedCapabilitiesRoot, "managed-packages");
  const bundled = join(capabilitiesRoot, "managed-packages", "bundled");
  const active = join(root, "active");
  const previous = join(root, "previous");
  const createToken = options.createToken ?? randomUUID;
  const bundledManifest = await verifyManagedPackageTree(bundled, platform, architecture);
  let activated = false;
  const activeManifest = await verifyManagedPackageTreeIfPresent(active, platform, architecture);
  if (
    !activeManifest
    || activeManifest.catalogVersion !== bundledManifest.catalogVersion
    || activeManifest.treeSha256 !== bundledManifest.treeSha256
  ) {
    await mkdir(join(root, "staging"), { recursive: true, mode: 0o700 });
    const staging = join(root, "staging", `${process.pid}-${createToken()}`);
    if (!isContained(staging, root)) throw new Error("Managed package staging path escaped its root.");
    let staged = false;
    let backedUp = false;
    try {
      await copyDirectory(bundled, staging, bundled);
      staged = true;
      const stagedManifest = await verifyManagedPackageTree(staging, platform, architecture);
      if (stagedManifest.treeSha256 !== bundledManifest.treeSha256) {
        throw new Error("Managed package staging copy failed integrity verification.");
      }
      await rm(previous, { recursive: true, force: true });
      try {
        await rename(active, previous);
        backedUp = true;
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) throw error;
      }
      await rename(staging, active);
      staged = false;
      activated = true;
    } catch (error) {
      if (backedUp) {
        await rm(active, { recursive: true, force: true }).catch(() => undefined);
        await rename(previous, active).catch(() => undefined);
        backedUp = false;
      }
      throw error;
    } finally {
      if (staged) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  const manifest = await verifyManagedPackageTree(active, platform, architecture);
  const state = await readOrCreateState(root, manifest.packages, createToken);
  const packagePaths: string[] = [];
  const extensionPaths: string[] = [];
  for (const entry of manifest.packages) {
    if (state.enabled[entry.id] !== true) continue;
    const packagePath = containedPath(active, entry.packagePath, "Managed package path");
    packagePaths.push(packagePath);
    for (const extensionPath of entry.extensionPaths) {
      const resolvedExtension = containedPath(packagePath, extensionPath, "Managed extension path");
      const metadata = await stat(resolvedExtension);
      if (!metadata.isFile()) throw new Error(`Managed extension is unavailable: ${entry.id}`);
      extensionPaths.push(resolvedExtension);
    }
  }
  const existing = parsePackagePathEnvironment(environment.PI67_CAPABILITY_PACKAGE_PATHS, managedCapabilitiesRoot);
  environment.PI67_MANAGED_NPM_ROOT = active;
  environment.PI67_CAPABILITY_PACKAGE_PATHS = JSON.stringify([...new Set([...existing, ...packagePaths])]);
  environment.PI67_MANAGED_EXTENSION_PATHS = JSON.stringify(extensionPaths);
  if (platform !== "win32") await chmod(root, 0o700);
  return { enabled: true, activeRoot: active, packagePaths, extensionPaths, activated };
}

export async function managedPackageTreeSha256(root: string): Promise<{
  sha256: string;
  fileCount: number;
  totalBytes: number;
}> {
  const hash = createHash("sha256");
  let fileCount = 0;
  let totalBytes = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => !(directory === root && entry.name === "manifest.json"))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).split(sep).join("/");
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink()) throw new Error(`Managed packages cannot contain symlinks: ${relativePath}`);
      if (metadata.isDirectory()) {
        await visit(path);
      } else if (metadata.isFile()) {
        const bytes = await readFile(path);
        fileCount += 1;
        totalBytes += bytes.byteLength;
        if (fileCount > MAX_TREE_FILES || totalBytes > MAX_TREE_BYTES) {
          throw new Error("Managed package tree exceeds its integrity bounds.");
        }
        hash.update(`f\0${relativePath}\0`);
        hash.update(bytes);
        hash.update("\0");
      } else {
        throw new Error(`Managed packages contain an unsupported entry: ${relativePath}`);
      }
    }
  };
  await visit(root);
  return { sha256: hash.digest("hex"), fileCount, totalBytes };
}

async function verifyManagedPackageTree(
  root: string,
  platform: NodeJS.Platform,
  architecture: string
): Promise<ManagedPackageManifest> {
  const manifest = parseManagedPackageManifest(await readBoundedJson(join(root, "manifest.json")));
  if (manifest.platform !== platform || manifest.architecture !== architecture) {
    throw new Error("Managed package bundle does not match the current platform.");
  }
  const tree = await managedPackageTreeSha256(root);
  if (
    tree.sha256 !== manifest.treeSha256
    || tree.fileCount !== manifest.fileCount
    || tree.totalBytes !== manifest.totalBytes
    || sha256(await readFile(join(root, "package-lock.json"))) !== manifest.lockfileSha256
  ) throw new Error("Managed package bundle failed integrity verification.");
  return manifest;
}

async function verifyManagedPackageTreeIfPresent(
  root: string,
  platform: NodeJS.Platform,
  architecture: string
): Promise<ManagedPackageManifest | undefined> {
  try {
    return await verifyManagedPackageTree(root, platform, architecture);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    return undefined;
  }
}

function parseManagedPackageManifest(value: unknown): ManagedPackageManifest {
  if (
    !isRecord(value)
    || value.schema !== MANIFEST_SCHEMA
    || !isVersion(value.catalogVersion)
    || typeof value.platform !== "string"
    || typeof value.architecture !== "string"
    || !isSha256(value.lockfileSha256)
    || !isSha256(value.treeSha256)
    || !Number.isSafeInteger(value.fileCount)
    || (value.fileCount as number) < 1
    || (value.fileCount as number) > MAX_TREE_FILES
    || !Number.isSafeInteger(value.totalBytes)
    || (value.totalBytes as number) < 1
    || (value.totalBytes as number) > MAX_TREE_BYTES
    || !Array.isArray(value.packages)
    || value.packages.length === 0
    || value.packages.length > 16
  ) throw new Error("Managed package manifest is invalid.");
  const packages = value.packages.map(parseManagedPackageEntry);
  if (new Set(packages.map((entry) => entry.id)).size !== packages.length) {
    throw new Error("Managed package manifest contains duplicate entries.");
  }
  return {
    schema: MANIFEST_SCHEMA,
    catalogVersion: value.catalogVersion,
    platform: value.platform,
    architecture: value.architecture,
    lockfileSha256: value.lockfileSha256,
    treeSha256: value.treeSha256,
    fileCount: value.fileCount as number,
    totalBytes: value.totalBytes as number,
    packages
  };
}

function parseManagedPackageEntry(value: unknown): ManagedPackageEntry {
  if (
    !isRecord(value)
    || !isId(value.id)
    || value.packageName !== value.id
    || value.source !== `npm:${value.packageName}`
    || !isVersion(value.version)
    || typeof value.packageIntegrity !== "string"
    || !value.packageIntegrity.startsWith("sha512-")
    || !isContainedRelativePath(value.packagePath)
    || !Array.isArray(value.extensionPaths)
    || value.extensionPaths.length === 0
    || value.extensionPaths.some((path) => !isContainedRelativePath(path))
    || value.defaultEnabled !== true
  ) throw new Error("Managed package manifest entry is invalid.");
  return {
    id: value.id,
    packageName: value.packageName,
    source: value.source,
    version: value.version,
    packageIntegrity: value.packageIntegrity,
    packagePath: value.packagePath,
    extensionPaths: [...value.extensionPaths] as string[],
    defaultEnabled: true
  };
}

async function readOrCreateState(
  root: string,
  packages: ManagedPackageEntry[],
  createToken: () => string
): Promise<ManagedPackageState> {
  const path = join(root, "state.json");
  let existing: ManagedPackageState | undefined;
  try {
    const value = await readBoundedJson(path);
    if (isRecord(value) && value.schema === STATE_SCHEMA && isBooleanRecord(value.enabled)) {
      existing = { schema: STATE_SCHEMA, enabled: { ...value.enabled } };
    }
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
  const enabled: Record<string, boolean> = {};
  for (const entry of packages) enabled[entry.id] = existing?.enabled[entry.id] ?? entry.defaultEnabled;
  const state = { schema: STATE_SCHEMA, enabled } satisfies ManagedPackageState;
  await safeAtomicReplaceFile(path, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
    createToken
  });
  return state;
}

async function copyDirectory(source: string, destination: string, sourceRoot: string): Promise<void> {
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Managed package source is invalid: ${source}`);
  }
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const entries = (await readdir(source, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const input = join(source, entry.name);
    const output = join(destination, entry.name);
    if (!isContained(input, sourceRoot)) throw new Error("Managed package copy escaped its source root.");
    const child = await lstat(input);
    if (child.isSymbolicLink()) throw new Error(`Managed packages cannot contain symlinks: ${input}`);
    if (child.isDirectory()) {
      await copyDirectory(input, output, sourceRoot);
    } else if (child.isFile()) {
      await writeFile(output, await readFile(input), { mode: child.mode & 0o111 ? 0o755 : 0o600 });
    } else {
      throw new Error(`Managed packages contain an unsupported entry: ${input}`);
    }
  }
}

function parsePackagePathEnvironment(value: string | undefined, root: string): string[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Managed capability package paths are malformed.");
  }
  if (
    !Array.isArray(parsed)
    || parsed.length > 32
    || parsed.some((path) => typeof path !== "string" || !isSameOrContained(path, root))
  ) throw new Error("Managed capability package paths escaped their verified root.");
  return parsed as string[];
}

async function readBoundedJson(path: string): Promise<unknown> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_METADATA_BYTES) {
    throw new Error(`Managed package metadata is invalid: ${basename(path)}`);
  }
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function containedPath(root: string, path: string, label: string): string {
  if (!isContainedRelativePath(path)) throw new Error(`${label} is invalid.`);
  const candidate = resolve(root, path);
  if (!isContained(candidate, root)) throw new Error(`${label} escaped its verified root.`);
  return candidate;
}

function isContained(candidate: string, root: string): boolean {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return fromRoot !== "" && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}

function isSameOrContained(candidate: string, root: string): boolean {
  if (!isAbsolute(candidate)) return false;
  return resolve(candidate) === resolve(root) || isContained(candidate, root);
}

function isContainedRelativePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 1_024
    && !value.includes("\0")
    && !isAbsolute(value)
    && !value.split(/[\\/]/u).includes("..");
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "boolean");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/u.test(value);
}

function isVersion(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 100 && !value.includes("\0");
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
