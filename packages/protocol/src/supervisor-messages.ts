import { strictObject, Type, Value, type Static } from "./typebox-schema.js";

const OperationIdSchema = Type.String({ minLength: 1, maxLength: 512 });

export const AgentHostProfileModeSchema = Type.Union([
  Type.Literal("fresh"),
  Type.Literal("existing-shared"),
  Type.Literal("desktop-managed-upgrade")
]);

export type AgentHostProfileMode = Static<typeof AgentHostProfileModeSchema>;

export const AgentHostStartupStageSchema = Type.Union([
  Type.Literal("classify-profile"),
  Type.Literal("desktop-capabilities"),
  Type.Literal("managed-packages"),
  Type.Literal("retired-mcp-cleanup"),
  Type.Literal("browser67-mcp"),
  Type.Literal("server-construction")
]);

export type AgentHostStartupStage = Static<typeof AgentHostStartupStageSchema>;

export const AgentHostStartupTimingStageSchema = Type.Union([
  Type.Literal("profile-classification"),
  Type.Literal("desktop-capabilities"),
  Type.Literal("managed-packages"),
  Type.Literal("retired-mcp-cleanup"),
  Type.Literal("browser67-mcp"),
  Type.Literal("server-construction")
]);

export type AgentHostStartupTimingStage = Static<typeof AgentHostStartupTimingStageSchema>;

export const AgentHostStartupStageTimingSchema = strictObject({
  stage: AgentHostStartupTimingStageSchema,
  durationMs: Type.Integer({ minimum: 0, maximum: 10 * 60_000 }),
  outcome: Type.Union([
    Type.Literal("completed"),
    Type.Literal("degraded"),
    Type.Literal("failed"),
    Type.Literal("skipped")
  ])
});

export type AgentHostStartupStageTiming = Static<typeof AgentHostStartupStageTimingSchema>;

export const CapabilityProjectionModeSchema = Type.Union([
  Type.Literal("packaged-direct"),
  Type.Literal("legacy-copy"),
  Type.Literal("shared-profile")
]);

export type CapabilityProjectionMode = Static<typeof CapabilityProjectionModeSchema>;

export const AgentHostStartupIssueCodeSchema = Type.Union([
  Type.Literal("access-denied"),
  Type.Literal("conflict"),
  Type.Literal("invalid-state"),
  Type.Literal("integrity-failure"),
  Type.Literal("missing-resource"),
  Type.Literal("io"),
  Type.Literal("unknown")
]);

export type AgentHostStartupIssueCode = Static<typeof AgentHostStartupIssueCodeSchema>;

export const AgentHostStartupIssueSchema = strictObject({
  stage: AgentHostStartupStageSchema,
  code: AgentHostStartupIssueCodeSchema
});

export type AgentHostStartupIssue = Static<typeof AgentHostStartupIssueSchema>;

export const AgentHostStartupStateSchema = strictObject({
  profileMode: AgentHostProfileModeSchema,
  status: Type.Union([Type.Literal("ready"), Type.Literal("degraded")]),
  issues: Type.Array(AgentHostStartupIssueSchema, { maxItems: 8 }),
  totalDurationMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 10 * 60_000 })),
  stageTimings: Type.Optional(Type.Array(AgentHostStartupStageTimingSchema, { maxItems: 6 })),
  capabilityProjectionMode: Type.Optional(CapabilityProjectionModeSchema)
});

export type AgentHostStartupState = Static<typeof AgentHostStartupStateSchema>;

export const AgentHostReadyMessageSchema = strictObject({
  type: Type.Literal("agent-host-ready"),
  startup: AgentHostStartupStateSchema
});

export type AgentHostReadyMessage = Static<typeof AgentHostReadyMessageSchema>;

export const AgentHostStartupFailedMessageSchema = strictObject({
  type: Type.Literal("agent-host-startup-failed"),
  profileMode: Type.Optional(AgentHostProfileModeSchema),
  issue: AgentHostStartupIssueSchema
});

export type AgentHostStartupFailedMessage = Static<typeof AgentHostStartupFailedMessageSchema>;

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

export function isAgentHostReadyMessage(value: unknown): value is AgentHostReadyMessage {
  return Value.Check(AgentHostReadyMessageSchema, value);
}

export function isAgentHostStartupFailedMessage(
  value: unknown
): value is AgentHostStartupFailedMessage {
  return Value.Check(AgentHostStartupFailedMessageSchema, value);
}

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
