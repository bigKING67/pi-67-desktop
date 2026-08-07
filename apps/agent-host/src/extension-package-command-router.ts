import { createHash } from "node:crypto";
import type {
  ExtensionPackageManagement,
  PiWorkspaceRuntimeServices
} from "@pi67/pi-runtime";
import {
  PackageMutationReplayConflictError,
  packageSourceKind
} from "@pi67/pi-runtime";
import type { ExtensionPackageMutationResult } from "@pi67/domain";
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
    const fingerprint = mutationFingerprint(context, command);
    return this.runMutationLedger(ledger, idempotencyKey, fingerprint, () => (
      this.executeMutation(context.workspaceId, scope, command, idempotencyKey, fingerprint)
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
      case "extension.package.list": {
        await this.options.getWorkspaceServices(workspaceId).packageTrustRegistry.refresh();
        return management.list();
      }
      case "extension.package.checkUpdates":
        return management.checkForUpdates();
      default:
        throw new HostCommandError("INVALID_PAYLOAD", "The command is not an Extension package query.", false);
    }
  }

  private executeMutation(
    workspaceId: string,
    scope: "global" | "project",
    command: ExtensionPackageCommand,
    idempotencyKey: string,
    fingerprint: string
  ): Promise<ExtensionPackageResult> {
    return this.coordinator.runMutation(
      workspaceId,
      scope,
      () => isDurablePackageMutation(command)
        ? this.dispatchDurableMutation(workspaceId, command, idempotencyKey, fingerprint)
        : this.dispatchMutation(workspaceId, command)
    );
  }

  private async dispatchDurableMutation(
    workspaceId: string,
    command: DurablePackageMutationCommand,
    idempotencyKey: string,
    fingerprint: string
  ): Promise<ExtensionPackageMutationResult> {
    const services = this.options.getWorkspaceServices(workspaceId);
    const management = this.management(workspaceId);
    const { source, scope } = command.payload;
    const sourceKind = packageSourceKind(source);
    if (sourceKind === "bundled") {
      throw new HostCommandError(
        "UNSUPPORTED",
        "Bundled Pi-67 capabilities cannot be mutated through third-party package management.",
        false
      );
    }
    let reservation;
    try {
      reservation = await services.packageMutationReceipts.reserve({
        source,
        scope,
        sourceKind,
        operation: durableMutationOperation(command),
        idempotencyKey,
        fingerprint
      });
    } catch (error) {
      if (error instanceof PackageMutationReplayConflictError) {
        throw new HostCommandError(
          "DUPLICATE_REQUEST",
          "The idempotency key has already been used for a different durable Extension package mutation.",
          false
        );
      }
      throw error;
    }
    if (reservation.status === "replay") {
      await services.packageTrustRegistry.refresh();
      const current = management.list();
      const target = current.items.find((entry) => entry.source === source && entry.scope === scope);
      const receiptState = reservation.record.state === "active"
        && target?.trustState === "user-installed-observed"
        ? "active" as const
        : reservation.record.state === "removed" && target === undefined
          ? "removed" as const
          : "ambiguous" as const;
      return {
        ...current,
        changed: reservation.record.changed ?? false,
        receiptState
      };
    }

    await services.packageMutationReceipts.markMutating(source, scope, idempotencyKey);
    let mutationCompleted = false;
    try {
      const result = await this.dispatchMutation(workspaceId, command) as ExtensionPackageMutationResult;
      mutationCompleted = true;
      await services.packageTrustRegistry.refresh();
      if (command.type === "extension.package.uninstall") {
        const stillConfigured = management.list().items.some((entry) => (
          entry.source === source && entry.scope === scope
        ));
        if (stillConfigured) {
          await services.packageMutationReceipts.markAmbiguous(source, scope, idempotencyKey);
          await services.packageTrustRegistry.refresh();
          return { ...management.list(), changed: result.changed, receiptState: "ambiguous" };
        }
        await services.packageMutationReceipts.commitRemoved(source, scope, idempotencyKey, result.changed);
        await services.packageTrustRegistry.refresh();
        return { ...management.list(), changed: result.changed, receiptState: "removed" };
      }

      const observed = services.packageTrustRegistry.observationFor(source, scope);
      if (observed?.status !== "observed") {
        await services.packageMutationReceipts.markAmbiguous(source, scope, idempotencyKey);
        await services.packageTrustRegistry.refresh();
        return { ...management.list(), changed: result.changed, receiptState: "ambiguous" };
      }
      await services.packageMutationReceipts.commitActive(
        source,
        scope,
        idempotencyKey,
        observed.observation,
        result.changed
      );
      if (command.type === "extension.package.update") {
        for (const candidateScope of ["global", "project"] as const) {
          if (candidateScope === scope) continue;
          const candidate = services.packageTrustRegistry.observationFor(source, candidateScope);
          if (candidate?.status === "observed") {
            await services.packageMutationReceipts.refreshActiveObservation(
              source,
              candidateScope,
              candidate.observation
            );
          }
        }
      }
      await services.packageTrustRegistry.refresh();
      return { ...management.list(), changed: result.changed, receiptState: "active" };
    } catch (error) {
      try {
        await services.packageMutationReceipts.markAmbiguous(source, scope, idempotencyKey);
      } catch (receiptError) {
        throw new HostCommandError(
          "RUNTIME_POISONED",
          "The Extension package mutation failed and its durable receipt could not be reconciled.",
          false,
          { packageReceiptConsistent: false },
          { cause: new AggregateError([error, receiptError]) }
        );
      }
      if (mutationCompleted) {
        throw new HostCommandError(
          "RUNTIME_POISONED",
          "The Extension package mutation completed, but its durable receipt could not be committed safely.",
          false,
          { packageReceiptConsistent: true, packageMutationCompleted: true },
          { cause: error }
        );
      }
      throw error;
    }
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
    fingerprint: string,
    execute: () => Promise<ExtensionPackageResult>
  ): Promise<ExtensionPackageResult> {
    pruneLedger(ledger);
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

type DurablePackageMutationCommand = Extract<ExtensionPackageCommand, {
  type: "extension.package.install" | "extension.package.update" | "extension.package.uninstall";
}>;

function isDurablePackageMutation(command: ExtensionPackageCommand): command is DurablePackageMutationCommand {
  return command.type === "extension.package.install"
    || command.type === "extension.package.update"
    || command.type === "extension.package.uninstall";
}

function durableMutationOperation(command: DurablePackageMutationCommand): "install" | "update" | "uninstall" {
  if (command.type === "extension.package.install") return "install";
  if (command.type === "extension.package.update") return "update";
  return "uninstall";
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
