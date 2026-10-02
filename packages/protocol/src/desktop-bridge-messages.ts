import { NATIVE_NOTIFICATION_TEXT_LIMITS, type NativeNotificationRequest, type WorkspaceEntryRequest } from "@pi67/domain";
import { AgentHostStartupFailedMessageSchema, AgentHostStartupStateSchema } from "./supervisor-messages.js";
import { strictObject, Type, Value, type Static } from "./typebox-schema.js";

// Shapes of preload <-> Main system-bridge messages. Main layers its own trust policy on top
// (for example filesystem containment of a workspace entry); these schemas own only the shape.

const IDENTIFIER_PATTERN = "^[A-Za-z0-9._:-]+$";

export const WorkspaceIdSchema = Type.String({ minLength: 1, maxLength: 200, pattern: IDENTIFIER_PATTERN });
export const NativeNotificationIdSchema = Type.String({ minLength: 1, maxLength: 200, pattern: IDENTIFIER_PATTERN });

export const NativeNotificationRequestSchema = Type.Union([
  strictObject({
    notificationId: NativeNotificationIdSchema,
    kind: Type.Union([Type.Literal("completed"), Type.Literal("failed"), Type.Literal("attention")]),
    workspaceId: WorkspaceIdSchema,
    sessionFileIdentity: Type.String({ minLength: 1, maxLength: 2_048 })
  }),
  // Team Chat (ADR 0006): the renderer's wording, bounded; Main shows it as given.
  strictObject({
    notificationId: NativeNotificationIdSchema,
    kind: Type.Literal("chat"),
    title: Type.String({ minLength: 1, maxLength: NATIVE_NOTIFICATION_TEXT_LIMITS.title }),
    body: Type.String({ maxLength: NATIVE_NOTIFICATION_TEXT_LIMITS.body }),
    conversationId: Type.Optional(Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9-]+$" })),
    messageSeq: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }))
  })
]);

export const WorkspaceEntryRequestSchema = strictObject({
  workspaceId: WorkspaceIdSchema,
  relativePath: Type.String({ minLength: 1, maxLength: 32_768 }),
  kind: Type.Union([Type.Literal("file"), Type.Literal("directory"), Type.Literal("symlink"), Type.Literal("other")])
});

export const ShutdownCheckpointRequestSchema = strictObject({
  requestId: Type.String({ minLength: 1, maxLength: 200 })
});
export type ShutdownCheckpointRequest = Static<typeof ShutdownCheckpointRequestSchema>;

export const ShutdownCheckpointResponseSchema = strictObject({
  requestId: Type.String({ minLength: 1, maxLength: 200 }),
  succeeded: Type.Boolean()
});
export type ShutdownCheckpointResponse = Static<typeof ShutdownCheckpointResponseSchema>;

/** Main -> renderer pi67:agent-host-startup event. */
export const DesktopAgentHostStartupStateSchema = strictObject({
  hostEpoch: Type.Integer({ minimum: 0 }),
  startup: AgentHostStartupStateSchema
});
export type DesktopAgentHostStartupState = Static<typeof DesktopAgentHostStartupStateSchema>;

/** Main -> renderer pi67:agent-host-failed event; `code` is the process exit code. */
export const DesktopAgentHostFailureStateSchema = strictObject({
  hostEpoch: Type.Optional(Type.Integer({ minimum: 0 })),
  code: Type.Integer({ minimum: -2_147_483_648, maximum: 4_294_967_295 }),
  recoverable: Type.Boolean(),
  attempt: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000 })),
  startupFailure: Type.Optional(AgentHostStartupFailedMessageSchema)
});
export type DesktopAgentHostFailureState = Static<typeof DesktopAgentHostFailureStateSchema>;

export function isWorkspaceId(value: unknown): value is string {
  return Value.Check(WorkspaceIdSchema, value);
}

export function isNativeNotificationId(value: unknown): value is string {
  return Value.Check(NativeNotificationIdSchema, value);
}

export function isNativeNotificationRequest(value: unknown): value is NativeNotificationRequest {
  return Value.Check(NativeNotificationRequestSchema, value);
}

export function isWorkspaceEntryRequest(value: unknown): value is WorkspaceEntryRequest {
  return Value.Check(WorkspaceEntryRequestSchema, value);
}

export function isShutdownCheckpointRequest(value: unknown): value is ShutdownCheckpointRequest {
  return Value.Check(ShutdownCheckpointRequestSchema, value);
}

export function isShutdownCheckpointResponse(value: unknown): value is ShutdownCheckpointResponse {
  return Value.Check(ShutdownCheckpointResponseSchema, value);
}

export function isDesktopAgentHostStartupState(value: unknown): value is DesktopAgentHostStartupState {
  return Value.Check(DesktopAgentHostStartupStateSchema, value);
}

export function isDesktopAgentHostFailureState(value: unknown): value is DesktopAgentHostFailureState {
  return Value.Check(DesktopAgentHostFailureStateSchema, value);
}
