import { MAX_SESSION_FILE_IDENTITY_CHARS } from "@pi67/domain";
import { MAX_SESSION_CREATION_ID_CHARS } from "./agent-messages.js";
import { Type } from "./typebox-schema.js";

export const SessionCreationIdSchema = Type.String({
  minLength: 1,
  maxLength: MAX_SESSION_CREATION_ID_CHARS,
  pattern: "^[A-Za-z0-9_-]+$"
});

export const SessionCreationResolutionSchema = Type.Union([
  Type.Object({
    status: Type.Literal("materialized"),
    creationId: SessionCreationIdSchema,
    sessionId: Type.String({ minLength: 1, maxLength: 1_024 }),
    sessionFileIdentity: Type.String({ minLength: 1, maxLength: MAX_SESSION_FILE_IDENTITY_CHARS }),
    sessionPath: Type.String({ minLength: 1, maxLength: 32_768 })
  }, { additionalProperties: false }),
  Type.Object({
    status: Type.Union([Type.Literal("missing"), Type.Literal("ambiguous")]),
    creationId: SessionCreationIdSchema
  }, { additionalProperties: false }),
  Type.Object({
    status: Type.Literal("unavailable"),
    creationId: SessionCreationIdSchema,
    reason: Type.Union([Type.Literal("scan-limit"), Type.Literal("storage-error")])
  }, { additionalProperties: false })
]);
