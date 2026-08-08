import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export interface PreparedWorktreeProfilePath {
  root: string;
  groupRoot: string;
  targetPath: string;
  hooksPath: string;
}

export interface RecoveredWorktreeProfilePath {
  targetPath: string;
  exists: boolean;
}

export async function prepareWorktreeProfilePath(
  userData: string,
  repositoryGroupId: string,
  worktreeToken: string
): Promise<PreparedWorktreeProfilePath> {
  if (!isAbsolute(userData) || userData.includes("\0")) throw new Error("Worktree profile root is invalid.");
  if (!/^repo_[0-9a-f]{32}$/u.test(repositoryGroupId) || !/^[a-z0-9]{16}$/u.test(worktreeToken)) {
    throw new Error("Worktree profile identity is invalid.");
  }
  const requestedRoot = resolve(userData, "worktrees");
  await mkdir(requestedRoot, { recursive: true, mode: 0o700 });
  const canonicalUserData = await realpath(resolve(userData));
  await assertRealDirectory(requestedRoot);
  const root = await realpath(requestedRoot);
  if (!isContainedPath(canonicalUserData, root)) throw new Error("Worktree profile root escaped userData.");

  const requestedHooksPath = join(root, ".empty-hooks");
  await mkdir(requestedHooksPath, { recursive: true, mode: 0o700 });
  await assertRealDirectory(requestedHooksPath);
  const hooksPath = await realpath(requestedHooksPath);
  if ((await readdir(hooksPath)).length !== 0) throw new Error("Worktree hooks directory is not empty.");

  const requestedGroupRoot = join(root, repositoryGroupId);
  await mkdir(requestedGroupRoot, { recursive: true, mode: 0o700 });
  await assertRealDirectory(requestedGroupRoot);
  const groupRoot = await realpath(requestedGroupRoot);
  if (!isContainedPath(root, groupRoot)) throw new Error("Worktree Repository root escaped the profile root.");

  const targetPath = join(groupRoot, worktreeToken);
  if (!isContainedPath(groupRoot, targetPath)) throw new Error("Worktree target escaped its Repository root.");
  try {
    await lstat(targetPath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return { root, groupRoot, targetPath, hooksPath };
    throw error;
  }
  throw new Error("Worktree target already exists.");
}

export async function recoverWorktreeProfilePath(
  userData: string,
  repositoryGroupId: string,
  worktreeToken: string
): Promise<RecoveredWorktreeProfilePath> {
  if (!isAbsolute(userData) || userData.includes("\0")) throw new Error("Worktree profile root is invalid.");
  if (!/^repo_[0-9a-f]{32}$/u.test(repositoryGroupId) || !/^[a-z0-9]{16}$/u.test(worktreeToken)) {
    throw new Error("Worktree profile identity is invalid.");
  }
  const canonicalUserData = await realpath(resolve(userData));
  const requestedRoot = resolve(userData, "worktrees");
  const root = await recoverRealDirectory(requestedRoot);
  if (!root) {
    const targetPath = join(canonicalUserData, "worktrees", repositoryGroupId, worktreeToken);
    if (!isContainedPath(canonicalUserData, targetPath)) {
      throw new Error("Worktree target escaped userData.");
    }
    return { targetPath, exists: false };
  }
  if (!isContainedPath(canonicalUserData, root)) throw new Error("Worktree profile root escaped userData.");

  const requestedGroupRoot = join(root, repositoryGroupId);
  const groupRoot = await recoverRealDirectory(requestedGroupRoot);
  if (!groupRoot) {
    const targetPath = join(root, repositoryGroupId, worktreeToken);
    if (!isContainedPath(root, targetPath)) {
      throw new Error("Worktree target escaped the profile root.");
    }
    return { targetPath, exists: false };
  }
  if (!isContainedPath(root, groupRoot)) throw new Error("Worktree Repository root escaped the profile root.");

  const requestedTargetPath = join(groupRoot, worktreeToken);
  if (!isContainedPath(groupRoot, requestedTargetPath)) {
    throw new Error("Worktree target escaped its Repository root.");
  }
  const targetPath = await recoverRealDirectory(requestedTargetPath);
  if (!targetPath) return { targetPath: requestedTargetPath, exists: false };
  if (!isContainedPath(groupRoot, targetPath)) throw new Error("Worktree target escaped its Repository root.");
  return { targetPath, exists: true };
}

async function assertRealDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("Worktree profile path is not a real directory.");
  }
}

async function recoverRealDirectory(path: string): Promise<string | undefined> {
  try {
    await assertRealDirectory(path);
    return realpath(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined;
    throw error;
  }
}

function isContainedPath(parent: string, child: string): boolean {
  const value = relative(parent, child);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value));
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
