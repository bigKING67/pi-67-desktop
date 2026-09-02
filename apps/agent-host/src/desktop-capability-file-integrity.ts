import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { isContainedRelativePath } from "./desktop-capability-catalog.js";

const MAX_METADATA_BYTES = 1_000_000;

export async function copyCapabilityDirectory(
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
    const input = resolve(source, entry.name);
    const output = resolve(destination, entry.name);
    if (!isContainedPath(input, sourceRoot)) throw new Error("Desktop capability copy escaped its source root.");
    const child = await lstat(input);
    if (child.isSymbolicLink()) throw new Error(`Desktop capabilities cannot contain symlinks: ${input}`);
    if (child.isDirectory()) {
      await copyCapabilityDirectory(input, output, sourceRoot, includeNodeModules);
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
      const path = resolve(directory, entry.name);
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

async function capabilityDirectoryHashMatches(
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

export async function replaceCapabilityDirectoryIfChanged(options: {
  source: string;
  destination: string;
  expectedHash: string;
  containmentRoot: string;
  createToken: () => string;
  includeNodeModules?: boolean;
}): Promise<void> {
  const includeNodeModules = options.includeNodeModules === true;
  if (await capabilityDirectoryHashMatches(options.destination, options.expectedHash, includeNodeModules)) return;
  await mkdir(dirname(options.destination), { recursive: true, mode: 0o700 });
  const token = options.createToken();
  const staging = resolve(
    dirname(options.destination),
    `.${basename(options.destination)}.${process.pid}.${token}.staging`
  );
  const backup = resolve(
    dirname(options.destination),
    `.${basename(options.destination)}.${process.pid}.${token}.backup`
  );
  if (!isContainedPath(staging, options.containmentRoot) || !isContainedPath(backup, options.containmentRoot)) {
    throw new Error("Desktop capability staging path escaped its managed root.");
  }
  let staged = false;
  let backedUp = false;
  try {
    await copyCapabilityDirectory(options.source, staging, options.source, includeNodeModules);
    staged = true;
    if (await capabilityTreeSha256(staging, includeNodeModules) !== options.expectedHash) {
      throw new Error("Desktop capability copy failed integrity verification.");
    }
    try {
      await rename(options.destination, backup);
      backedUp = true;
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
    await rename(staging, options.destination);
    staged = false;
    if (backedUp) {
      await rm(backup, { recursive: true, force: true });
      backedUp = false;
    }
  } finally {
    if (staged) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    if (backedUp) {
      try {
        await rename(backup, options.destination);
      } catch {
        // Preserve the backup for manual recovery when the destination cannot be restored.
      }
    }
  }
}

export async function readBoundedCapabilityJson(path: string): Promise<unknown> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_METADATA_BYTES) {
    throw new Error("Desktop capability metadata must be a bounded regular file.");
  }
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export function containedCapabilityPath(root: string, path: string, label: string): string {
  if (!isContainedRelativePath(path)) throw new Error(`${label} is invalid.`);
  const candidate = resolve(root, path);
  if (!isContainedPath(candidate, root)) throw new Error(`${label} escaped its root.`);
  return candidate;
}

export function isContainedPath(candidate: string, root: string): boolean {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return fromRoot === "" || (
    fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot)
  );
}

export function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
