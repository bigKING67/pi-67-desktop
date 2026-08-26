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
