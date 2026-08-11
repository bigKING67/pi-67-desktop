import { Type, type TProperties } from "./typebox-schema.js";
import {
  MAX_OPERATION_TOOL_EXECUTIONS,
  MAX_TOOL_CALL_ID_CHARS,
  MAX_TOOL_COMMAND_CHARS,
  MAX_TOOL_CWD_CHARS,
  MAX_TOOL_FAILURE_CHARS,
  MAX_TOOL_INPUT_SUMMARY_CHARS,
  MAX_TOOL_NAME_CHARS,
  MAX_TOOL_PROGRESS_CHARS
} from "@pi67/domain";

export const OperationKindSchema = Type.Union([
  Type.Literal("prompt"),
  Type.Literal("command"),
  Type.Literal("compaction"),
  Type.Literal("session-import")
]);

export const ToolExecutionStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("running"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("interrupted"),
  Type.Literal("cancelled"),
  Type.Literal("lost"),
  Type.Literal("unreconciled")
]);

const ToolPresentationKindSchema = Type.Union([
  Type.Literal("read"), Type.Literal("search"), Type.Literal("edit"), Type.Literal("shell"),
  Type.Literal("managed-process"), Type.Literal("subagent"), Type.Literal("image"),
  Type.Literal("approval"), Type.Literal("extension"), Type.Literal("generic")
]);

const ToolAuthorizationProjectionSchema = strictObject({
  mode: Type.Literal("auto"),
  reason: Type.Union([
    Type.Literal("configured-source"),
    Type.Literal("read-only"),
    Type.Literal("workspace-command"),
    Type.Literal("workspace-write")
  ])
});

function boundedToolText(maxLength: number) {
  return strictObject({
    text: Type.String({ maxLength }),
    truncated: Type.Boolean()
  });
}

export const ToolExecutionSchema = strictObject({
  toolCallId: Type.String({ minLength: 1, maxLength: MAX_TOOL_CALL_ID_CHARS }),
  toolName: Type.String({ minLength: 1, maxLength: MAX_TOOL_NAME_CHARS }),
  toolKind: ToolPresentationKindSchema,
  status: ToolExecutionStatusSchema,
  projectionSource: Type.Union([
    Type.Literal("live"), Type.Literal("durable"), Type.Literal("recovered")
  ]),
  inputSummary: Type.Optional(boundedToolText(MAX_TOOL_INPUT_SUMMARY_CHARS)),
  command: Type.Optional(boundedToolText(MAX_TOOL_COMMAND_CHARS)),
  cwd: Type.Optional(Type.String({ maxLength: MAX_TOOL_CWD_CHARS })),
  progress: Type.Optional(boundedToolText(MAX_TOOL_PROGRESS_CHARS)),
  resultState: Type.Union([
    Type.Literal("pending"), Type.Literal("present"), Type.Literal("unreconciled")
  ]),
  failure: Type.Optional(strictObject({
    detailState: Type.Union([Type.Literal("available"), Type.Literal("missing")]),
    source: Type.Union([
      Type.Literal("pi-result"), Type.Literal("runtime-event"), Type.Literal("projection-integrity")
    ]),
    message: Type.Optional(boundedToolText(MAX_TOOL_FAILURE_CHARS))
  })),
  startedAt: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  completedAt: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  durationMs: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  timingSource: Type.Optional(Type.Union([Type.Literal("runtime"), Type.Literal("receipt")])),
  aliasTarget: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_TOOL_NAME_CHARS })),
  authorization: Type.Optional(ToolAuthorizationProjectionSchema)
});

export const OperationActivitySchema = Type.Union([
  strictObject({ kind: Type.Literal("thinking") }),
  strictObject({ kind: Type.Literal("responding") }),
  strictObject({
    kind: Type.Literal("tool"),
    toolCallId: Type.String(),
    toolName: Type.String({ minLength: 1, maxLength: 128 }),
    toolKind: ToolPresentationKindSchema,
    status: ToolExecutionStatusSchema,
    aliasTarget: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    authorization: Type.Optional(ToolAuthorizationProjectionSchema)
  }),
  strictObject({ kind: Type.Literal("approval"), requestId: Type.String() }),
  strictObject({ kind: Type.Literal("extension-input"), requestId: Type.String() }),
  strictObject({ kind: Type.Literal("compaction") })
]);

export const OperationViewSchema = strictObject({
  operationId: Type.String(),
  kind: Type.Union([Type.Literal("prompt"), Type.Literal("command"), Type.Literal("compaction"), Type.Literal("session-import")]),
  lifecycle: Type.Union([
    Type.Literal("submitting"), Type.Literal("accepted"), Type.Literal("running"), Type.Literal("waiting-input"),
    Type.Literal("completed"), Type.Literal("failed"), Type.Literal("cancelled"), Type.Literal("lost")
  ]),
  cancellable: Type.Boolean(),
  sessionId: Type.String(),
  sessionFileIdentity: Type.String({ minLength: 1, maxLength: 512 }),
  sessionGeneration: Type.Integer({ minimum: 0 }),
  startedAt: Type.Number(),
  activity: Type.Optional(OperationActivitySchema),
  toolExecutions: Type.Optional(Type.Array(ToolExecutionSchema, { maxItems: MAX_OPERATION_TOOL_EXECUTIONS })),
  toolExecutionsTruncated: Type.Optional(Type.Boolean())
});

export const OperationAcceptedSchema = strictObject({
  kind: Type.Literal("accepted"),
  operationId: Type.String(),
  cancellable: Type.Boolean(),
  hostEpoch: Type.Integer({ minimum: 0 }),
  sessionId: Type.String(),
  sessionFileIdentity: Type.String({ minLength: 1, maxLength: 512 }),
  sessionGeneration: Type.Integer({ minimum: 0 })
});

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
