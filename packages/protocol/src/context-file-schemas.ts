import { Type } from "./typebox-schema.js";

export const ContextFileIdSchema = Type.String({
  minLength: 68,
  maxLength: 68,
  pattern: "^ctx_[a-f0-9]{64}$"
});

export const ContextFileRevisionSchema = Type.String({
  minLength: 64,
  maxLength: 64,
  pattern: "^[a-f0-9]{64}$"
});

export const ContextFileContentSchema = Type.String({ maxLength: 1_000_000 });

export const ContextFileListPayloadSchema = strictObject({});
export const ContextFileReadPayloadSchema = strictObject({ id: ContextFileIdSchema });
export const ContextFileSavePayloadSchema = strictObject({
  id: ContextFileIdSchema,
  expectedRevision: ContextFileRevisionSchema,
  content: ContextFileContentSchema
});

export const ContextFileSummarySchema = strictObject({
  id: ContextFileIdSchema,
  name: Type.String({ minLength: 1, maxLength: 512 }),
  path: Type.String({ minLength: 1, maxLength: 32_768 }),
  category: Type.Union([
    Type.Literal("managed-rule"),
    Type.Literal("rules-context"),
    Type.Literal("system-prompt"),
    Type.Literal("append-system-prompt")
  ]),
  scope: Type.Union([
    Type.Literal("managed"),
    Type.Literal("global"),
    Type.Literal("project"),
    Type.Literal("inherited")
  ]),
  origin: Type.Union([
    Type.Literal("desktop"),
    Type.Literal("user"),
    Type.Literal("workspace"),
    Type.Literal("ancestor")
  ]),
  presence: Type.Union([Type.Literal("present"), Type.Literal("missing")]),
  access: Type.Union([
    Type.Literal("read-only"),
    Type.Literal("editable"),
    Type.Literal("creatable")
  ]),
  runtimeState: Type.Union([
    Type.Literal("active"),
    Type.Literal("overridden"),
    Type.Literal("not-loaded"),
    Type.Literal("unavailable")
  ]),
  detail: Type.Optional(Type.String({ maxLength: 1_024 }))
});

export const ContextFileCatalogResultSchema = strictObject({
  items: Type.Array(ContextFileSummarySchema, { maxItems: 512 }),
  workspaceTrusted: Type.Boolean()
});

export const ContextFileReadResultSchema = strictObject({
  item: ContextFileSummarySchema,
  content: ContextFileContentSchema,
  revision: ContextFileRevisionSchema
});

export const ContextFileSaveResultSchema = strictObject({
  item: ContextFileSummarySchema,
  revision: ContextFileRevisionSchema,
  files: ContextFileCatalogResultSchema
});

function strictObject<T extends Parameters<typeof Type.Object>[0]>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
