import { Type, type TProperties } from "./typebox-schema.js";

export const OperationKindSchema = Type.Union([
  Type.Literal("prompt"),
  Type.Literal("command"),
  Type.Literal("compaction"),
  Type.Literal("session-import")
]);

export const OperationActivitySchema = Type.Union([
  strictObject({ kind: Type.Literal("thinking") }),
  strictObject({ kind: Type.Literal("responding") }),
  strictObject({
    kind: Type.Literal("tool"),
    toolCallId: Type.String(),
    toolKind: Type.Union([
      Type.Literal("read"), Type.Literal("search"), Type.Literal("edit"), Type.Literal("shell"),
      Type.Literal("managed-process"), Type.Literal("subagent"), Type.Literal("image"),
      Type.Literal("approval"), Type.Literal("extension"), Type.Literal("generic")
    ])
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
  sessionGeneration: Type.Integer({ minimum: 0 }),
  startedAt: Type.Number(),
  activity: Type.Optional(OperationActivitySchema)
});

export const OperationAcceptedSchema = strictObject({
  kind: Type.Literal("accepted"),
  operationId: Type.String(),
  cancellable: Type.Boolean(),
  hostEpoch: Type.Integer({ minimum: 0 }),
  sessionId: Type.String(),
  sessionGeneration: Type.Integer({ minimum: 0 })
});

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
