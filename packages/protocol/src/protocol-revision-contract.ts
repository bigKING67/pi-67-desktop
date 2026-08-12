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
  RepositoryEnvironmentInspectionRequestSchema,
  RepositoryEnvironmentSnapshotSchema
} from "./repository-environment-schema.js";
import {
  AgentHostReadyMessageSchema,
  AgentHostRuntimePoisonedMessageSchema,
  AgentHostShutdownCompleteMessageSchema,
  AgentHostShutdownRequestSchema
} from "./supervisor-messages.js";
import {
  WorktreeCreationAdvanceRequestSchema,
  WorktreeCreationAdvanceResultSchema,
  WorktreeCreationRequestSchema,
  WorktreeCreationResultSchema
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
        snapshot: RepositoryEnvironmentSnapshotSchema
      },
      worktreeCreation: {
        advanceRequest: WorktreeCreationAdvanceRequestSchema,
        advanceResult: WorktreeCreationAdvanceResultSchema,
        request: WorktreeCreationRequestSchema,
        result: WorktreeCreationResultSchema
      }
    },
    supervisor: {
      ready: AgentHostReadyMessageSchema,
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
