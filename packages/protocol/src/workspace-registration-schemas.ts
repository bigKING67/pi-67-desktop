import { Type, type TProperties } from "./typebox-schema.js";

const PathSchema = Type.String({ minLength: 1, maxLength: 32_768 });
const TrustSchema = Type.Union([
  Type.Literal("unknown"),
  Type.Literal("trusted"),
  Type.Literal("untrusted")
]);
const ApprovalModeSchema = Type.Union([Type.Literal("guided"), Type.Literal("balanced")]);

export const WorkspaceRegisterPayloadSchema = strictObject({
  cwd: PathSchema,
  trust: TrustSchema,
  // Deprecated: ignored by the Host policy (AUTO is the only default); removed next protocol revision.
  approvalMode: Type.Optional(ApprovalModeSchema)
});

export const WorkspaceRegisterResultSchema = strictObject({ registered: Type.Literal(true) });
export const WorkspaceUnregisterResultSchema = strictObject({ unregistered: Type.Literal(true) });

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
