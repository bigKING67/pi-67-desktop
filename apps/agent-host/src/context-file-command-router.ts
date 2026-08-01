import { createHash } from "node:crypto";
import type {
  ContextFileManagementPort,
  PiWorkspaceRuntimeServices
} from "@pi67/pi-runtime";
import type {
  AgentCommand,
  AgentCommandType,
  CommandResults,
  WorkspaceProtocolContext
} from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";
import { ResourceManagementCoordinator } from "./resource-management-coordinator.js";

export type ContextFileCommandType =
  | "context.file.list"
  | "context.file.read"
  | "context.file.save";

type ContextFileCommand = AgentCommand<ContextFileCommandType>;
type ContextFileResult = CommandResults[ContextFileCommandType];

export interface ContextFileCommandRouterOptions {
  getWorkspaceServices(workspaceId: string): PiWorkspaceRuntimeServices;
  createManagement(services: PiWorkspaceRuntimeServices): ContextFileManagementPort;
  coordinator: ResourceManagementCoordinator;
}

interface MutationRecord {
  readonly fingerprint: string;
  readonly promise: Promise<ContextFileResult>;
  settledAt?: number;
}

const MAX_LEDGER_ENTRIES = 32;
const LEDGER_RETENTION_MS = 5 * 60_000;

export class ContextFileCommandRouter {
  private readonly mutations = new Map<string, MutationRecord>();

  constructor(private readonly options: ContextFileCommandRouterOptions) {}

  dispatch(
    context: WorkspaceProtocolContext,
    command: ContextFileCommand,
    idempotencyKey?: string
  ): Promise<ContextFileResult> {
    if (command.type !== "context.file.save") {
      return this.options.coordinator.runQuery(
        context.workspaceId,
        () => this.dispatchQuery(context.workspaceId, command)
      );
    }
    if (!idempotencyKey) {
      return Promise.reject(new HostCommandError(
        "INVALID_PAYLOAD",
        "Replay-safe context file mutations require an idempotency key.",
        false
      ));
    }
    return this.runMutationLedger(idempotencyKey, context, command, async () => {
      const management = this.management(context.workspaceId);
      const scope = await this.options.coordinator.runQuery(
        context.workspaceId,
        () => management.mutationScope(command.payload.id)
      );
      return this.options.coordinator.runTransactionalMutation(
        context.workspaceId,
        scope,
        () => management.beginSave(
          command.payload.id,
          command.payload.expectedRevision,
          command.payload.content
        )
      );
    });
  }

  private dispatchQuery(
    workspaceId: string,
    command: Exclude<ContextFileCommand, AgentCommand<"context.file.save">>
  ): Promise<ContextFileResult> {
    const management = this.management(workspaceId);
    if (command.type === "context.file.list") return management.list();
    if (command.type === "context.file.read") return management.read(command.payload.id);
    throw new HostCommandError("INVALID_PAYLOAD", "The command is not a context file query.", false);
  }

  private runMutationLedger(
    idempotencyKey: string,
    context: WorkspaceProtocolContext,
    command: AgentCommand<"context.file.save">,
    execute: () => Promise<ContextFileResult>
  ): Promise<ContextFileResult> {
    pruneLedger(this.mutations);
    const fingerprint = mutationFingerprint(context, command);
    const existing = this.mutations.get(idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new HostCommandError(
          "DUPLICATE_REQUEST",
          "The idempotency key has already been used for a different context file mutation.",
          false
        );
      }
      return existing.promise;
    }
    reserveLedgerEntry(this.mutations);
    let promise: Promise<ContextFileResult>;
    try {
      promise = execute();
    } catch (error) {
      promise = Promise.reject(error);
    }
    const record: MutationRecord = { fingerprint, promise };
    this.mutations.set(idempotencyKey, record);
    void promise.finally(() => { record.settledAt = Date.now(); }).catch(() => undefined);
    return promise;
  }

  private management(workspaceId: string): ContextFileManagementPort {
    return this.options.createManagement(this.options.getWorkspaceServices(workspaceId));
  }
}

export function isContextFileCommand(type: AgentCommandType): type is ContextFileCommandType {
  return type === "context.file.list"
    || type === "context.file.read"
    || type === "context.file.save";
}

function mutationFingerprint(
  context: WorkspaceProtocolContext,
  command: AgentCommand<"context.file.save">
): string {
  const contentDigest = createHash("sha256").update(command.payload.content, "utf8").digest();
  return createHash("sha256")
    .update(context.workspaceId, "utf8")
    .update("\0")
    .update(command.type, "utf8")
    .update("\0")
    .update(command.payload.id, "utf8")
    .update("\0")
    .update(command.payload.expectedRevision, "utf8")
    .update("\0")
    .update(contentDigest)
    .digest("hex");
}

function reserveLedgerEntry(ledger: Map<string, MutationRecord>): void {
  while (ledger.size >= MAX_LEDGER_ENTRIES) {
    const settled = [...ledger.entries()].find(([, record]) => record.settledAt !== undefined);
    if (!settled) {
      throw new HostCommandError(
        "RESOURCE_LIMIT_EXCEEDED",
        "Too many context file mutations are pending.",
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
