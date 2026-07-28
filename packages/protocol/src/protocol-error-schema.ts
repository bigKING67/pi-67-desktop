import { Type, type TProperties } from "typebox";

const ProtocolErrorDetailsSchema = Type.Record(
  Type.String(),
  Type.Union([Type.String(), Type.Number(), Type.Boolean()])
);

export const ProtocolErrorSchema = strictObject({
  code: Type.Union([
    Type.Literal("PROTOCOL_MISMATCH"), Type.Literal("INVALID_PAYLOAD"), Type.Literal("CONNECTION_CLOSED"),
    Type.Literal("REQUEST_TIMEOUT"),
    Type.Literal("STALE_HOST_EPOCH"), Type.Literal("STALE_SESSION_GENERATION"),
    Type.Literal("STALE_OPERATION"), Type.Literal("STALE_SESSION_CATALOG"),
    Type.Literal("DUPLICATE_REQUEST"), Type.Literal("BUSY"),
    Type.Literal("OPERATION_NOT_FOUND"), Type.Literal("SESSION_CHANGED_EXTERNALLY"),
    Type.Literal("CONFIGURATION_CHANGED_EXTERNALLY"),
    Type.Literal("RUNTIME_NOT_READY"), Type.Literal("RUNTIME_POISONED"),
    Type.Literal("MODEL_NOT_FOUND"), Type.Literal("WORKSPACE_NOT_TRUSTED"),
    Type.Literal("PATH_OUTSIDE_WORKSPACE"), Type.Literal("RESOURCE_LIMIT_EXCEEDED"),
    Type.Literal("UNSUPPORTED"), Type.Literal("INTERNAL")
  ]),
  message: Type.String({ maxLength: 4_096 }),
  recoverable: Type.Boolean(),
  retryAfterMs: Type.Optional(Type.Number({ minimum: 0 })),
  details: Type.Optional(ProtocolErrorDetailsSchema)
});

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
