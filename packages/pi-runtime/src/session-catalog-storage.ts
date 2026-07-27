import { lstatSync, realpathSync, rmSync, type Stats } from "node:fs";
import { chmod, lstat, mkdir, realpath, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export interface SessionCatalogPermissionOperations {
  chmod(path: string, mode: number): Promise<void>;
  stat(path: string): Promise<Pick<Stats, "mode" | "uid">>;
  effectiveUserId(): number | undefined;
}

const nodePermissionOperations: SessionCatalogPermissionOperations = {
  chmod,
  stat,
  effectiveUserId: () => typeof process.geteuid === "function" ? process.geteuid() : undefined
};

export async function prepareSessionCatalogDirectory(
  directory: string,
  expectedRoot?: string,
  permissionOperations: SessionCatalogPermissionOperations = nodePermissionOperations
): Promise<string> {
  const requested = resolve(directory);
  const root = expectedRoot === undefined
    ? undefined
    : await prepareExpectedRoot(expectedRoot, requested);
  let info = await readPathInfo(requested);
  if (!info) {
    await mkdir(requested, { mode: 0o700 });
    info = await lstat(requested);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("Session Catalog directory must be a real directory.");
  }
  const canonical = await realpath(requested);
  if (root !== undefined) {
    assertContained(canonical, root);
    if (!samePath(canonical, requested)) {
      throw new Error("Session Catalog directory contains link-based indirection.");
    }
  }
  await enforcePrivateSessionCatalogPermissions(canonical, 0o700, "directory", permissionOperations);
  return canonical;
}

export async function enforcePrivateSessionCatalogPermissions(
  path: string,
  requiredMode: number,
  kind: "database" | "directory",
  operations: SessionCatalogPermissionOperations = nodePermissionOperations
): Promise<void> {
  if (process.platform === "win32") return;
  await operations.chmod(path, requiredMode);
  const info = await operations.stat(path);
  if ((info.mode & 0o777) !== requiredMode) {
    throw new Error(`Session Catalog ${kind} permissions are not private.`);
  }
  const effectiveUserId = operations.effectiveUserId();
  if (effectiveUserId !== undefined && info.uid !== effectiveUserId) {
    throw new Error(`Session Catalog ${kind} is not owned by the current user.`);
  }
}

export async function sessionCatalogFileExists(path: string): Promise<boolean> {
  const info = await readPathInfo(path);
  if (!info) return false;
  if (info.isSymbolicLink() || !info.isFile() || info.nlink > 1) {
    throw new Error("Session Catalog storage file is not a private regular file.");
  }
  if (!samePath(await realpath(path), resolve(path))) {
    throw new Error("Session Catalog storage file contains link-based indirection.");
  }
  return true;
}

export async function removeSessionCatalogRecovery(path: string): Promise<void> {
  if (!await sessionCatalogFileExists(path)) return;
  await rm(path, { force: true });
}

export function removeSessionCatalogRecoverySync(path: string): void {
  let info: ReturnType<typeof lstatSync> | undefined;
  try {
    info = lstatSync(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile() || info.nlink > 1) {
    throw new Error("Session Catalog recovery file is not a private regular file.");
  }
  if (!samePath(realpathSync(path), resolve(path))) {
    throw new Error("Session Catalog recovery file contains link-based indirection.");
  }
  rmSync(path, { force: true });
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function prepareExpectedRoot(expectedRoot: string, directory: string): Promise<string> {
  const requestedRoot = resolve(expectedRoot);
  const rootInfo = await readPathInfo(requestedRoot);
  if (!rootInfo || rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("Session Catalog storage root must be a real directory.");
  }
  const root = await realpath(requestedRoot);
  assertContained(directory, root);
  const fromRoot = relative(normalizePath(root), normalizePath(directory));
  let candidate = root;
  for (const segment of fromRoot.split(sep).filter(Boolean)) {
    candidate = join(candidate, segment);
    const info = await readPathInfo(candidate);
    if (!info) break;
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("Session Catalog directory contains link-based indirection.");
    }
    if (!samePath(await realpath(candidate), candidate)) {
      throw new Error("Session Catalog directory contains link-based indirection.");
    }
  }
  return root;
}

function assertContained(candidate: string, root: string): void {
  const fromRoot = relative(normalizePath(root), normalizePath(candidate));
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("Session Catalog directory escaped its Main-owned storage root.");
  }
}

async function readPathInfo(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  return lstat(path).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  });
}

function samePath(left: string, right: string): boolean {
  return normalizePath(resolve(left)) === normalizePath(resolve(right));
}

function normalizePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}
