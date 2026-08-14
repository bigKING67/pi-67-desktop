import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { safeAtomicReplaceFile } from "@pi67/pi-runtime";
import {
  isManagedPackageRelativePath,
  MAX_MANAGED_PACKAGE_TREE_BYTES,
  MAX_MANAGED_PACKAGE_TREE_FILES,
  parseManagedPackageManifest,
  type ManagedPackageEntry,
  type ManagedPackageManifest
} from "./managed-package-manifest.js";

const STATE_SCHEMA = "pi67.managed-package-state.v1";
const MAX_METADATA_BYTES = 1_000_000;

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
  projectionMode?: "packaged-direct" | "legacy-copy";
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
  const packagedDirect = environment.PI67_PACKAGED === "1";
  const bundledManifest = packagedDirect
    ? await verifyPackagedManagedPackageMetadata(bundled, platform, architecture)
    : await verifyManagedPackageTree(bundled, platform, architecture);
  if (packagedDirect) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const state = await readOrCreateState(root, bundledManifest.packages, createToken);
    const packagePaths: string[] = [];
    const extensionPaths: string[] = [];
    for (const entry of bundledManifest.packages) {
      if (state.enabled[entry.id] !== true) continue;
      const packagePath = containedPath(bundled, entry.packagePath, "Managed package path");
      packagePaths.push(packagePath);
      for (const extensionPath of entry.extensionPaths) {
        extensionPaths.push(containedPath(packagePath, extensionPath, "Managed extension path"));
      }
    }
    const existing = parsePackagePathEnvironment(environment.PI67_CAPABILITY_PACKAGE_PATHS, [
      managedCapabilitiesRoot,
      resolve(capabilitiesRoot)
    ]);
    environment.PI67_MANAGED_NPM_ROOT = bundled;
    environment.PI67_CAPABILITY_PACKAGE_PATHS = JSON.stringify([...new Set([...existing, ...packagePaths])]);
    environment.PI67_MANAGED_EXTENSION_PATHS = JSON.stringify(extensionPaths);
    if (platform !== "win32") await chmod(root, 0o700);
    return {
      enabled: true,
      activeRoot: bundled,
      packagePaths,
      extensionPaths,
      activated: false,
      projectionMode: "packaged-direct"
    };
  }
  let activated = false;
  let activeManifest = await verifyManagedPackageTreeIfPresent(active, platform, architecture);
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
      // Rename preserves the verified staging tree, so do not hash thousands of
      // dependency files a third time during the same activation.
      activeManifest = stagedManifest;
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

  if (!activeManifest) throw new Error("Managed package activation did not produce a verified tree.");
  const manifest = activeManifest;
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
  const existing = parsePackagePathEnvironment(environment.PI67_CAPABILITY_PACKAGE_PATHS, [managedCapabilitiesRoot]);
  environment.PI67_MANAGED_NPM_ROOT = active;
  environment.PI67_CAPABILITY_PACKAGE_PATHS = JSON.stringify([...new Set([...existing, ...packagePaths])]);
  environment.PI67_MANAGED_EXTENSION_PATHS = JSON.stringify(extensionPaths);
  if (platform !== "win32") await chmod(root, 0o700);
  return {
    enabled: true,
    activeRoot: active,
    packagePaths,
    extensionPaths,
    activated,
    projectionMode: "legacy-copy"
  };
}

async function verifyPackagedManagedPackageMetadata(
  root: string,
  platform: NodeJS.Platform,
  architecture: string
): Promise<ManagedPackageManifest> {
  const [rootMetadata, canonicalRoot] = await Promise.all([lstat(root), realpath(root)]);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error("Managed package bundle root is invalid.");
  }
  const manifest = parseManagedPackageManifest(await readBoundedJson(join(root, "manifest.json")));
  if (manifest.platform !== platform || manifest.architecture !== architecture) {
    throw new Error("Managed package bundle does not match the current platform.");
  }
  const lockPath = join(root, "package-lock.json");
  const lockMetadata = await lstat(lockPath);
  if (
    lockMetadata.isSymbolicLink()
    || !lockMetadata.isFile()
    || lockMetadata.size > MAX_METADATA_BYTES
    || sha256(await readFile(lockPath)) !== manifest.lockfileSha256
  ) throw new Error("Managed package bundle metadata failed integrity verification.");
  for (const entry of manifest.packages) {
    const packageRoot = containedPath(root, entry.packagePath, "Managed package path");
    const [packageMetadata, canonicalPackage] = await Promise.all([lstat(packageRoot), realpath(packageRoot)]);
    if (
      packageMetadata.isSymbolicLink()
      || !packageMetadata.isDirectory()
      || !isSameOrContained(canonicalPackage, canonicalRoot)
    ) throw new Error(`Managed package root is invalid: ${entry.id}`);
    const packageManifest = await lstat(join(packageRoot, "package.json"));
    if (packageManifest.isSymbolicLink() || !packageManifest.isFile() || packageManifest.size > MAX_METADATA_BYTES) {
      throw new Error(`Managed package metadata is invalid: ${entry.id}`);
    }
    for (const extensionPath of entry.extensionPaths) {
      const extension = containedPath(packageRoot, extensionPath, "Managed extension path");
      const [extensionMetadata, canonicalExtension] = await Promise.all([lstat(extension), realpath(extension)]);
      if (
        extensionMetadata.isSymbolicLink()
        || !extensionMetadata.isFile()
        || !isSameOrContained(canonicalExtension, canonicalPackage)
      ) throw new Error(`Managed extension is unavailable: ${entry.id}`);
    }
  }
  return manifest;
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
        if (
          fileCount > MAX_MANAGED_PACKAGE_TREE_FILES
          || totalBytes > MAX_MANAGED_PACKAGE_TREE_BYTES
        ) {
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
      await copyFile(input, output);
    } else {
      throw new Error(`Managed packages contain an unsupported entry: ${input}`);
    }
  }
}

function parsePackagePathEnvironment(value: string | undefined, roots: string[]): string[] {
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
    || parsed.some((path) => (
      typeof path !== "string" || !roots.some((root) => isSameOrContained(path, root))
    ))
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
  if (!isManagedPackageRelativePath(path)) throw new Error(`${label} is invalid.`);
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

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "boolean");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
