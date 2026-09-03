import { randomUUID } from "node:crypto";
import type {
  ContextMemoryConfiguration,
  MemoryEntrySummary,
  MemoryScope
} from "@pi67/domain";
import type {
  AgentCommand,
  CommandResults,
  WorkspaceProtocolContext
} from "@pi67/protocol";
import type { SharedExperienceAccess, SharedSopAccess } from "@pi67/pi-runtime";
import type { HostEventChannel } from "../host-event-channel.js";
import { HostCommandError } from "../protocol-error.js";
import type { WorkspaceContextRegistry } from "../workspace-context-registry.js";
import { mutationFingerprint } from "../workspace-mutation-fingerprint.js";
import { ContextMemoryConfigurationStore } from "./context-memory-configuration.js";
import { ContextSessionCommitController } from "./context-session-commit-controller.js";
import type { EnterpriseCredentialBrokerClient } from "./enterprise-credential-broker-client.js";
import { EnterpriseContextController } from "./enterprise-context-controller.js";
import {
  readContextRuntimeDoctor,
  readContextRuntimeStatus
} from "./context-memory-runtime-diagnostics.js";
import {
  appContextAuthority,
  assertPrivateMemoryUri,
  deriveWorkspacePeerId,
  isPrivateMemoryUri,
  memoryScopeForUri,
  memorySummary,
  titleForUri
} from "./context-memory-support.js";
import { OpenVikingClient } from "./openviking-client.js";
import {
  ExperienceCandidateStore
} from "./experience-candidate-store.js";
import { ExperienceGovernanceController } from "./experience-governance-controller.js";
import type {
  ContextMemoryAppCommandType,
  ContextMemoryWorkspaceCommandType
} from "./context-memory-command-types.js";
import { RecallObservationStore } from "./recall-observation-store.js";
export * from "./context-memory-command-types.js";

type ContextAppCommand = AgentCommand<ContextMemoryAppCommandType>;
type ContextWorkspaceCommand = AgentCommand<ContextMemoryWorkspaceCommandType>;

interface PendingForget {
  uri: string;
  entry: MemoryEntrySummary;
  expiresAt: number;
}

interface MutationRecord {
  fingerprint: string;
  promise: Promise<unknown>;
  settledAt?: number;
}

const FORGET_PREVIEW_TTL_MS = 5 * 60_000;
const MUTATION_RETENTION_MS = 10 * 60_000;
const MAX_MUTATIONS = 128;

export class ContextMemoryCommandRouter {
  private readonly configuration: ContextMemoryConfigurationStore;
  private readonly forgetPreviews = new Map<string, PendingForget>();
  private readonly mutations = new Map<string, MutationRecord>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly enterprise: EnterpriseContextController;
  private readonly experience: ExperienceGovernanceController;
  private readonly sessionCommit: ContextSessionCommitController;
  private readonly recall: RecallObservationStore;

  constructor(
    private readonly agentDir: string,
    private readonly workspaces: WorkspaceContextRegistry,
    private readonly events: HostEventChannel,
    enterpriseCredentials?: EnterpriseCredentialBrokerClient
  ) {
    this.configuration = new ContextMemoryConfigurationStore(agentDir);
    this.recall = new RecallObservationStore(agentDir);
    this.enterprise = new EnterpriseContextController(
      this.configuration,
      workspaces,
      events,
      enterpriseCredentials,
      this.recall
    );
    const experienceCandidates = new ExperienceCandidateStore(agentDir);
    this.experience = new ExperienceGovernanceController(experienceCandidates, this.enterprise, events);
    this.sessionCommit = new ContextSessionCommitController(
      agentDir,
      workspaces,
      this.enterprise,
      experienceCandidates,
      events
    );
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(this.pending);
    this.enterprise.shutdown();
  }

  sharedExperienceAccess(workspaceId: string): SharedExperienceAccess {
    return {
      search: (query, limit, signal) => this.enterprise.searchSharedExperiences(
        workspaceId, query, limit, signal
      ),
      read: (id, signal) => this.enterprise.getSharedExperience(workspaceId, id, signal)
    };
  }

  sharedSopAccess(workspaceId: string): SharedSopAccess {
    return {
      search: (query, signal) => this.enterprise.searchSharedSops(workspaceId, query, signal),
      read: (id, signal) => this.enterprise.getSharedSop(workspaceId, id, signal)
    };
  }

