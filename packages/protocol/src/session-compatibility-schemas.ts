import { Type } from "./typebox-schema.js";

export const SessionCompatibilityViewSchema = Type.Object({
  status: Type.Union([
    Type.Literal("compatible"),
    Type.Literal("partial"),
    Type.Literal("future-format")
  ]),
  currentSupportedVersion: Type.Integer({ minimum: 1 }),
  sessionFormatVersion: Type.Integer({ minimum: 1 }),
  unknownEntryCount: Type.Integer({ minimum: 0 }),
  unrenderableMessageCount: Type.Integer({ minimum: 0 }),
  mutationSafe: Type.Boolean()
}, { additionalProperties: false });
