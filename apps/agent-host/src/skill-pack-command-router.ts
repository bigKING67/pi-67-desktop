import { createHash } from "node:crypto";
import type { PiWorkspaceRuntimeServices } from "@pi67/pi-runtime";
import type {
  AgentCommand,
  AgentCommandType,
  CommandResults,
  WorkspaceProtocolContext
} from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";
import { ResourceManagementCoordinator } from "./resource-management-coordinator.js";
import type { SkillPackManagementPort } from "./skill-pack-management.js";

export type SkillPackCommandType =
  | "skill.pack.list"
  | "skill.pack.checkUpdates"
  | "skill.pack.update"
  | "skill.pack.restore";

type SkillPackCommand = AgentCommand<SkillPackCommandType>;
type SkillPackResult = CommandResults[SkillPackCommandType];

export interface SkillPackCommandRouterOptions {
  getWorkspaceServices(workspaceId: string): PiWorkspaceRuntimeServices;
  createManagement(services: PiWorkspaceRuntimeServices): SkillPackManagementPort;
  coordinator: ResourceManagementCoordinator;
}

interface MutationRecord {
  readonly fingerprint: string;
  readonly promise: Promise<SkillPackResult>;
  settledAt?: number;
}

const MAX_LEDGER_ENTRIES = 32;
const LEDGER_RETENTION_MS = 5 * 60_000;

export class SkillPackCommandRouter {
  private readonly mutations = new Map<string, MutationRecord>();

  constructor(private readonly options: SkillPackCommandRouterOptions) {}

  dispatch(
    context: WorkspaceProtocolContext,
    command: SkillPackCommand,
    idempotencyKey?: string
  ): Promise<SkillPackResult> {
    if (command.type !== "skill.pack.update" && command.type !== "skill.pack.restore") {
      return this.options.coordinator.runQuery(
        context.workspaceId,
        () => this.dispatchQuery(context.workspaceId, command)
      );
    }
    if (!idempotencyKey) {
      return Promise.reject(new HostCommandError(
        "INVALID_PAYLOAD",
        "Replay-safe Skill Pack mutations require an idempotency key.",
        false
      ));
    }
    return this.runMutationLedger(idempotencyKey, context, command, () => (
      this.options.coordinator.runTransactionalMutation(
        context.workspaceId,
        "global",
        () => command.type === "skill.pack.update"
          ? this.management(context.workspaceId).beginUpdate(command.payload.id)
          : this.management(context.workspaceId).beginRestore(command.payload.id)
      )
    ));
  }

  private dispatchQuery(
    workspaceId: string,
    command: SkillPackCommand
  ): Promise<SkillPackResult> {
    const management = this.management(workspaceId);
    switch (command.type) {
      case "skill.pack.list":
        return management.list();
      case "skill.pack.checkUpdates":
        return management.checkForUpdates();
      default:
        throw new HostCommandError("INVALID_PAYLOAD", "The command is not a Skill Pack query.", false);
    }
  }

  private runMutationLedger(
    idempotencyKey: string,
    context: WorkspaceProtocolContext,
    command: SkillPackCommand,
    execute: () => Promise<SkillPackResult>
  ): Promise<SkillPackResult> {
    pruneLedger(this.mutations);
    const fingerprint = mutationFingerprint(context, command);
    const existing = this.mutations.get(idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new HostCommandError(
          "DUPLICATE_REQUEST",
          "The idempotency key has already been used for a different Skill Pack mutation.",
          false
        );
      }
      return existing.promise;
    }
    reserveLedgerEntry(this.mutations);
    let promise: Promise<SkillPackResult>;
    try {
      promise = execute();
    } catch (error) {
      promise = Promise.reject(error);
    }
    const record: MutationRecord = { fingerprint, promise };
    this.mutations.set(idempotencyKey, record);
    void record.promise.finally(() => { record.settledAt = Date.now(); }).catch(() => undefined);
    return record.promise;
  }

  private management(workspaceId: string): SkillPackManagementPort {
    return this.options.createManagement(this.options.getWorkspaceServices(workspaceId));
  }
}

export function isSkillPackCommand(type: AgentCommandType): type is SkillPackCommandType {
  return type === "skill.pack.list"
    || type === "skill.pack.checkUpdates"
    || type === "skill.pack.update"
    || type === "skill.pack.restore";
}

function mutationFingerprint(context: WorkspaceProtocolContext, command: SkillPackCommand): string {
  return createHash("sha256")
    .update(context.workspaceId, "utf8")
    .update("\0")
    .update(command.type, "utf8")
    .update("\0")
    .update(
      command.type === "skill.pack.update" || command.type === "skill.pack.restore"
        ? command.payload.id
        : "",
      "utf8"
    )
    .digest("hex");
}

function reserveLedgerEntry(ledger: Map<string, MutationRecord>): void {
  while (ledger.size >= MAX_LEDGER_ENTRIES) {
    const settled = [...ledger.entries()].find(([, record]) => record.settledAt !== undefined);
    if (!settled) {
      throw new HostCommandError(
        "RESOURCE_LIMIT_EXCEEDED",
        "Too many Skill Pack mutations are pending.",
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
