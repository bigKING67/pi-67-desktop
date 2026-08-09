import { Type, type TProperties } from "./typebox-schema.js";
import {
  MAX_EXTENSION_CATALOG_DETAIL_CHARS,
  MAX_EXTENSION_CATALOG_ITEMS,
  MAX_EXTENSION_CATALOG_LABEL_CHARS,
  MAX_EXTENSION_CATALOG_PATH_CHARS,
  MAX_EXTENSION_CATALOG_TOOL_NAME_CHARS,
  MAX_EXTENSION_CATALOG_TOOL_NAMES,
  MAX_EXTENSION_SURFACE_DETAIL_CHARS,
  MAX_EXTENSION_ADAPTER_DESCRIPTION_CHARS,
  MAX_EXTENSION_ADAPTER_ID_CHARS,
  MAX_EXTENSION_ADAPTER_LABEL_CHARS,
  MAX_EXTENSION_ADAPTER_PACKAGE_CHARS,
  MAX_EXTENSION_ADAPTER_VERSION_CHARS
} from "@pi67/domain";

const SurfaceSchema = Type.Union([
  Type.Literal("commands"),
  Type.Literal("tools"),
  Type.Literal("ui-primitives"),
  Type.Literal("tui-custom")
]);
const SurfaceStatusSchema = Type.Union([
  Type.Literal("supported"),
  Type.Literal("partial"),
  Type.Literal("tui-only"),
  Type.Literal("unsupported"),
  Type.Literal("unknown"),
  Type.Literal("not-present")
]);
const OverallStatusSchema = Type.Union([
  Type.Literal("native"),
  Type.Literal("headless"),
  Type.Literal("adapter"),
  Type.Literal("partial"),
  Type.Literal("tui-only"),
  Type.Literal("unsupported"),
  Type.Literal("unknown")
]);
const CatalogPathSchema = Type.String({ minLength: 1, maxLength: MAX_EXTENSION_CATALOG_PATH_CHARS });
const AdapterIdSchema = Type.String({ minLength: 1, maxLength: MAX_EXTENSION_ADAPTER_ID_CHARS });
const AdapterPackageSchema = Type.String({ minLength: 1, maxLength: MAX_EXTENSION_ADAPTER_PACKAGE_CHARS });
const AdapterSurfaceSchema = Type.Union([Type.Literal("commands"), Type.Literal("tools")]);

export const ExtensionCommandAdapterSchema = strictObject({
  adapterId: AdapterIdSchema,
  package: AdapterPackageSchema,
  label: Type.String({ minLength: 1, maxLength: MAX_EXTENSION_ADAPTER_LABEL_CHARS }),
  description: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_EXTENSION_ADAPTER_DESCRIPTION_CHARS }))
});

export const ExtensionToolAdapterSchema = strictObject({
  adapterId: AdapterIdSchema,
  package: AdapterPackageSchema,
  presentation: Type.Union([
    Type.Literal("generic"),
    Type.Literal("command"),
    Type.Literal("read"),
    Type.Literal("change"),
    Type.Literal("delegated")
  ]),
  label: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_EXTENSION_ADAPTER_LABEL_CHARS }))
});

const ExtensionAdapterMatchSchema = strictObject({
  adapterId: AdapterIdSchema,
  schemaVersion: Type.Literal(1),
  package: AdapterPackageSchema,
  installedVersion: Type.String({ minLength: 1, maxLength: MAX_EXTENSION_ADAPTER_VERSION_CHARS }),
  versionRange: Type.String({ minLength: 1, maxLength: MAX_EXTENSION_ADAPTER_VERSION_CHARS }),
  surfaces: Type.Array(AdapterSurfaceSchema, { minItems: 1, maxItems: 2, uniqueItems: true }),
  commandCount: Type.Integer({ minimum: 0, maximum: 128 }),
  toolCount: Type.Integer({ minimum: 0, maximum: 128 })
});

const ExtensionSourceRefSchema = strictObject({
  path: CatalogPathSchema,
  source: CatalogPathSchema,
  scope: Type.Union([Type.Literal("user"), Type.Literal("project"), Type.Literal("temporary")]),
  origin: Type.Union([Type.Literal("package"), Type.Literal("top-level")])
});

const ExtensionSurfaceAssessmentSchema = strictObject({
  surface: SurfaceSchema,
  status: SurfaceStatusSchema,
  detail: Type.String({ maxLength: MAX_EXTENSION_SURFACE_DETAIL_CHARS })
});

const ExtensionCompatibilityAssessmentSchema = strictObject({
  overall: OverallStatusSchema,
  detail: Type.String({ maxLength: MAX_EXTENSION_CATALOG_DETAIL_CHARS }),
  surfaces: Type.Array(ExtensionSurfaceAssessmentSchema, { minItems: 4, maxItems: 4 })
});

const ExtensionCatalogItemSchema = strictObject({
  id: CatalogPathSchema,
  label: Type.String({ minLength: 1, maxLength: MAX_EXTENSION_CATALOG_LABEL_CHARS }),
  path: Type.Optional(CatalogPathSchema),
  loadState: Type.Union([Type.Literal("loaded"), Type.Literal("failed")]),
  source: Type.Optional(ExtensionSourceRefSchema),
  adapter: Type.Optional(ExtensionAdapterMatchSchema),
  assessment: ExtensionCompatibilityAssessmentSchema,
  commandCount: Type.Integer({ minimum: 0, maximum: 100_000 }),
  toolCount: Type.Integer({ minimum: 0, maximum: 100_000 }),
  toolNames: Type.Optional(Type.Array(
    Type.String({ minLength: 1, maxLength: MAX_EXTENSION_CATALOG_TOOL_NAME_CHARS }),
    { maxItems: MAX_EXTENSION_CATALOG_TOOL_NAMES, uniqueItems: true }
  ))
});

export const ExtensionCatalogSchema = strictObject({
  items: Type.Array(ExtensionCatalogItemSchema, { maxItems: MAX_EXTENSION_CATALOG_ITEMS }),
  total: Type.Integer({ minimum: 0 }),
  truncated: Type.Boolean()
});

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
