import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { MAX_WORKSPACE_FILE_CONTENT_BYTES } from "@pi67/domain";
import type { AgentCommand, CommandResults, WorkspaceProtocolContext } from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";
import {
  assertWorkspaceFileName,
  assertWorkspacePathContained,
  isGitMetadataPath,
  isNodeError,
  joinWorkspaceRelativePath,
  parentWorkspaceRelativePath,
  workspaceFileChanged,
  type WorkspaceFileAccess
} from "./workspace-file-access.js";

export type WorkspaceFileMutationCommand =
  | AgentCommand<"workspace.file.save">
  | AgentCommand<"workspace.file.create">
  | AgentCommand<"workspace.file.rename">;

type WorkspaceFileMutationResult = CommandResults[WorkspaceFileMutationCommand["type"]];

interface MutationRecord {
  readonly fingerprint: string;
  readonly promise: Promise<WorkspaceFileMutationResult>;
  settledAt?: number;
}

const MAX_LEDGER_ENTRIES = 64;
const LEDGER_RETENTION_MS = 5 * 60_000;

export function isWorkspaceFileMutation(
  command: AgentCommand
): command is WorkspaceFileMutationCommand {
  return command.type === "workspace.file.save"
    || command.type === "workspace.file.create"
    || command.type === "workspace.file.rename";
}

export class WorkspaceFileMutations {
  private readonly ledger = new Map<string, MutationRecord>();
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly access: WorkspaceFileAccess) {}

  dispatch(
    context: WorkspaceProtocolContext,
    command: WorkspaceFileMutationCommand,
    idempotencyKey: string
  ): Promise<WorkspaceFileMutationResult> {
    pruneLedger(this.ledger);
    const ledgerKey = `${context.workspaceId}:${idempotencyKey}`;
    const fingerprint = mutationFingerprint(context, command);
    const existing = this.ledger.get(ledgerKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new HostCommandError(
          "DUPLICATE_REQUEST",
          "The idempotency key has already been used for a different Workspace file mutation.",
          false
        );
      }
      return existing.promise;
    }
    reserveLedgerEntry(this.ledger);
    const promise = this.enqueue(context.workspaceId, async () => {
      if (command.type === "workspace.file.save") return this.save(context, command.payload);
      if (command.type === "workspace.file.create") return this.create(context, command.payload);
      return this.rename(context, command.payload);
    });
    const record: MutationRecord = { fingerprint, promise };
    this.ledger.set(ledgerKey, record);
    void promise.finally(() => { record.settledAt = Date.now(); }).catch(() => undefined);
    return promise;
  }

  private async save(
    context: WorkspaceProtocolContext,
    payload: Extract<WorkspaceFileMutationCommand, { type: "workspace.file.save" }>["payload"]
  ): Promise<CommandResults["workspace.file.save"]> {
    if (Buffer.byteLength(payload.content, "utf8") > MAX_WORKSPACE_FILE_CONTENT_BYTES) {
      throw new HostCommandError("RESOURCE_LIMIT_EXCEEDED", "Workspace file content exceeds 2 MiB.", false);
    }
    const workspace = this.access.requireTrustedWorkspace(context.workspaceId);
    const identity = this.access.requireIdentity(context.workspaceId, payload.id);
    if (identity.kind !== "file") {
      throw new HostCommandError("UNSUPPORTED", "Only regular Workspace files can be saved.", false);
    }
    const resolved = await this.access.resolveContainedPath(workspace.canonicalCwd, identity.relativePath, "file");
    if (this.access.revision(context.workspaceId, identity.relativePath, resolved.stats) !== payload.expectedRevision) {
      throw workspaceFileChanged();
    }
    const temporaryPath = resolve(
      dirname(resolved.path),
      `.${basename(resolved.path)}.pi67-${process.pid}-${randomUUID()}.tmp`
    );
    assertWorkspacePathContained(workspace.canonicalCwd, temporaryPath);
    let temporaryExists = false;
    try {
      const handle = await open(temporaryPath, "wx", resolved.stats.mode & 0o777);
      temporaryExists = true;
      try {
        await handle.writeFile(payload.content, { encoding: "utf8" });
        await handle.sync();
      } finally {
        await handle.close();
      }
      const latest = await lstat(resolved.path);
      if (this.access.revision(context.workspaceId, identity.relativePath, latest) !== payload.expectedRevision) {
        throw workspaceFileChanged();
      }
      await rename(temporaryPath, resolved.path);
      temporaryExists = false;
    } finally {
      if (temporaryExists) await unlink(temporaryPath).catch(() => undefined);
    }
    return {
      entry: await this.access.entryForIdentity(
        context.workspaceId,
        workspace.canonicalCwd,
        payload.id,
        identity
      )
    };
  }

  private async create(
    context: WorkspaceProtocolContext,
    payload: Extract<WorkspaceFileMutationCommand, { type: "workspace.file.create" }>["payload"]
  ): Promise<CommandResults["workspace.file.create"]> {
    assertWorkspaceFileName(payload.name);
    const workspace = this.access.requireTrustedWorkspace(context.workspaceId);
    const parent = payload.parentId === undefined
      ? { relativePath: "", kind: "directory" as const }
      : this.access.requireIdentity(context.workspaceId, payload.parentId);
    if (parent.kind !== "directory" || isGitMetadataPath(parent.relativePath)) {
      throw new HostCommandError("UNSUPPORTED", "The selected Workspace entry is not a writable directory.", false);
    }
    const directory = await this.access.resolveContainedPath(workspace.canonicalCwd, parent.relativePath, "directory");
    const target = resolve(directory.path, payload.name);
    assertWorkspacePathContained(workspace.canonicalCwd, target);
    try {
      if (payload.kind === "directory") await mkdir(target, { mode: 0o700 });
      else {
        const handle = await open(target, "wx", 0o600);
        await handle.close();
      }
    } catch (error) {
      if (isNodeError(error, "EEXIST")) throw workspaceFileChanged("目标名称已存在。");
      throw error;
    }
    return {
      entry: await this.access.projectEntry(
        context.workspaceId,
        workspace.canonicalCwd,
        parent.relativePath,
        payload.name
      )
    };
  }

  private async rename(
    context: WorkspaceProtocolContext,
    payload: Extract<WorkspaceFileMutationCommand, { type: "workspace.file.rename" }>["payload"]
  ): Promise<CommandResults["workspace.file.rename"]> {
    assertWorkspaceFileName(payload.name);
    const workspace = this.access.requireTrustedWorkspace(context.workspaceId);
    const identity = this.access.requireIdentity(context.workspaceId, payload.id);
    if (identity.kind !== "file" && identity.kind !== "directory") {
      throw new HostCommandError("UNSUPPORTED", "This Workspace entry cannot be renamed.", false);
    }
    const previousRelativePath = identity.relativePath;
    const parent = parentWorkspaceRelativePath(previousRelativePath);
    const nextRelativePath = joinWorkspaceRelativePath(parent, payload.name);
    if (nextRelativePath === previousRelativePath) {
      return {
        entry: await this.access.entryForIdentity(
          context.workspaceId,
          workspace.canonicalCwd,
          payload.id,
          identity
        ),
        previousRelativePath
      };
    }
    const source = await this.access.resolveContainedPath(
      workspace.canonicalCwd,
      previousRelativePath,
      identity.kind
    );
    const target = resolve(workspace.canonicalCwd, nextRelativePath);
    assertWorkspacePathContained(workspace.canonicalCwd, target);
    try {
      await lstat(target);
      throw workspaceFileChanged("目标名称已存在。");
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
    await rename(source.path, target);
    this.access.updateIdentitiesAfterRename(context.workspaceId, previousRelativePath, nextRelativePath);
    const updatedIdentity = this.access.requireIdentity(context.workspaceId, payload.id);
    return {
      entry: await this.access.entryForIdentity(
        context.workspaceId,
        workspace.canonicalCwd,
        payload.id,
        updatedIdentity
      ),
      previousRelativePath
    };
  }

  private enqueue<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(workspaceId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const settled = result.then(() => undefined, () => undefined);
    this.queues.set(workspaceId, settled);
    void settled.finally(() => {
      if (this.queues.get(workspaceId) === settled) this.queues.delete(workspaceId);
    });
    return result;
  }
}