  async dispatchApp(
    command: ContextAppCommand,
    idempotencyKey?: string
  ): Promise<CommandResults[ContextMemoryAppCommandType]> {
    if (command.type === "context.config.get") return this.configuration.read();
    if (command.type === "context.status.get") return this.status();
    if (command.type === "context.runtime.doctor") return this.doctor(command.payload.probeRemote !== false);
    if (command.type === "enterprise.identity.get") return this.enterprise.currentIdentity();
    if (command.type === "enterprise.auth.begin") return this.enterprise.beginAuthorization();
    if (command.type === "enterprise.auth.poll") {
      return this.enterprise.pollAuthorization(command.payload.authorizationId);
    }
    if (command.type === "enterprise.project.list") return this.enterprise.listProjects();
    if (command.type === "enterprise.auth.disconnect") {
      return this.runMutation(
        idempotencyKey,
        command,
        () => this.enterprise.disconnect()
      ) as Promise<CommandResults[ContextMemoryAppCommandType]>;
    }
    return this.runMutation(idempotencyKey, command, async () => {
      const result = await this.configuration.update(command.payload);
      this.events.sendFor({ type: "context.configChanged", payload: result }, appContextAuthority());
      return result;
    }) as Promise<CommandResults[ContextMemoryAppCommandType]>;
  }

  async dispatchWorkspace(
    context: WorkspaceProtocolContext,
    command: ContextWorkspaceCommand,
    idempotencyKey?: string
  ): Promise<CommandResults[ContextMemoryWorkspaceCommandType]> {
    const workspace = this.workspaces.require(context.workspaceId);
    const configuration = await this.configuration.read();
    const client = new OpenVikingClient(configuration, deriveWorkspacePeerId(workspace.cwd));

    switch (command.type) {
      case "context.session.get":
        return this.sessionStatus(client, configuration, command.payload.sessionId);
      case "context.session.commit":
        return this.acceptAsyncMutation(idempotencyKey, command, (operationId) => this.sessionCommit.commit({
          workspaceId: context.workspaceId,
          submissionId: command.payload.submissionId,
          sessionId: command.payload.sessionId,
          operationId,
          configuration,
          client
        }));
      case "context.recall.list":
        return this.recall.list({
          workspaceId: context.workspaceId,
          actorPeerId: deriveWorkspacePeerId(workspace.cwd),
          ...(command.payload.sessionId === undefined ? {} : { sessionId: command.payload.sessionId }),
          limit: command.payload.limit ?? 20
        });
      case "context.recall.feedback": {
        const recorded = await this.recall.recordFeedback({
          id: command.payload.id,
          feedback: command.payload.feedback,
          workspaceId: context.workspaceId,
          actorPeerId: deriveWorkspacePeerId(workspace.cwd),
          ...(command.payload.sessionId === undefined ? {} : { sessionId: command.payload.sessionId })
        });
        return { id: recorded.id, feedback: recorded.feedback, recordedAt: recorded.recordedAt };
      }
      case "context.recall.metrics":
        return this.recall.metrics({
          workspaceId: context.workspaceId,
          actorPeerId: deriveWorkspacePeerId(workspace.cwd)
        });
      case "memory.search":
        return this.searchPrivateMemory(
          client,
          command.payload.query,
          command.payload.scope,
          command.payload.limit ?? 20,
          context.workspaceId,
          deriveWorkspacePeerId(workspace.cwd)
        );
      case "memory.get":
        return this.getPrivateMemory(client, command.payload.id, context.workspaceId);
      case "memory.forget.preview":
        return this.previewForget(client, command.payload.id, context.workspaceId);
      case "memory.forget.confirm":
        return this.confirmForget(context.workspaceId, client, command, idempotencyKey);
      case "experience.private.list":
        return this.experience.list(
          client,
          context.workspaceId,
          command.payload.status,
          command.payload.limit ?? 20
        );
      case "experience.candidate.get":
        return this.experience.get(client, context.workspaceId, command.payload.id);
      case "experience.candidate.review":
        return this.runMutation(
          idempotencyKey,
          command,
          () => this.experience.review(context.workspaceId, command.payload)
        ) as Promise<CommandResults[ContextMemoryWorkspaceCommandType]>;
      case "experience.candidate.promote":
        return this.acceptAsyncMutation(idempotencyKey, command, (operationId) => this.experience.submit(
          context.workspaceId,
          command.payload.id,
          command.payload.submissionId,
          operationId
        ));
      case "experience.candidate.reject":
        return this.runMutation(
          idempotencyKey,
          command,
          () => this.experience.reject(context.workspaceId, command.payload.id, command.payload.reason)
        ) as Promise<CommandResults[ContextMemoryWorkspaceCommandType]>;
      case "experience.shared.search":
        return this.enterprise.searchSharedExperiences(
          context.workspaceId,
          command.payload.query,
          command.payload.limit
        );
      case "experience.shared.get":
        return this.enterprise.getSharedExperience(context.workspaceId, command.payload.id);
      case "sop.shared.search":
        return this.enterprise.searchSharedSops(context.workspaceId, command.payload.query);
      case "sop.shared.get":
        return this.enterprise.getSharedSop(context.workspaceId, command.payload.id);
      case "enterprise.workspace.get":
        return this.enterprise.getWorkspaceBinding(context.workspaceId);
      case "enterprise.workspace.bind":
        return this.runMutation(idempotencyKey, command, () => this.enterprise.bindWorkspace(
          context.workspaceId,
          command.payload.enterpriseProjectId,
          idempotencyKey!
        )) as Promise<CommandResults[ContextMemoryWorkspaceCommandType]>;
      case "enterprise.workspace.unbind":
        throw new HostCommandError(
          "UNSUPPORTED",
          "Enterprise Workspace unbinding is not available until the Gateway exposes an audited revoke operation.",
          true
        );
    }
  }

