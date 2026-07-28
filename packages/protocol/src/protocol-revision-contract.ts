import {
  EventEnvelopeSchema,
  HandshakeRejectedSchema,
  HostWelcomeSchema,
  RendererHelloSchema,
  RequestEnvelopeSchema,
  ResponseEnvelopeSchema
} from "./envelope.js";
import { CommandPayloadSchemas, CommandResultSchemas, EventPayloadSchemas } from "./schemas.js";
import {
  AgentHostRuntimePoisonedMessageSchema,
  AgentHostShutdownCompleteMessageSchema,
  AgentHostShutdownRequestSchema
} from "./supervisor-messages.js";

export function canonicalProtocolRevisionMaterial(): string {
  return stableJson({
    envelopes: {
      rendererHello: RendererHelloSchema,
      hostWelcome: HostWelcomeSchema,
      handshakeRejected: HandshakeRejectedSchema,
      request: RequestEnvelopeSchema,
      response: ResponseEnvelopeSchema,
      event: EventEnvelopeSchema
    },
    commands: {
      payloads: CommandPayloadSchemas,
      results: CommandResultSchemas
    },
    events: EventPayloadSchemas,
    supervisor: {
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
