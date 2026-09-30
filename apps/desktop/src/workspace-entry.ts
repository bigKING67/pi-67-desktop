import { realpath } from "node:fs";
import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { isWorkspaceEntryRequest, type WorkspaceEntryRequest, type WorkspaceFileKind } from "@pi67/protocol";
import type { WorkbenchStateStore } from "./workbench-state.js";
import { refreshPersistedWorkspaceDescriptor } from "./workspace-identity.js";

const realpathNative = promisify(realpath.native);

export interface ResolvedWorkspaceEntry extends WorkspaceEntryRequest {
  absolutePath: string;
}

/**
 * Reveal must never launch anything. Only a plain directory opens in the file manager; every other
 * entry is selected in its parent. On macOS an `.app` directory is an application bundle that
 * `shell.openPath` would run, so it is selected as well.
 */
export function workspaceEntryRevealAction(
  entry: Pick<ResolvedWorkspaceEntry, "kind" | "absolutePath">,
  platform: NodeJS.Platform = process.platform
): "show-in-folder" | "open-directory" {
  if (entry.kind !== "directory") return "show-in-folder";
  return platform === "darwin" && entry.absolutePath.toLowerCase().endsWith(".app") ? "show-in-folder" : "open-directory";
}

const LAUNCH_EXTENSIONS: Partial<Record<NodeJS.Platform, ReadonlySet<string>>> = {
  darwin: new Set([".app", ".command", ".tool", ".sh", ".pkg", ".mpkg", ".terminal", ".workflow", ".scpt", ".applescript", ".jar"]),
  win32: new Set([".exe", ".com", ".bat", ".cmd", ".msi", ".msix", ".appx", ".ps1", ".vbs", ".vbe", ".js", ".jse",
    ".wsf", ".wsh", ".scr", ".hta", ".lnk", ".reg", ".cpl", ".jar"]),
  linux: new Set([".sh", ".desktop", ".appimage", ".run", ".jar"])
};

/**
 * Whether opening the entry with the system default application would run code rather than show a
 * document: known launcher extensions, a macOS `.app` bundle, or a file with an execute bit on POSIX.
 */
export function workspaceEntryLaunchesCode(
  entry: Pick<ResolvedWorkspaceEntry, "kind" | "absolutePath">,
  mode: number,
  platform: NodeJS.Platform = process.platform
): boolean {
  const lower = entry.absolutePath.toLowerCase();
  const extension = lower.slice(Math.max(lower.lastIndexOf("."), lower.lastIndexOf("/") + 1, lower.lastIndexOf("\\") + 1));
  if (entry.kind === "directory") return platform === "darwin" && extension === ".app";
  if (entry.kind !== "file") return false;
  if (LAUNCH_EXTENSIONS[platform]?.has(extension)) return true;
  return platform !== "win32" && (mode & 0o111) !== 0;
}

function parseWorkspaceEntryRequest(value: unknown): WorkspaceEntryRequest {
  if (!isWorkspaceEntryRequest(value)) throw new Error("Workspace entry request is invalid.");
  // The protocol owns the shape; Main owns the filesystem policy for the relative path.
  if (!isWorkspaceRelativePath(value.relativePath)) throw new Error("Workspace entry path is invalid.");
  return value;
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
