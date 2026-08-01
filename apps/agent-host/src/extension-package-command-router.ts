import { createHash } from "node:crypto";
import type {
  ExtensionPackageManagement,
  PiWorkspaceRuntimeServices
} from "@pi67/pi-runtime";
import type {
  AgentCommand,
  AgentCommandType,
  CommandResults,
  WorkspaceProtocolContext
} from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";
import {
  ResourceManagementCoordinator,
  type ResourceManagementTaskView
} from "./resource-management-coordinator.js";

export type ExtensionPackageCommandType =
  | "extension.package.list"
  | "extension.package.checkUpdates"
  | "extension.package.install"
  | "extension.package.update"
  | "extension.package.setEnabled"
  | "extension.package.restoreInheritance"
  | "extension.package.uninstall";

type ExtensionPackageCommand = AgentCommand<ExtensionPackageCommandType>;
type ExtensionPackageResult = CommandResults[ExtensionPackageCommandType];
export type ExtensionPackageManagementPort = Pick<ExtensionPackageManagement,
  | "list"
  | "checkForUpdates"
  | "install"
  | "update"
  | "setEnabled"
  | "restoreProjectInheritance"
  | "uninstall"
>;

export type ExtensionPackageTaskView = ResourceManagementTaskView;

export interface ExtensionPackageCommandRouterOptions {
  getWorkspaceServices(workspaceId: string): PiWorkspaceRuntimeServices;
  listTasks(): ExtensionPackageTaskView[];
  createManagement(services: PiWorkspaceRuntimeServices): ExtensionPackageManagementPort;
  coordinator?: ResourceManagementCoordinator;
  maxConcurrentQueries?: number;
}

interface MutationRecord {
  readonly fingerprint: string;
  readonly promise: Promise<ExtensionPackageResult>;
  settledAt?: number;
}

const MUTATION_TYPES = new Set<AgentCommandType>([
  "extension.package.install",
  "extension.package.update",
  "extension.package.setEnabled",
  "extension.package.restoreInheritance",
  "extension.package.uninstall"
]);

const MAX_LEDGER_ENTRIES = 32;
const LEDGER_RETENTION_MS = 5 * 60_000;

export class ExtensionPackageCommandRouter {
  private readonly globalMutations = new Map<string, MutationRecord>();
  private readonly projectMutations = new Map<string, Map<string, MutationRecord>>();
  private readonly coordinator: ResourceManagementCoordinator;

  constructor(private readonly options: ExtensionPackageCommandRouterOptions) {
    this.coordinator = options.coordinator ?? new ResourceManagementCoordinator({
      listTasks: () => options.listTasks(),
      ...(options.maxConcurrentQueries === undefined
        ? {}
        : { maxConcurrentQueries: options.maxConcurrentQueries })
    });
  }

  dispatch(
    context: WorkspaceProtocolContext,
    command: ExtensionPackageCommand,
    idempotencyKey?: string
  ): Promise<ExtensionPackageResult> {
    if (!isExtensionPackageMutation(command.type)) {
      return this.coordinator.runQuery(
        context.workspaceId,
        () => this.dispatchQuery(context.workspaceId, command)
      );
    }
    if (!idempotencyKey) {
      return Promise.reject(new HostCommandError(
        "INVALID_PAYLOAD",
        "Replay-safe Extension package mutations require an idempotency key.",
        false
      ));
    }
    const scope = mutationScope(command);
    const ledger = scope === "global"
      ? this.globalMutations
      : this.projectLedger(context.workspaceId);
    return this.runMutationLedger(ledger, idempotencyKey, context, command, () => (
      this.executeMutation(context.workspaceId, scope, command)
    ));
  }

  assertTaskCommandAllowed(workspaceId: string): void {
    this.coordinator.assertTaskCommandAllowed(workspaceId);
  }

  private async dispatchQuery(
    workspaceId: string,
    command: ExtensionPackageCommand
  ): Promise<ExtensionPackageResult> {
    const management = this.management(workspaceId);
    switch (command.type) {
      case "extension.package.list":
        return management.list();
      case "extension.package.checkUpdates":
        return management.checkForUpdates();
      default:
        throw new HostCommandError("INVALID_PAYLOAD", "The command is not an Extension package query.", false);
    }
  }

