import type { Stats } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { basename } from "node:path";
import {
  MAX_WORKSPACE_FILE_CONTENT_BYTES,
  MAX_WORKSPACE_FILE_PAGE_ITEMS,
  MAX_WORKSPACE_FILE_SEARCH_NODES,
  MAX_WORKSPACE_FILE_SEARCH_RESULTS,
  type WorkspaceFileEntry
} from "@pi67/domain";
import type {
  AgentCommand,
  AgentCommandType,
  CommandResults,
  WorkspaceProtocolContext
} from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";
import {
  assertWorkspaceRelativePath,
  compareWorkspaceFileEntries,
  isGitMetadataPath,
  joinWorkspaceRelativePath,
  parentWorkspaceRelativePath,
  safeWorkspaceFileByteLength,
  WorkspaceFileAccess,
  workspaceFileChanged
} from "./workspace-file-access.js";
import {
  isWorkspaceFileMutation,
  WorkspaceFileMutations
} from "./workspace-file-mutations.js";
import type { WorkspaceContextRegistry } from "./workspace-context-registry.js";

export type WorkspaceFileCommandType =
  | "workspace.file.list"
  | "workspace.file.search"
  | "workspace.file.resolve"
  | "workspace.file.open"
  | "workspace.file.save"
  | "workspace.file.create"
  | "workspace.file.rename";

type WorkspaceFileCommand = AgentCommand<WorkspaceFileCommandType>;
type WorkspaceFileResult = CommandResults[WorkspaceFileCommandType];

const SEARCH_SKIPPED_DIRECTORIES = new Set([
  ".cache",
  ".next",
  ".pnpm",
  ".turbo",
  "artifacts",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "release"
]);

export class WorkspaceFileCommandRouter {
  private readonly access: WorkspaceFileAccess;
  private readonly mutations: WorkspaceFileMutations;

  constructor(workspaces: WorkspaceContextRegistry) {
    this.access = new WorkspaceFileAccess(workspaces);
    this.mutations = new WorkspaceFileMutations(this.access);
  }

  dispatch(
    context: WorkspaceProtocolContext,
    command: WorkspaceFileCommand,
    idempotencyKey?: string
  ): Promise<WorkspaceFileResult> {
    if (isWorkspaceFileMutation(command)) {
      if (!idempotencyKey) {
        return Promise.reject(new HostCommandError(
          "INVALID_PAYLOAD",
          "Replay-safe Workspace file mutations require an idempotency key.",
          false
        ));
      }
      return this.mutations.dispatch(context, command, idempotencyKey);
    }
    if (command.type === "workspace.file.list") return this.list(context, command.payload);
    if (command.type === "workspace.file.search") return this.search(context, command.payload);
    if (command.type === "workspace.file.resolve") return this.resolveEntry(context, command.payload.relativePath);
    return this.openFile(context, command.payload.id);
  }

  private async list(
    context: WorkspaceProtocolContext,
    payload: Extract<WorkspaceFileCommand, { type: "workspace.file.list" }>["payload"]
  ): Promise<CommandResults["workspace.file.list"]> {
    const workspace = this.access.requireTrustedWorkspace(context.workspaceId);
    const parent = payload.parentId === undefined
      ? { relativePath: "", kind: "directory" as const }
      : this.access.requireIdentity(context.workspaceId, payload.parentId);
    if (parent.kind !== "directory" || isGitMetadataPath(parent.relativePath)) {
      throw new HostCommandError("UNSUPPORTED", "This Workspace entry cannot be expanded.", true);
    }
    const directory = await this.access.resolveContainedPath(
      workspace.canonicalCwd,
      parent.relativePath,
      "directory"
    );
    const names = (await readdir(directory.path)).filter((name) => name !== ".git");
    const entries = (await Promise.all(names.map((name) => this.access.projectEntry(
      context.workspaceId,
      workspace.canonicalCwd,
      parent.relativePath,
      name
    )))).sort(compareWorkspaceFileEntries);
    const offset = parseCursor(payload.cursor);
    const limit = Math.min(MAX_WORKSPACE_FILE_PAGE_ITEMS, payload.limit ?? MAX_WORKSPACE_FILE_PAGE_ITEMS);
    const pageEntries = entries.slice(offset, offset + limit);
    const nextOffset = offset + pageEntries.length;
    return {
      workspaceId: context.workspaceId,
      ...(payload.parentId === undefined ? {} : { parentId: payload.parentId }),
      entries: pageEntries,
      ...(nextOffset < entries.length ? { nextCursor: String(nextOffset) } : {}),
      truncated: nextOffset < entries.length
    };
  }

