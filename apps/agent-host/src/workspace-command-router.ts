import type { AgentCommand, CommandResults, WorkspaceProtocolContext } from "@pi67/protocol";
import {
  searchWorkspaceSessionContent,
  type RuntimeCredentialOverrideStore
} from "@pi67/pi-runtime";
import type { HostEventChannel } from "./host-event-channel.js";
import { resolveAgentDirectory } from "./host-task-runtime-lifecycle.js";
import { HostCommandError } from "./protocol-error.js";
import type { SessionWriterLeaseRegistry } from "./session-writer-lease-registry.js";
import type { TaskRuntimeRegistry } from "./task-runtime-registry.js";
import {
  WorkspaceConversationCommandRouter,
  isWorkspaceConversationCommand,
  type WorkspaceConversationCommand,
  type WorkspaceConversationCommandType,
  type WorkspaceConversationResult
} from "./workspace-conversation-command-router.js";
import type { WorkspaceContextRegistry } from "./workspace-context-registry.js";
import { mutationFingerprint } from "./workspace-mutation-fingerprint.js";
import { createWorkspaceUsageReport } from "./workspace-usage-report.js";

export { isWorkspaceConversationCommand };

export type WorkspaceLifecycleCommandType = "workspace.register" | "workspace.unregister";
type WorkspaceLifecycleCommand = AgentCommand<WorkspaceLifecycleCommandType>;
type WorkspaceLifecycleResult = CommandResults[WorkspaceLifecycleCommandType];
export type WorkspaceProviderCommandType =
  | "provider.list"
  | "provider.setRuntimeKey"
  | "provider.configuration.get"
  | "provider.configuration.save"
  | "provider.configuration.remove"
  | "provider.credential.store"
  | "provider.credential.reveal"
  | "provider.credential.remove"
  | "model.default.set"
  | "provider.configuration.reload";
type WorkspaceProviderCommand = AgentCommand<WorkspaceProviderCommandType>;
type WorkspaceProviderResult = CommandResults[WorkspaceProviderCommandType];
type WorkspaceProviderMutationCommandType = Exclude<WorkspaceProviderCommandType,
  | "provider.list"
  | "provider.configuration.get"
  | "provider.configuration.reload"
  | "provider.credential.reveal">;
type WorkspaceProviderMutationCommand = AgentCommand<WorkspaceProviderMutationCommandType>;
type WorkspaceProviderMutationResult = CommandResults[WorkspaceProviderMutationCommandType];
type WorkspaceMutationCommandType = WorkspaceLifecycleCommandType
  | "provider.setRuntimeKey"
  | "provider.configuration.save"
  | "provider.configuration.remove"
  | "provider.credential.store"
  | "provider.credential.remove"
  | "model.default.set"
  | WorkspaceConversationCommandType;
type WorkspaceMutationCommand = AgentCommand<WorkspaceMutationCommandType>;
type WorkspaceMutationResult = CommandResults[WorkspaceMutationCommandType];

interface MutationRecord {
  readonly fingerprint: string;
  readonly promise: Promise<WorkspaceMutationResult>;
  state: "pending" | "settled";
  settledRevision?: number;
  settledAt?: number;
}

interface WorkspaceMutationLedger {
  revision: number;
  readonly records: Map<string, MutationRecord>;
}

const MAX_LEDGER_ENTRIES = 32;
const LEDGER_RETENTION_MS = 5 * 60_000;

export class WorkspaceCommandRouter {
  private readonly ledgers = new Map<string, WorkspaceMutationLedger>();
  private readonly pendingMutations = new Set<Promise<WorkspaceMutationResult>>();
  private readonly conversations: WorkspaceConversationCommandRouter;