  private async status() {
    return readContextRuntimeStatus(await this.configuration.read(), this.agentDir);
  }

  private async doctor(probeRemote: boolean) {
    return readContextRuntimeDoctor(
      await this.configuration.read(),
      this.agentDir,
      probeRemote
    );
  }

  private async sessionStatus(
    client: OpenVikingClient,
    configuration: ContextMemoryConfiguration,
    sessionId: string
  ): Promise<CommandResults["context.session.get"]> {
    const status = await this.status();
    if (status.owner !== "pi67-openviking") {
      return {
        sessionId,
        owner: status.owner,
        privacyMode: configuration.defaultPrivacyMode,
        capturedTurns: 0,
        pendingTokens: 0,
        liveTailTurns: configuration.takeover.keepRecentTurns,
        takeoverActive: false
      };
    }
    const meta = await client.getSession(sessionId);
    const lastCommitAt = meta.last_commit_at ? Date.parse(meta.last_commit_at) : Number.NaN;
    return {
      sessionId,
      owner: status.owner,
      privacyMode: configuration.defaultPrivacyMode,
      capturedTurns: meta.total_message_count ?? meta.message_count ?? 0,
      pendingTokens: meta.pending_tokens ?? 0,
      liveTailTurns: configuration.takeover.keepRecentTurns,
      takeoverActive: configuration.takeover.enabled,
      ...(Number.isFinite(lastCommitAt) ? { lastCommitAt } : {})
    };
  }

  private async searchPrivateMemory(
    client: OpenVikingClient,
    query: string,
    scope: MemoryScope | undefined,
    limit: number,
    workspaceId: string,
    actorPeerId: string
  ): Promise<CommandResults["memory.search"]> {
    if (scope === "team" || scope === "company") return { items: [], total: 0 };
    const targetUri = scope === "workspace"
      ? `viking://user/peers/${actorPeerId}/memories`
      : scope === "user" ? "viking://user/memories" : "viking://user";
    const results = await client.search(query, {
      limit,
      ...(scope === undefined ? {} : { scope }),
      targetUri
    });
    const items = results
      .filter((item) => isPrivateMemoryUri(item.uri))
      .map((item) => memorySummary(item, memoryScopeForUri(item.uri), workspaceId));
    return { items, total: items.length };
  }

  private async getPrivateMemory(
    client: OpenVikingClient,
    uri: string,
    workspaceId: string
  ): Promise<MemoryEntrySummary> {
    assertPrivateMemoryUri(uri);
    const summary = await client.read(uri);
    return {
      id: uri,
      title: titleForUri(uri),
      summary,
      scope: memoryScopeForUri(uri),
      createdAt: 0,
      updatedAt: 0,
      ...(memoryScopeForUri(uri) === "workspace" ? { workspaceId } : {})
    };
  }