  private async search(
    context: WorkspaceProtocolContext,
    payload: Extract<WorkspaceFileCommand, { type: "workspace.file.search" }>["payload"]
  ): Promise<CommandResults["workspace.file.search"]> {
    const workspace = this.access.requireTrustedWorkspace(context.workspaceId);
    const query = payload.query.trim();
    if (!query) throw new HostCommandError("INVALID_PAYLOAD", "A file search query is required.", false);
    const needle = query.toLocaleLowerCase();
    const entries: WorkspaceFileEntry[] = [];
    const directories = [""];
    let visited = 0;
    while (
      directories.length > 0
      && entries.length < MAX_WORKSPACE_FILE_SEARCH_RESULTS
      && visited < MAX_WORKSPACE_FILE_SEARCH_NODES
    ) {
      const directoryRelativePath = directories.shift();
      if (directoryRelativePath === undefined) break;
      const directory = await this.access.resolveContainedPath(
        workspace.canonicalCwd,
        directoryRelativePath,
        "directory"
      );
      let names: string[];
      try {
        names = await readdir(directory.path);
      } catch {
        continue;
      }
      names.sort((left, right) => left.localeCompare(right));
      for (const name of names) {
        if (visited >= MAX_WORKSPACE_FILE_SEARCH_NODES) break;
        visited += 1;
        const relativePath = joinWorkspaceRelativePath(directoryRelativePath, name);
        let entry: WorkspaceFileEntry;
        try {
          entry = await this.access.projectEntry(
            context.workspaceId,
            workspace.canonicalCwd,
            directoryRelativePath,
            name
          );
        } catch {
          continue;
        }
        const skipDirectory = entry.kind === "directory" && (
          name === ".git" || (!payload.includeGenerated && SEARCH_SKIPPED_DIRECTORIES.has(name))
        );
        if (!skipDirectory && relativePath.toLocaleLowerCase().includes(needle)) entries.push(entry);
        if (entries.length >= MAX_WORKSPACE_FILE_SEARCH_RESULTS) break;
        if (entry.kind === "directory" && !skipDirectory) directories.push(relativePath);
      }
    }
    return {
      workspaceId: context.workspaceId,
      query,
      entries,
      truncated: entries.length >= MAX_WORKSPACE_FILE_SEARCH_RESULTS
        || visited >= MAX_WORKSPACE_FILE_SEARCH_NODES
        || directories.length > 0,
      visited
    };
  }

  private async resolveEntry(
    context: WorkspaceProtocolContext,
    relativePath: string
  ): Promise<CommandResults["workspace.file.resolve"]> {
    const workspace = this.access.requireTrustedWorkspace(context.workspaceId);
    assertWorkspaceRelativePath(relativePath);
    return {
      entry: await this.access.projectEntry(
        context.workspaceId,
        workspace.canonicalCwd,
        parentWorkspaceRelativePath(relativePath),
        basename(relativePath)
      )
    };
  }

  private async openFile(
    context: WorkspaceProtocolContext,
    id: string
  ): Promise<CommandResults["workspace.file.open"]> {
    const workspace = this.access.requireTrustedWorkspace(context.workspaceId);
    const identity = this.access.requireIdentity(context.workspaceId, id);
    if (identity.kind !== "file") {
      const entry = await this.access.entryForIdentity(
        context.workspaceId,
        workspace.canonicalCwd,
        id,
        identity
      );
      return {
        id,
        relativePath: identity.relativePath,
        kind: "unsupported",
        totalBytes: entry.byteLength ?? 0,
        revision: entry.revision,
        reason: identity.kind === "symlink" ? "符号链接不支持在 Pi-67 中打开。" : "只有普通文件可以编辑。"
      };
    }
    const resolved = await this.access.resolveContainedPath(workspace.canonicalCwd, identity.relativePath, "file");
    const totalBytes = safeWorkspaceFileByteLength(resolved.stats.size);
    const initialRevision = this.access.revision(context.workspaceId, identity.relativePath, resolved.stats);
    if (totalBytes > MAX_WORKSPACE_FILE_CONTENT_BYTES) {
      return {
        id,
        relativePath: identity.relativePath,
        kind: "oversized",
        totalBytes,
        revision: initialRevision,
        reason: "文件超过 2 MiB，请使用系统默认应用打开。"
      };
    }
    const handle = await open(resolved.path, "r");
    let buffer: Buffer;
    let finalStats: Stats;
    try {
      const before = await handle.stat();
      const readBuffer = Buffer.alloc(
        Math.min(safeWorkspaceFileByteLength(before.size), MAX_WORKSPACE_FILE_CONTENT_BYTES) + 1
      );
      const { bytesRead } = await handle.read(readBuffer, 0, readBuffer.length, 0);
      buffer = readBuffer.subarray(0, bytesRead);
      finalStats = await handle.stat();
      if (this.access.revision(context.workspaceId, identity.relativePath, before)
        !== this.access.revision(context.workspaceId, identity.relativePath, finalStats)) {
        throw workspaceFileChanged();
      }
    } finally {
      await handle.close();
    }
    const revision = this.access.revision(context.workspaceId, identity.relativePath, finalStats);
    if (buffer.length > MAX_WORKSPACE_FILE_CONTENT_BYTES) {
      return {
        id,
        relativePath: identity.relativePath,
        kind: "oversized",
        totalBytes: safeWorkspaceFileByteLength(finalStats.size),
        revision,
        reason: "文件超过 2 MiB，请使用系统默认应用打开。"
      };
    }
    if (buffer.includes(0)) {
      return {
        id,
        relativePath: identity.relativePath,
        kind: "binary",
        totalBytes: safeWorkspaceFileByteLength(finalStats.size),
        revision,
        reason: "二进制文件不支持内置编辑。"
      };
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      return {
        id,
        relativePath: identity.relativePath,
        kind: "binary",
        totalBytes: safeWorkspaceFileByteLength(finalStats.size),
        revision,
        reason: "文件不是有效的 UTF-8 文本。"
      };
    }
    return {
      id,
      relativePath: identity.relativePath,
      kind: "text",
      totalBytes: safeWorkspaceFileByteLength(finalStats.size),
      revision,
      content
    };
  }
}

export function isWorkspaceFileCommand(type: AgentCommandType): type is WorkspaceFileCommandType {
  return type === "workspace.file.list"
    || type === "workspace.file.search"
    || type === "workspace.file.resolve"
    || type === "workspace.file.open"
    || type === "workspace.file.save"
    || type === "workspace.file.create"
    || type === "workspace.file.rename";
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^\d+$/u.test(cursor)) {
    throw new HostCommandError("INVALID_PAYLOAD", "The file page cursor is invalid.", false);
  }
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new HostCommandError("INVALID_PAYLOAD", "The file page cursor is invalid.", false);
  }
  return offset;
}
