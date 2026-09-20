import {
  EventEnvelopeSchema,
  HandshakeRejectedSchema,
  HostWelcomeSchema,
  RendererHelloSchema,
  RequestCancellationEnvelopeSchema,
  RequestEnvelopeSchema,
  ResponseEnvelopeSchema
} from "./envelope.js";
import { CommandPayloadSchemas, CommandResultSchemas, EventPayloadSchemas } from "./schemas.js";
import { LocalMemoryConnectRequestSchema, LocalMemoryConnectResultSchema } from "./local-memory-broker.js";
import { LocalMemoryActivationRequestSchema, LocalMemoryActivationSnapshotSchema, LocalMemoryHealthCheckSchema } from "./local-memory-activation.js";
import { TeamModelPortAttachSchema } from "./team-model-port.js";
import { TeamWorkerRequestSchema, TeamWorkerStateSchema, TEAM_WORKER_HANDOFF_TIMEOUT_MS, TEAM_WORKER_PREPARATION_TIMEOUT_MS } from "./team-worker.js";
import { SharedKnowledgeReceiptRequestSchema, SharedKnowledgeReceiptResultSchema, SharedKnowledgeIndexHeadRequestSchema, SharedKnowledgeIndexHeadResultSchema } from "./shared-knowledge-receipt-broker.js";
import { LocalMemorySettingsRequestSchema, LocalMemorySettingsSnapshotSchema, LocalMemoryKeyRevealRequestSchema, LocalMemoryKeyRevealResultSchema } from "./local-memory-settings.js";
import { LocalMemoryModelRequestSchema, LocalMemoryModelCancelSchema, LocalMemoryModelResultSchema } from "./local-memory-model-broker.js";
import { TeamIndexSettingsRequestSchema, TeamIndexSettingsMessageSchema } from "./team-index-settings.js";
import {
  AppOwnedWorktreeRecoveryRequestSchema,
  AppOwnedWorktreeRecoveryResultSchema,
  RepositoryEnvironmentInspectionRequestSchema,
  RepositoryEnvironmentSnapshotSchema,
  RepositorySubmoduleInitializationRequestSchema,
  RepositorySubmoduleInitializationResultSchema
} from "./repository-environment-schema.js";
import {
  AgentHostReadyMessageSchema,
  AgentHostRuntimePoisonedMessageSchema,
  AgentHostStartupFailedMessageSchema,
  AgentHostShutdownCompleteMessageSchema,
  AgentHostShutdownRequestSchema
} from "./supervisor-messages.js";
import {
  WorktreeCreationAdvanceRequestSchema,
  WorktreeCreationAdvanceResultSchema,
  WorktreeCreationActivityRequestSchema,
  WorktreeCreationActivityResultSchema,
  WorktreeCreationCancelRequestSchema,
  WorktreeCreationCancelResultSchema,
  WorktreeCreationRequestSchema,
  WorktreeCreationResultSchema,
  WorktreeCreationRollbackRequestSchema,
  WorktreeCreationRollbackResultSchema
} from "./worktree-creation-schema.js";

export function canonicalProtocolRevisionMaterial(): string {
  return stableJson({
    envelopes: {
      rendererHello: RendererHelloSchema,
      hostWelcome: HostWelcomeSchema,
      handshakeRejected: HandshakeRejectedSchema,
      request: RequestEnvelopeSchema,
      requestCancellation: RequestCancellationEnvelopeSchema,
      response: ResponseEnvelopeSchema,
      event: EventEnvelopeSchema
    },
    commands: {
      payloads: CommandPayloadSchemas,
      results: CommandResultSchemas
    },
    events: EventPayloadSchemas,
    desktop: {
      localMemoryActivation: { request: LocalMemoryActivationRequestSchema, snapshot: LocalMemoryActivationSnapshotSchema, healthCheck: LocalMemoryHealthCheckSchema },
      localMemoryRuntime: { status: LocalMemoryRuntimeStatusSchema, installResult: LocalMemoryRuntimeInstallResultSchema },
      localMemorySettings: { request: LocalMemorySettingsRequestSchema, snapshot: LocalMemorySettingsSnapshotSchema,
        revealRequest: LocalMemoryKeyRevealRequestSchema, revealResult: LocalMemoryKeyRevealResultSchema },
      repositoryEnvironment: {
        inspectionRequest: RepositoryEnvironmentInspectionRequestSchema,
        snapshot: RepositoryEnvironmentSnapshotSchema,
        submoduleInitializationRequest: RepositorySubmoduleInitializationRequestSchema,
        submoduleInitializationResult: RepositorySubmoduleInitializationResultSchema,
        appOwnedWorktreeRecoveryRequest: AppOwnedWorktreeRecoveryRequestSchema,
        appOwnedWorktreeRecoveryResult: AppOwnedWorktreeRecoveryResultSchema
      },
      worktreeCreation: {
        advanceRequest: WorktreeCreationAdvanceRequestSchema,
        advanceResult: WorktreeCreationAdvanceResultSchema,
        activityRequest: WorktreeCreationActivityRequestSchema,
        activityResult: WorktreeCreationActivityResultSchema,
        cancelRequest: WorktreeCreationCancelRequestSchema,
        cancelResult: WorktreeCreationCancelResultSchema,
        request: WorktreeCreationRequestSchema,
        result: WorktreeCreationResultSchema,
        rollbackRequest: WorktreeCreationRollbackRequestSchema,
        rollbackResult: WorktreeCreationRollbackResultSchema
      }
    },
    supervisor: {
      teamModelPortAttach: TeamModelPortAttachSchema,
      teamWorkerRequest: TeamWorkerRequestSchema,
      teamWorkerState: TeamWorkerStateSchema,
      teamWorkerTiming: { preparationMs: TEAM_WORKER_PREPARATION_TIMEOUT_MS, handoffMs: TEAM_WORKER_HANDOFF_TIMEOUT_MS },
      localMemoryConnectRequest: LocalMemoryConnectRequestSchema,
      sharedKnowledgeReceiptRequest: SharedKnowledgeReceiptRequestSchema,
      sharedKnowledgeReceiptResult: SharedKnowledgeReceiptResultSchema,
      sharedKnowledgeIndexHeadRequest: SharedKnowledgeIndexHeadRequestSchema,
      sharedKnowledgeIndexHeadResult: SharedKnowledgeIndexHeadResultSchema,
      localMemoryModelRequest: LocalMemoryModelRequestSchema,
      localMemoryModelCancel: LocalMemoryModelCancelSchema,
      localMemoryModelResult: LocalMemoryModelResultSchema,
      teamIndexSettingsRequest: TeamIndexSettingsRequestSchema,
      teamIndexSettingsMessage: TeamIndexSettingsMessageSchema,
      localMemoryConnectResult: LocalMemoryConnectResultSchema,
      ready: AgentHostReadyMessageSchema,
      startupFailed: AgentHostStartupFailedMessageSchema,
      runtimePoisoned: AgentHostRuntimePoisonedMessageSchema,
      shutdownRequest: AgentHostShutdownRequestSchema,
      shutdownComplete: AgentHostShutdownCompleteMessageSchema
    }
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(",")}}`;
}
import { LocalMemoryRuntimeStatusSchema, LocalMemoryRuntimeInstallResultSchema } from "./local-memory-runtime.js";
