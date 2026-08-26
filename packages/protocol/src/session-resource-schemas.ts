import { Type, type TProperties } from "./typebox-schema.js";
import {
  MAX_RESOURCE_CATALOG_ITEMS,
  MAX_RESOURCE_DETAIL_CHARS,
  MAX_RESOURCE_ID_CHARS,
  MAX_RESOURCE_LABEL_CHARS,
  MAX_RESOURCE_PATH_CHARS,
  MAX_RESOURCE_SOURCE_CHARS
} from "@pi67/domain";
import {
  SessionControlsViewSchema,
  SessionModelCatalogViewSchema
} from "./session-control-schemas.js";

export const ResourceSummarySchema = strictObject({
  kind: Type.Union([
    Type.Literal("skill"),
    Type.Literal("prompt"),
    Type.Literal("extension"),
    Type.Literal("context")
  ]),
  id: Type.String({ minLength: 1, maxLength: MAX_RESOURCE_ID_CHARS }),
  label: Type.String({ minLength: 1, maxLength: MAX_RESOURCE_LABEL_CHARS }),
  path: Type.Optional(Type.String({ maxLength: MAX_RESOURCE_PATH_CHARS })),
  source: Type.Optional(Type.String({ maxLength: MAX_RESOURCE_SOURCE_CHARS })),
  scope: Type.Optional(Type.Union([
    Type.Literal("user"),
    Type.Literal("project"),
    Type.Literal("temporary")
  ])),
  origin: Type.Optional(Type.Union([
    Type.Literal("package"),
    Type.Literal("top-level")
  ])),
  status: Type.Union([
    Type.Literal("ready"),
    Type.Literal("partial"),
    Type.Literal("tui-only"),
    Type.Literal("failed")
  ]),
  detail: Type.Optional(Type.String({ maxLength: MAX_RESOURCE_DETAIL_CHARS }))
});

export const ResourceCatalogDispositionSchema = strictObject({
  totalItems: Type.Integer({ minimum: 0 }),
  projectedItems: Type.Integer({ minimum: 0, maximum: MAX_RESOURCE_CATALOG_ITEMS }),
  omittedItems: Type.Integer({ minimum: 0 }),
  truncatedFields: Type.Integer({ minimum: 0 }),
  truncated: Type.Boolean()
});

export const ResourceCatalogProjectionSchema = strictObject({
  resources: Type.Array(ResourceSummarySchema, { maxItems: MAX_RESOURCE_CATALOG_ITEMS }),
  resourceCatalog: ResourceCatalogDispositionSchema
});

export const SessionResourceCatalogResultSchema = strictObject({
  sessionId: Type.String(),
  controls: SessionControlsViewSchema,
  modelCatalog: SessionModelCatalogViewSchema,
  resources: Type.Array(ResourceSummarySchema, { maxItems: MAX_RESOURCE_CATALOG_ITEMS }),
  resourceCatalog: Type.Optional(ResourceCatalogDispositionSchema)
});

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
