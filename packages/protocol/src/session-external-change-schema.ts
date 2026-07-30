import { Type, type TProperties } from "./typebox-schema.js";

export const SessionExternalChangeSchema = strictObject({
  reason: Type.Union([
    Type.Literal("appended"),
    Type.Literal("truncated"),
    Type.Literal("replaced"),
    Type.Literal("unavailable"),
    Type.Literal("invalid")
  ]),
  recoverable: Type.Boolean()
});

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
