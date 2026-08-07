import { Type, Value, type Static } from "./typebox-schema.js";
import { strictObject } from "./schemas.js";

const OperationIdSchema = Type.String({ minLength: 1, maxLength: 512 });

export const AgentHostRuntimePoisonedMessageSchema = Type.Union([
  strictObject({
    type: Type.Literal("agent-host-runtime-poisoned"),
    code: Type.Literal("ABORT_WATCHDOG_EXPIRED"),
    operationId: OperationIdSchema,
    abortTimeoutMs: Type.Integer({ minimum: 1, maximum: 60_000 })
  }),
  strictObject({
    type: Type.Literal("agent-host-runtime-poisoned"),
    code: Type.Literal("SESSION_IMPORT_PROJECTION_FAILED"),
    operationId: OperationIdSchema
  }),
  strictObject({
    type: Type.Literal("agent-host-runtime-poisoned"),
    code: Type.Literal("SESSION_WRITER_LEASE_COMPROMISED")
  })
]);

export type AgentHostRuntimePoisonedMessage = Static<
  typeof AgentHostRuntimePoisonedMessageSchema
>;

export interface AgentHostShutdownRequest {
  type: "agent-host-shutdown";
  reason: "application-quit";
  deadlineMs: number;
}

export interface AgentHostShutdownCompleteMessage {
  type: "agent-host-shutdown-complete";
  activeOperation: "none" | "cancelled" | "lost";
  queuedCommandsDropped: number;
  extensionRequestsCancelled: number;
}

export const AgentHostShutdownRequestSchema = strictObject({
  type: Type.Literal("agent-host-shutdown"),
  reason: Type.Literal("application-quit"),
  deadlineMs: Type.Integer({ minimum: 100, maximum: 10_000 })
});

export const AgentHostShutdownCompleteMessageSchema = strictObject({
  type: Type.Literal("agent-host-shutdown-complete"),
  activeOperation: Type.Union([
    Type.Literal("none"),
    Type.Literal("cancelled"),
    Type.Literal("lost")
  ]),
  queuedCommandsDropped: Type.Integer({ minimum: 0, maximum: 10_000 }),
  extensionRequestsCancelled: Type.Integer({ minimum: 0, maximum: 10_000 })
});

export function isAgentHostRuntimePoisonedMessage(
  value: unknown
): value is AgentHostRuntimePoisonedMessage {
  return Value.Check(AgentHostRuntimePoisonedMessageSchema, value);
}

export function isAgentHostShutdownRequest(value: unknown): value is AgentHostShutdownRequest {
  return Value.Check(AgentHostShutdownRequestSchema, value);
}

export function isAgentHostShutdownCompleteMessage(
  value: unknown
): value is AgentHostShutdownCompleteMessage {
  return Value.Check(AgentHostShutdownCompleteMessageSchema, value);
}
