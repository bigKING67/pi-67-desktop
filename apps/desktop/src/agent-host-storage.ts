import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentHostStoragePaths } from "./agent-host-environment.js";

export function createAgentHostStoragePaths(userData: string): AgentHostStoragePaths {
  const root = ensureDirectory(resolve(userData), true);
  const projections = ensureDirectory(join(root, "projections"), false);
  const sessionCatalogDirectory = ensureDirectory(join(projections, "session-catalog"), false);
  if (!isContained(sessionCatalogDirectory, root)) {
    throw new Error("Session Catalog storage escaped the Electron userData directory.");
  }
  return {
    storageRoot: root,
    capabilityProbeDirectory: root,
    sessionCatalogDirectory
  };
}

function ensureDirectory(path: string, recursive: boolean): string {
  const requested = resolve(path);
  try {
    const before = lstatSync(requested);
    if (before.isSymbolicLink() || !before.isDirectory()) {
      throw new Error("Agent Host storage path must be a real directory.");
    }
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
    mkdirSync(requested, { recursive, mode: 0o700 });
  }
  const after = lstatSync(requested);
  if (after.isSymbolicLink() || !after.isDirectory()) {
    throw new Error("Agent Host storage path must be a real directory.");
  }
  const canonical = realpathSync(requested);
  if (process.platform === "win32" && !samePath(canonical, requested)) {
    throw new Error("Agent Host storage path contains reparse-point indirection.");
  }
  return canonical;
}

function isContained(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedRoot = normalizePath(root);
  const fromRoot = relative(normalizedRoot, normalizedCandidate);
  return fromRoot === "" || (
    fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot)
  );
}

function samePath(left: string, right: string): boolean {
  return normalizePath(resolve(left)) === normalizePath(resolve(right));
}

function normalizePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
