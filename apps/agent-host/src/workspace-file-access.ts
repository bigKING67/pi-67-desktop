import { createHmac, randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import {
  MAX_WORKSPACE_FILE_NAME_CHARS,
  type WorkspaceFileEntry,
  type WorkspaceFileKind
} from "@pi67/domain";
import { HostCommandError } from "./protocol-error.js";
import type { WorkspaceContextRegistry } from "./workspace-context-registry.js";

export interface WorkspaceFileIdentity {
  readonly workspaceId: string;
  readonly relativePath: string;
  readonly kind: WorkspaceFileKind;
}

interface WorkspaceIdentityIndex {
  readonly byId: Map<string, WorkspaceFileIdentity>;
  readonly byPath: Map<string, string>;
}

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export class WorkspaceFileAccess {
  private readonly secret = randomBytes(32);
  private readonly identities = new Map<string, WorkspaceIdentityIndex>();

  constructor(private readonly workspaces: WorkspaceContextRegistry) {}

  requireTrustedWorkspace(workspaceId: string) {
    const workspace = this.workspaces.require(workspaceId);
    if (workspace.initialization.trust !== "trusted") {
      throw new HostCommandError(
        "WORKSPACE_NOT_TRUSTED",
        "Trust this Workspace before accessing its files.",
        true
      );
    }
    return workspace;
  }

  requireIdentity(workspaceId: string, id: string): WorkspaceFileIdentity {
    const identity = this.identities.get(workspaceId)?.byId.get(id);
    if (!identity || identity.workspaceId !== workspaceId) {
      throw new HostCommandError("RESOURCE_NOT_FOUND", "The Workspace file reference is stale or unknown.", true);
    }
    return identity;
  }

  async projectEntry(
    workspaceId: string,
    workspaceRoot: string,
    parentPath: string,
    name: string
  ): Promise<WorkspaceFileEntry> {
    const relativePath = joinWorkspaceRelativePath(parentPath, name);
    assertWorkspaceRelativePath(relativePath);
    const path = resolve(workspaceRoot, relativePath);
    assertWorkspacePathContained(workspaceRoot, path);
    const stats = await lstat(path);
    const kind = workspaceFileKind(stats);
    if (kind !== "symlink") {
      assertWorkspacePathContained(workspaceRoot, await realpath(path));
    }
    const id = this.remember(workspaceId, relativePath, kind);
    return projectWorkspaceFileEntry(
      id,
      name,
      relativePath,
      kind,
      stats,
      this.revision(workspaceId, relativePath, stats)
    );
  }

  async entryForIdentity(
    workspaceId: string,
    workspaceRoot: string,
    id: string,
    identity: WorkspaceFileIdentity
  ): Promise<WorkspaceFileEntry> {
    const path = resolve(workspaceRoot, identity.relativePath);
    assertWorkspacePathContained(workspaceRoot, path);
    const stats = await lstat(path);
    const kind = workspaceFileKind(stats);
    if (kind !== identity.kind) throw workspaceFileChanged("文件类型已在外部改变。");
    if (kind !== "symlink") assertWorkspacePathContained(workspaceRoot, await realpath(path));
    return projectWorkspaceFileEntry(
      id,
      basename(identity.relativePath),
      identity.relativePath,
      kind,
      stats,
      this.revision(workspaceId, identity.relativePath, stats)
    );
  }

  updateIdentitiesAfterRename(workspaceId: string, previousPath: string, nextPath: string): void {
    const index = this.identities.get(workspaceId);
    if (!index) return;
    const affected = [...index.byId.entries()].filter(([, identity]) => (
      identity.relativePath === previousPath || identity.relativePath.startsWith(`${previousPath}/`)
    ));
    for (const [id, identity] of affected) {
      index.byPath.delete(identity.relativePath);
      const relativePath = `${nextPath}${identity.relativePath.slice(previousPath.length)}`;
      index.byPath.set(relativePath, id);
      index.byId.set(id, { ...identity, relativePath });
    }
  }

  async resolveContainedPath(
    workspaceRoot: string,
    relativePath: string,
    expectedKind: "directory" | "file"
  ): Promise<{ path: string; stats: Stats }> {
    if (relativePath) assertWorkspaceRelativePath(relativePath);
    const path = resolve(workspaceRoot, relativePath || ".");
    assertWorkspacePathContained(workspaceRoot, path);
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) throw new HostCommandError("UNSUPPORTED", "Symbolic links are not followed.", true);
    if (expectedKind === "directory" ? !stats.isDirectory() : !stats.isFile()) {
      throw new HostCommandError("UNSUPPORTED", `The Workspace entry is not a regular ${expectedKind}.`, true);
    }
    const canonicalPath = await realpath(path);
    assertWorkspacePathContained(workspaceRoot, canonicalPath);
    return { path: canonicalPath, stats };
  }

  revision(workspaceId: string, relativePath: string, stats: Stats): string {
    return createHmac("sha256", this.secret)
      .update(workspaceId)
      .update("\0")
      .update(relativePath)
      .update("\0")
      .update(String(stats.dev))
      .update(":")
      .update(String(stats.ino))
      .update(":")
      .update(String(stats.size))
      .update(":")
      .update(String(stats.mtimeMs))
      .update(":")
      .update(String(stats.ctimeMs))
      .digest("base64url");
  }

  private remember(workspaceId: string, relativePath: string, kind: WorkspaceFileKind): string {
    let index = this.identities.get(workspaceId);
    if (!index) {
      index = { byId: new Map(), byPath: new Map() };
      this.identities.set(workspaceId, index);
    }
    const existing = index.byPath.get(relativePath);
    if (existing) {
      index.byId.set(existing, { workspaceId, relativePath, kind });
      return existing;
    }
    const id = createHmac("sha256", this.secret)
      .update(workspaceId)
      .update("\0")
      .update(relativePath)
      .digest("base64url")
      .slice(0, 32);
    index.byPath.set(relativePath, id);
    index.byId.set(id, { workspaceId, relativePath, kind });
    return id;
  }
}

