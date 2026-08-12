import {
  MAX_NATIVE_SUBAGENT_ERROR_CHARS,
  MAX_NATIVE_SUBAGENT_NESTING_DEPTH,
  MAX_NATIVE_SUBAGENT_RESULT_CHARS,
  MAX_NATIVE_SUBAGENT_SPAWN_BATCH,
  MAX_NATIVE_SUBAGENT_STEER_CHARS,
  MAX_NATIVE_SUBAGENT_WAIT_MS
} from "@pi67/domain";
import { Type, type TProperties } from "./typebox-schema.js";

const IdentifierSchema = Type.String({ minLength: 1, maxLength: 512 });
const RoleSchema = Type.Union([
  Type.Literal("explorer"),
  Type.Literal("worker"),
  Type.Literal("reviewer"),
  Type.Literal("general")
]);
const ModeSchema = Type.Union([Type.Literal("foreground"), Type.Literal("background")]);
const ReasoningSchema = Type.Union([
  Type.Literal("off"),
  Type.Literal("minimal"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
  Type.Literal("max")
]);
const StateSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("running"),
  Type.Literal("waiting"),
  Type.Literal("idle"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
  Type.Literal("interrupted")
]);

export const NativeSubagentLineageSchema = strictObject({
  runId: IdentifierSchema,
  childId: IdentifierSchema,
  activationId: IdentifierSchema,
  parentChildId: Type.Optional(IdentifierSchema),
  depth: Type.Integer({ minimum: 1, maximum: MAX_NATIVE_SUBAGENT_NESTING_DEPTH }),
  role: RoleSchema
});

export const NativeSubagentViewSchema = strictObject({
  runId: IdentifierSchema,
  childId: IdentifierSchema,
  activationId: IdentifierSchema,
  parentChildId: Type.Optional(IdentifierSchema),
  depth: Type.Integer({ minimum: 1, maximum: MAX_NATIVE_SUBAGENT_NESTING_DEPTH }),
  role: RoleSchema,
  state: StateSchema,
  mode: ModeSchema,
  context: Type.Union([Type.Literal("fresh"), Type.Literal("fork")]),
  isolation: Type.Union([Type.Literal("shared"), Type.Literal("worktree")]),
  model: Type.Optional(strictObject({
    provider: Type.String({ minLength: 1, maxLength: 256 }),
    id: Type.String({ minLength: 1, maxLength: 256 })
  })),
  reasoning: Type.Optional(ReasoningSchema),
  cwd: Type.Optional(Type.String({ minLength: 1, maxLength: 32_768 })),
  worktreePath: Type.Optional(Type.String({ minLength: 1, maxLength: 32_768 })),
  sessionPath: Type.Optional(Type.String({ minLength: 1, maxLength: 32_768 })),
  startedAt: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  updatedAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  settledAt: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  result: Type.Optional(Type.String({ maxLength: MAX_NATIVE_SUBAGENT_RESULT_CHARS })),
  error: Type.Optional(Type.String({ maxLength: MAX_NATIVE_SUBAGENT_ERROR_CHARS })),
  usage: Type.Optional(strictObject({
    input: Type.Number({ minimum: 0 }),
    output: Type.Number({ minimum: 0 }),
    cacheRead: Type.Number({ minimum: 0 }),
    cacheWrite: Type.Number({ minimum: 0 }),
    cost: Type.Number({ minimum: 0 })
  }))
});

export const NativeSubagentListPayloadSchema = strictObject({});
export const NativeSubagentStatusPayloadSchema = strictObject({ id: IdentifierSchema });
export const NativeSubagentWaitPayloadSchema = strictObject({
  ids: Type.Array(IdentifierSchema, {
    minItems: 1,
    maxItems: MAX_NATIVE_SUBAGENT_SPAWN_BATCH
  }),
  mode: Type.Optional(Type.Union([Type.Literal("first"), Type.Literal("all")])),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: MAX_NATIVE_SUBAGENT_WAIT_MS }))
});
export const NativeSubagentSteerPayloadSchema = strictObject({
  id: IdentifierSchema,
  text: Type.String({ minLength: 1, maxLength: MAX_NATIVE_SUBAGENT_STEER_CHARS })
});
export const NativeSubagentStopPayloadSchema = strictObject({ id: IdentifierSchema });
export const NativeSubagentResumePayloadSchema = strictObject({
  id: IdentifierSchema,
  mode: Type.Optional(ModeSchema)
});

export const NativeSubagentListResultSchema = strictObject({
  items: Type.Array(NativeSubagentViewSchema)
});
export const NativeSubagentWaitResultSchema = strictObject({
  items: Type.Array(NativeSubagentViewSchema, { maxItems: MAX_NATIVE_SUBAGENT_SPAWN_BATCH }),
  timedOut: Type.Boolean()
});
export const NativeSubagentChangedEventSchema = strictObject({
  item: NativeSubagentViewSchema,
  reason: Type.Union([
    Type.Literal("spawned"),
    Type.Literal("started"),
    Type.Literal("completed"),
    Type.Literal("failed"),
    Type.Literal("stopped"),
    Type.Literal("resumed"),
    Type.Literal("steered"),
    Type.Literal("recovered"),
    Type.Literal("interrupted")
  ])
});

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