function mutationFingerprint(
  context: WorkspaceProtocolContext,
  command: WorkspaceFileMutationCommand
): string {
  const hash = createHash("sha256")
    .update(context.workspaceId)
    .update("\0")
    .update(command.type)
    .update("\0");
  if (command.type === "workspace.file.save") {
    hash.update(command.payload.id)
      .update("\0")
      .update(command.payload.expectedRevision)
      .update("\0")
      .update(createHash("sha256").update(command.payload.content, "utf8").digest());
  } else if (command.type === "workspace.file.create") {
    hash.update(command.payload.parentId ?? "")
      .update("\0")
      .update(command.payload.name)
      .update("\0")
      .update(command.payload.kind);
  } else {
    hash.update(command.payload.id).update("\0").update(command.payload.name);
  }
  return hash.digest("hex");
}

function reserveLedgerEntry(ledger: Map<string, MutationRecord>): void {
  while (ledger.size >= MAX_LEDGER_ENTRIES) {
    const settled = [...ledger.entries()].find(([, record]) => record.settledAt !== undefined);
    if (!settled) {
      throw new HostCommandError(
        "RESOURCE_LIMIT_EXCEEDED",
        "Too many Workspace file mutations are pending.",
        true,
        { maximumPendingMutations: MAX_LEDGER_ENTRIES }
      );
    }
    ledger.delete(settled[0]);
  }
}

function pruneLedger(ledger: Map<string, MutationRecord>): void {
  const cutoff = Date.now() - LEDGER_RETENTION_MS;
  for (const [key, record] of ledger) {
    if (record.settledAt !== undefined && record.settledAt <= cutoff) ledger.delete(key);
  }
}
