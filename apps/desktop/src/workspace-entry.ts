import { realpath } from "node:fs";
import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { WorkspaceEntryRequest, WorkspaceFileKind } from "@pi67/protocol";
import type { WorkbenchStateStore } from "./workbench-state.js";
import { refreshPersistedWorkspaceDescriptor } from "./workspace-identity.js";

const realpathNative = promisify(realpath.native);

export interface ResolvedWorkspaceEntry extends WorkspaceEntryRequest {
  absolutePath: string;
}

function parseWorkspaceEntryRequest(value: unknown): WorkspaceEntryRequest {
  if (!isExactRecord(value, ["workspaceId", "relativePath", "kind"])) {
    throw new Error("Workspace entry request is invalid.");
  }
  if (
    typeof value.workspaceId !== "string"
    || value.workspaceId.length === 0
    || value.workspaceId.length > 200
    || !/^[A-Za-z0-9._:-]+$/u.test(value.workspaceId)
  ) throw new Error("Workspace id is invalid.");
  if (!isWorkspaceRelativePath(value.relativePath)) throw new Error("Workspace entry path is invalid.");
  if (!isWorkspaceFileKind(value.kind)) throw new Error("Workspace entry kind is invalid.");
  return value as unknown as WorkspaceEntryRequest;
}

export async function resolveRegisteredWorkspaceEntry(
  workbenchState: WorkbenchStateStore,
  value: unknown
): Promise<ResolvedWorkspaceEntry> {
  const request = parseWorkspaceEntryRequest(value);
  const persisted = (await workbenchState.load()).state.workspaces.find((candidate) => (
    candidate.id === request.workspaceId
  ));
  if (!persisted) throw new Error("Workspace registration was not found.");
  const workspace = await refreshPersistedWorkspaceDescriptor(persisted);
  if (workspace.availability !== "available" || workspace.trust !== "trusted") {
    throw new Error("Workspace registration is unavailable or no longer trusted.");
  }
  const root = workspace.identity.canonicalPath;
  const candidate = resolve(root, ...request.relativePath.split("/"));
  assertContained(root, candidate);
  const metadata = await lstat(candidate);
  const actualKind = fileKind(metadata);
  if (actualKind !== request.kind) throw new Error("Workspace entry kind changed externally.");
  if (metadata.isSymbolicLink()) throw new Error("Symbolic links are not supported.");
  if (actualKind !== "file" && actualKind !== "directory") {
    throw new Error("Only regular Workspace files and directories are supported.");
  }
  const canonicalPath = await realpathNative(candidate);
  assertContained(root, canonicalPath);
  return { ...request, absolutePath: canonicalPath };
}

function isWorkspaceRelativePath(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 32_768
    || value.includes("\0")
    || value.includes("\\")
    || isAbsolute(value)
  ) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== "..")
    && segments[0] !== ".git";
}

function isWorkspaceFileKind(value: unknown): value is WorkspaceFileKind {
  return value === "file" || value === "directory" || value === "symlink" || value === "other";
}

function fileKind(metadata: Awaited<ReturnType<typeof lstat>>): WorkspaceFileKind {
  return metadata.isSymbolicLink()
    ? "symlink"
    : metadata.isDirectory()
      ? "directory"
      : metadata.isFile()
        ? "file"
        : "other";
}

function assertContained(root: string, candidate: string): void {
  const fromRoot = relative(normalizePath(root), normalizePath(candidate));
  if (fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))) return;
  throw new Error("Workspace entry escaped its registered root.");
}

function normalizePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}
