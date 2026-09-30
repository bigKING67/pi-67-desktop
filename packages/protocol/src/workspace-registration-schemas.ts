import { Type, type TProperties } from "./typebox-schema.js";

const PathSchema = Type.String({ minLength: 1, maxLength: 32_768 });
const TrustSchema = Type.Union([
  Type.Literal("unknown"),
  Type.Literal("trusted"),
  Type.Literal("untrusted")
]);

export const WorkspaceRegisterPayloadSchema = strictObject({
  cwd: PathSchema,
  trust: TrustSchema
});

export const WorkspaceRegisterResultSchema = strictObject({ registered: Type.Literal(true) });
export const WorkspaceUnregisterResultSchema = strictObject({ unregistered: Type.Literal(true) });

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