  constructor(
    private readonly workspaces: WorkspaceContextRegistry,
    private readonly taskRuntimes: TaskRuntimeRegistry,
    private readonly runtimeCredentialOverrides: RuntimeCredentialOverrideStore,
    events: HostEventChannel,
    sessionWriterLeases: SessionWriterLeaseRegistry
  ) {
    this.conversations = new WorkspaceConversationCommandRouter(workspaces, sessionWriterLeases);
    this.workspaces.setEventSink((workspaceId, event) => {
      events.sendFor(event, {
        runtime: undefined,
        operations: undefined,
        context: { scope: "workspace", workspaceId }
      });
    });
  }

  async usageReport(
    context: WorkspaceProtocolContext,
    command: AgentCommand<"workspace.usage.report">,
    signal?: AbortSignal
  ): Promise<CommandResults["workspace.usage.report"]> {
    return createWorkspaceUsageReport(this.workspaces, context, command, signal);
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(this.pendingMutations);
  }

  dispatch(
    context: WorkspaceProtocolContext,
    command: WorkspaceLifecycleCommand,
    idempotencyKey?: string
  ): Promise<WorkspaceLifecycleResult> {
    if (!idempotencyKey) {
      return Promise.reject(new HostCommandError(
        "INVALID_PAYLOAD",
        "Replay-safe Workspace mutations require an idempotency key.",
        false
      ));
    }
    try {
      return this.runMutation(
        context.workspaceId,
        idempotencyKey,
        command,
        () => this.execute(context.workspaceId, command)
      ) as Promise<WorkspaceLifecycleResult>;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  dispatchProvider(
    context: WorkspaceProtocolContext,
    command: WorkspaceProviderCommand,
    idempotencyKey?: string
  ): Promise<WorkspaceProviderResult> {
    const workspace = this.workspaces.require(context.workspaceId);
    if (command.type === "provider.list") return workspace.workspaceServices.providerCatalog.list();
    const configuration = workspace.workspaceServices.configurationService;
    if (command.type === "provider.configuration.get") {
      return requireConfigurationService(configuration).get(workspace.cwd);
    }
    if (command.type === "provider.configuration.reload") {
      return requireConfigurationService(configuration).reload(workspace.cwd);
    }
    if (command.type === "provider.credential.reveal") {
      return requireConfigurationService(configuration).revealCredential(
        workspace.cwd,
        command.payload.expectedRevision,
        command.payload.provider
      );
    }
    if (!idempotencyKey) {
      return Promise.reject(new HostCommandError(
        "INVALID_PAYLOAD",
        "Replay-safe Workspace Provider mutations require an idempotency key.",
        false
      ));
    }
    try {
      const mutationCommand = command as WorkspaceProviderMutationCommand;
      return this.runMutation(
        context.workspaceId,
        idempotencyKey,
        mutationCommand,
        () => this.executeProviderMutation(workspace, mutationCommand)
      ) as Promise<WorkspaceProviderResult>;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private async executeProviderMutation(
    workspace: ReturnType<WorkspaceContextRegistry["require"]>,
    command: WorkspaceProviderMutationCommand
  ): Promise<WorkspaceProviderMutationResult> {
    if (command.type === "provider.setRuntimeKey") {
      await this.runtimeCredentialOverrides.set(command.payload.provider, command.payload.apiKey);
      return workspace.workspaceServices.providerCatalog.list();
    }
    const configuration = requireConfigurationService(workspace.workspaceServices.configurationService);
    switch (command.type) {
      case "provider.configuration.save":
        return configuration.saveProvider(
          workspace.cwd,
          command.payload.expectedRevision,
          command.payload.provider
        );
      case "provider.configuration.remove":
        return configuration.removeProvider(
          workspace.cwd,
          command.payload.expectedRevision,
          command.payload.provider
        );
      case "provider.credential.store":
        return configuration.storeCredential(
          workspace.cwd,
          command.payload.expectedRevision,
          command.payload.provider,
          command.payload.apiKey
        );
      case "provider.credential.remove":
        return configuration.removeCredential(
          workspace.cwd,
          command.payload.expectedRevision,
          command.payload.provider
        );
      case "model.default.set": {
        const { provider, model } = command.payload;
        if ((provider === undefined) !== (model === undefined)) {
          throw new HostCommandError(
            "INVALID_PAYLOAD",
            "A Pi default model requires both Provider and model identifiers.",
            false
          );
        }
        return configuration.setDefaultModel(
          workspace.cwd,
          command.payload.expectedRevision,
          command.payload.scope,
          provider === undefined || model === undefined ? undefined : { provider, model }
        );
      }
    }
  }

  queryCatalog(
    context: WorkspaceProtocolContext,
    command: AgentCommand<"session.catalog.query">
  ): Promise<CommandResults["session.catalog.query"]> {
    return this.workspaces.queryCatalog(context.workspaceId, command.payload);
  }

  async searchCatalogContent(
    context: WorkspaceProtocolContext,
    command: AgentCommand<"session.catalog.contentSearch">
  ): Promise<CommandResults["session.catalog.contentSearch"]> {
    const page = await this.workspaces.queryCatalog(context.workspaceId, {
      scope: "workspace",
      view: "active",
      limit: 100
    });
    return searchWorkspaceSessionContent({
      workspaceId: context.workspaceId,
      query: command.payload.query,
      sessions: page.items,
      catalogTotal: page.total,
      catalogIncomplete: page.incomplete || page.rebuilding || page.state === "unavailable",
      catalogSkippedCount: page.skippedCount
    });
  }

  resolveSessionCreation(
    context: WorkspaceProtocolContext,
    command: AgentCommand<"session.creation.resolve">,
    options: { signal?: AbortSignal } = {}
  ): Promise<CommandResults["session.creation.resolve"]> {
    return this.workspaces.require(context.workspaceId).workspaceServices.sessionCreationReceipts
      .resolve(command.payload.creationId, options);
  }

  dispatchConversation(
    context: WorkspaceProtocolContext,
    command: WorkspaceConversationCommand,
    idempotencyKey?: string
  ): Promise<WorkspaceConversationResult> {
    if (!idempotencyKey) {
      return Promise.reject(new HostCommandError(
        "INVALID_PAYLOAD",
        "Replay-safe conversation mutations require an idempotency key.",
        false
      ));
    }
    try {
      return this.runMutation(
        context.workspaceId,
        idempotencyKey,
        command,
        () => this.conversations.execute(context.workspaceId, command, idempotencyKey)
      ) as Promise<WorkspaceConversationResult>;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private async execute(
    workspaceId: string,
    command: WorkspaceLifecycleCommand
  ): Promise<WorkspaceLifecycleResult> {
    if (command.type === "workspace.register") {
      this.workspaces.register(workspaceId, {
        cwd: command.payload.cwd,
        agentDir: resolveAgentDirectory(undefined),
        trust: command.payload.trust,
        approvalMode: command.payload.approvalMode,
        runtimeCredentialOverrides: this.runtimeCredentialOverrides,
        ...(process.env.PI67_SESSION_CATALOG_DIR === undefined
          ? {}
          : { sessionCatalogDirectory: process.env.PI67_SESSION_CATALOG_DIR }),
        ...(process.env.PI67_STORAGE_ROOT === undefined
          ? {}
          : { storageRoot: process.env.PI67_STORAGE_ROOT })
      });
      return { registered: true };
    }
    const openTask = this.taskRuntimes.recordsForWorkspace(workspaceId)
      .find((record) => !record.closed);
    if (openTask) {
      throw new HostCommandError(
        "BUSY",
        "Close all open Pi Tasks before removing the Workspace from this runtime service.",
        true,
        { retryable: true, taskKey: openTask.taskKey }
      );
    }
    await this.workspaces.unregister(workspaceId);
    return { unregistered: true };
  }

  private runMutation(
    workspaceId: string,
    idempotencyKey: string,
    command: WorkspaceMutationCommand,
    execute: () => Promise<WorkspaceMutationResult>
  ): Promise<WorkspaceMutationResult> {
    const ledger = this.ledgerFor(workspaceId);
    pruneLedger(ledger.records);
    const fingerprint = mutationFingerprint(command);
    const existing = ledger.records.get(idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new HostCommandError(
          "DUPLICATE_REQUEST",
          "The idempotency key has already been used for a different Workspace mutation.",
          false
        );
      }
      if (existing.state === "settled" && existing.settledRevision !== ledger.revision) {
        throw new HostCommandError(
          "DUPLICATE_REQUEST",
          "The Workspace mutation result has been superseded by a newer mutation.",
          false,
          { superseded: true }
        );
      }
      return existing.promise;
    }
    if ([...ledger.records.values()].some((record) => record.state === "pending")) {
      throw new HostCommandError(
        "BUSY",
        "Another Workspace mutation is still pending.",
        true,
        { retryable: true }
      );
    }
    reserveLedgerEntry(ledger.records);
    let record!: MutationRecord;
    const promise = Promise.resolve().then(execute).then(
      (result) => {
        settleMutation(ledger, record);
        return result;
      },
      (error: unknown) => {
        settleMutation(ledger, record);
        throw error;
      }
    );
    record = { fingerprint, promise, state: "pending" };
    ledger.records.set(idempotencyKey, record);
    this.pendingMutations.add(promise);
    void promise.then(
      () => this.pendingMutations.delete(promise),
      () => this.pendingMutations.delete(promise)
    );
    return promise;
  }

  private ledgerFor(workspaceId: string): WorkspaceMutationLedger {
    const existing = this.ledgers.get(workspaceId);
    if (existing) return existing;
    const ledger: WorkspaceMutationLedger = { revision: 0, records: new Map() };
    this.ledgers.set(workspaceId, ledger);
    return ledger;
  }
}

export function isWorkspaceLifecycleCommand(
  type: string
): type is WorkspaceLifecycleCommandType {
  return type === "workspace.register" || type === "workspace.unregister";
}

export function isWorkspaceProviderCommand(
  type: string
): type is WorkspaceProviderCommandType {
  return type === "provider.list"
    || type === "provider.setRuntimeKey"
    || type === "provider.configuration.get"
    || type === "provider.configuration.save"
    || type === "provider.configuration.remove"
    || type === "provider.credential.store"
    || type === "provider.credential.reveal"
    || type === "provider.credential.remove"
    || type === "model.default.set"
    || type === "provider.configuration.reload";
}

function requireConfigurationService(
  service: NonNullable<ReturnType<WorkspaceContextRegistry["require"]>["workspaceServices"]["configurationService"]> | undefined
): NonNullable<ReturnType<WorkspaceContextRegistry["require"]>["workspaceServices"]["configurationService"]> {
  if (service) return service;
  throw new HostCommandError(
    "RUNTIME_NOT_READY",
    "Pi configuration services are not available for this Workspace.",
    true
  );
}

function settleMutation(ledger: WorkspaceMutationLedger, record: MutationRecord): void {
  record.state = "settled";
  record.settledRevision = ++ledger.revision;
  record.settledAt = Date.now();
}

function reserveLedgerEntry(records: Map<string, MutationRecord>): void {
  while (records.size >= MAX_LEDGER_ENTRIES) {
    const settled = [...records.entries()].find(([, record]) => record.state === "settled");
    if (!settled) {
      throw new HostCommandError(
        "RESOURCE_LIMIT_EXCEEDED",
        "The Workspace mutation ledger is full.",
        true,
        { maxEntries: MAX_LEDGER_ENTRIES }
      );
    }
    records.delete(settled[0]);
  }
}

function pruneLedger(records: Map<string, MutationRecord>): void {
  const cutoff = Date.now() - LEDGER_RETENTION_MS;
  for (const [key, record] of records) {
    if (record.state === "settled" && (record.settledAt ?? 0) <= cutoff) records.delete(key);
  }
}