  private async previewForget(
    client: OpenVikingClient,
    uri: string,
    workspaceId: string
  ): Promise<CommandResults["memory.forget.preview"]> {
    this.pruneForgetPreviews();
    const entry = await this.getPrivateMemory(client, uri, workspaceId);
    const previewToken = randomUUID();
    const expiresAt = Date.now() + FORGET_PREVIEW_TTL_MS;
    this.forgetPreviews.set(previewToken, { uri, entry, expiresAt });
    return {
      previewToken,
      entry,
      effects: [
        "Deletes this private OpenViking memory.",
        "Published team Experiences are independent and are not revoked by this action."
      ],
      expiresAt
    };
  }

  private confirmForget(
    workspaceId: string,
    client: OpenVikingClient,
    command: Extract<ContextWorkspaceCommand, { type: "memory.forget.confirm" }>,
    idempotencyKey?: string
  ): Promise<CommandResults["memory.forget.confirm"]> {
    this.pruneForgetPreviews();
    const preview = this.forgetPreviews.get(command.payload.previewToken);
    if (!preview) throw new HostCommandError("RESOURCE_NOT_FOUND", "The forget preview expired or is invalid.", true);
    return this.acceptAsyncMutation(idempotencyKey, command, async (operationId) => {
      await client.forget(preview.uri);
      this.forgetPreviews.delete(command.payload.previewToken);
      this.emitWorkspace(workspaceId, {
        type: "memory.forgetCompleted",
        payload: { operationId, memoryId: preview.uri, completedAt: Date.now() }
      });
    });
  }

  private acceptAsyncMutation<T extends Extract<ContextWorkspaceCommand,
    { type: "context.session.commit" | "memory.forget.confirm" | "experience.candidate.promote" }>>(
    idempotencyKey: string | undefined,
    command: T,
    execute: (operationId: string) => Promise<void>
  ): Promise<CommandResults[T["type"]]> {
    return this.runMutation(idempotencyKey, command, async () => {
      const operationId = randomUUID();
      const operation = execute(operationId);
      this.pending.add(operation);
      void operation.finally(() => this.pending.delete(operation)).catch(() => undefined);
      return { kind: "accepted", operationId, cancellable: false } as CommandResults[T["type"]];
    }) as Promise<CommandResults[T["type"]]>;
  }

  private runMutation<T>(
    idempotencyKey: string | undefined,
    command: AgentCommand,
    execute: () => Promise<T>
  ): Promise<T> {
    if (!idempotencyKey) {
      return Promise.reject(new HostCommandError(
        "INVALID_PAYLOAD",
        "Context and memory mutations require an idempotency key.",
        false
      ));
    }
    this.pruneMutations();
    const fingerprint = mutationFingerprint(command);
    const existing = this.mutations.get(idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new HostCommandError("DUPLICATE_REQUEST", "The idempotency key was reused for a different memory operation.", false);
      }
      return existing.promise as Promise<T>;
    }
    if (this.mutations.size >= MAX_MUTATIONS) {
      throw new HostCommandError("RESOURCE_LIMIT_EXCEEDED", "Too many memory mutations are pending.", true);
    }
    const promise = execute();
    const record: MutationRecord = { fingerprint, promise };
    this.mutations.set(idempotencyKey, record);
    void promise.finally(() => { record.settledAt = Date.now(); }).catch(() => undefined);
    return promise;
  }

  private pruneMutations(): void {
    const cutoff = Date.now() - MUTATION_RETENTION_MS;
    for (const [key, record] of this.mutations) {
      if ((record.settledAt ?? Number.POSITIVE_INFINITY) <= cutoff) this.mutations.delete(key);
    }
  }

  private pruneForgetPreviews(): void {
    const now = Date.now();
    for (const [token, preview] of this.forgetPreviews) {
      if (preview.expiresAt <= now) this.forgetPreviews.delete(token);
    }
  }

  private emitWorkspace(workspaceId: string, event: Parameters<HostEventChannel["sendFor"]>[0]): void {
    this.events.sendFor(event, {
      runtime: undefined,
      operations: undefined,
      context: { scope: "workspace", workspaceId }
    });
  }
}