  private executeMutation(
    workspaceId: string,
    scope: "global" | "project",
    command: ExtensionPackageCommand
  ): Promise<ExtensionPackageResult> {
    return this.coordinator.runMutation(
      workspaceId,
      scope,
      () => this.dispatchMutation(workspaceId, command)
    );
  }

  private async dispatchMutation(
    workspaceId: string,
    command: ExtensionPackageCommand
  ): Promise<ExtensionPackageResult> {
    const management = this.management(workspaceId);
    switch (command.type) {
      case "extension.package.install":
        return management.install(command.payload.source, command.payload.scope);
      case "extension.package.update":
        return management.update(command.payload.source, command.payload.scope);
      case "extension.package.setEnabled":
        return management.setEnabled(
          command.payload.source,
          command.payload.scope,
          command.payload.enabled,
          command.payload.resourceType
        );
      case "extension.package.restoreInheritance":
        return management.restoreProjectInheritance(command.payload.source);
      case "extension.package.uninstall":
        return management.uninstall(command.payload.source, command.payload.scope);
      default:
        throw new HostCommandError("INVALID_PAYLOAD", "The command is not an Extension package mutation.", false);
    }
  }

  private runMutationLedger(
    ledger: Map<string, MutationRecord>,
    idempotencyKey: string,
    context: WorkspaceProtocolContext,
    command: ExtensionPackageCommand,
    execute: () => Promise<ExtensionPackageResult>
  ): Promise<ExtensionPackageResult> {
    pruneLedger(ledger);
    const fingerprint = mutationFingerprint(context, command);
    const existing = ledger.get(idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new HostCommandError(
          "DUPLICATE_REQUEST",
          "The idempotency key has already been used for a different Extension package mutation.",
          false
        );
      }
      return existing.promise;
    }
    reserveLedgerEntry(ledger);
    let promise: Promise<ExtensionPackageResult>;
    try {
      // Reserve the affected Workspace fence before another MessagePort request can be admitted.
      promise = execute();
    } catch (error) {
      promise = Promise.reject(error);
    }
    const record: MutationRecord = { fingerprint, promise };
    ledger.set(idempotencyKey, record);
    void record.promise.finally(() => { record.settledAt = Date.now(); }).catch(() => undefined);
    return record.promise;
  }

  private management(workspaceId: string): ExtensionPackageManagementPort {
    return this.options.createManagement(this.options.getWorkspaceServices(workspaceId));
  }

  private projectLedger(workspaceId: string): Map<string, MutationRecord> {
    const existing = this.projectMutations.get(workspaceId);
    if (existing) return existing;
    const ledger = new Map<string, MutationRecord>();
    this.projectMutations.set(workspaceId, ledger);
    return ledger;
  }
}

export function isExtensionPackageCommand(type: AgentCommandType): type is ExtensionPackageCommandType {
  return type === "extension.package.list"
    || type === "extension.package.checkUpdates"
    || MUTATION_TYPES.has(type);
}

function isExtensionPackageMutation(type: AgentCommandType): boolean {
  return MUTATION_TYPES.has(type);
}

function mutationScope(command: ExtensionPackageCommand): "global" | "project" {
  return command.type === "extension.package.restoreInheritance"
    || ("scope" in command.payload && command.payload.scope === "project")
    ? "project"
    : "global";
}

function mutationFingerprint(context: WorkspaceProtocolContext, command: ExtensionPackageCommand): string {
  return createHash("sha256")
    .update(context.workspaceId, "utf8")
    .update("\0")
    .update(command.type, "utf8")
    .update("\0")
    .update(canonicalValue(command.payload), "utf8")
    .digest("hex");
}

function canonicalValue(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalValue(item)}`)
      .join(",")}}`;
  }
  throw new HostCommandError("INVALID_PAYLOAD", "The Extension package mutation cannot be fingerprinted.", false);
}

function reserveLedgerEntry(ledger: Map<string, MutationRecord>): void {
  while (ledger.size >= MAX_LEDGER_ENTRIES) {
    const settled = [...ledger.entries()].find(([, record]) => record.settledAt !== undefined);
    if (!settled) {
      throw new HostCommandError(
        "RESOURCE_LIMIT_EXCEEDED",
        "Too many Extension package mutations are pending.",
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