export function assertWorkspaceFileName(name: string): void {
  if (
    name.length === 0
    || name.length > MAX_WORKSPACE_FILE_NAME_CHARS
    || name === "."
    || name === ".."
    || name.includes("\\")
    || name.includes("/")
    || Array.from(name).some((character) => character.charCodeAt(0) <= 0x1f)
    || /[ .]$/u.test(name)
    || WINDOWS_RESERVED_NAME.test(name)
  ) throw new HostCommandError("INVALID_PAYLOAD", "The Workspace file name is invalid.", false);
  if (name === ".git") {
    throw new HostCommandError("UNSUPPORTED", "Git metadata cannot be managed from Files.", false);
  }
}

export function assertWorkspaceRelativePath(relativePath: string): void {
  if (
    !relativePath
    || isAbsolute(relativePath)
    || relativePath.includes("\0")
    || relativePath.includes("\\")
  ) throw workspacePathOutsideRoot();
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw workspacePathOutsideRoot();
  }
  if (isGitMetadataPath(relativePath)) {
    throw new HostCommandError("UNSUPPORTED", "Git metadata is not available through Workspace Files.", false);
  }
}

export function joinWorkspaceRelativePath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function parentWorkspaceRelativePath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export function compareWorkspaceFileEntries(left: WorkspaceFileEntry, right: WorkspaceFileEntry): number {
  const leftRank = left.kind === "directory" ? 0 : left.kind === "file" ? 1 : 2;
  const rightRank = right.kind === "directory" ? 0 : right.kind === "file" ? 1 : 2;
  return leftRank - rightRank || left.name.localeCompare(right.name);
}

export function safeWorkspaceFileByteLength(value: number): number {
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(value)));
}

export function isGitMetadataPath(relativePath: string): boolean {
  return relativePath === ".git" || relativePath.startsWith(".git/");
}

export function assertWorkspacePathContained(workspaceRoot: string, candidate: string): void {
  const fromRoot = relative(workspaceRoot, candidate);
  if (fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot))) return;
  throw workspacePathOutsideRoot();
}

export function workspaceFileChanged(
  message = "文件已在外部发生变化，请重新读取后再试。"
): HostCommandError {
  return new HostCommandError("RESOURCE_CHANGED_EXTERNALLY", message, true);
}

export function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function projectWorkspaceFileEntry(
  id: string,
  name: string,
  relativePath: string,
  kind: WorkspaceFileKind,
  stats: Stats,
  revision: string
): WorkspaceFileEntry {
  return {
    id,
    name,
    relativePath,
    kind,
    revision,
    ...(kind === "file" ? { byteLength: safeWorkspaceFileByteLength(stats.size) } : {}),
    ...(Number.isFinite(stats.mtimeMs) ? { modifiedAt: Math.max(0, Math.trunc(stats.mtimeMs)) } : {})
  };
}

function workspaceFileKind(stats: Stats): WorkspaceFileKind {
  return stats.isSymbolicLink()
    ? "symlink"
    : stats.isDirectory()
      ? "directory"
      : stats.isFile()
        ? "file"
        : "other";
}

function workspacePathOutsideRoot(): HostCommandError {
  return new HostCommandError(
    "PATH_OUTSIDE_WORKSPACE",
    "The Workspace file reference is outside its registered root.",
    false
  );
}
