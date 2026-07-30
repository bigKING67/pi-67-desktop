import { Type } from "./typebox-schema.js";

const PackageSourceSchema = Type.String({
  minLength: 1,
  maxLength: 4_096,
  pattern: "^(?![\\s\\S]*\\u0000)(?=[\\s\\S]*\\S)[\\s\\S]+$"
});
const PackageScopeSchema = Type.Union([Type.Literal("global"), Type.Literal("project")]);
const PackageResourceTypeSchema = Type.Union([
  Type.Literal("extension"),
  Type.Literal("skill"),
  Type.Literal("prompt"),
  Type.Literal("theme")
]);
const PackageManifestTextSchema = (maximum: number) => Type.String({
  minLength: 1,
  maxLength: maximum,
  pattern: "^(?![\\s\\S]*[\\u0000-\\u001F\\u007F])(?=[\\s\\S]*\\S)[\\s\\S]+$"
});

export const ExtensionPackageTargetSchema = strictObject({
  source: PackageSourceSchema,
  scope: PackageScopeSchema
});

export const ExtensionPackageEnabledTargetSchema = strictObject({
  source: PackageSourceSchema,
  scope: PackageScopeSchema,
  enabled: Type.Boolean(),
  resourceType: Type.Optional(PackageResourceTypeSchema)
});

export const ExtensionPackageInheritanceTargetSchema = strictObject({
  source: PackageSourceSchema
});

const ExtensionPackageEntrySchema = strictObject({
  source: PackageSourceSchema,
  scope: PackageScopeSchema,
  enabled: Type.Boolean(),
  filtered: Type.Boolean(),
  installed: Type.Boolean(),
  displayName: Type.Optional(PackageManifestTextSchema(200)),
  version: Type.Optional(PackageManifestTextSchema(100)),
  description: Type.Optional(PackageManifestTextSchema(320)),
  sourceKind: Type.Optional(Type.Union([
    Type.Literal("bundled"), Type.Literal("npm"), Type.Literal("git"), Type.Literal("path")
  ])),
  origin: Type.Optional(Type.Union([
    Type.Literal("first-party"), Type.Literal("third-party"), Type.Literal("external")
  ])),
  resourceTypes: Type.Optional(Type.Array(PackageResourceTypeSchema, { maxItems: 4 })),
  resourceStates: Type.Optional(Type.Array(strictObject({
    type: PackageResourceTypeSchema,
    enabled: Type.Boolean()
  }), { maxItems: 4 }))
});

export const ExtensionPackageListResultSchema = strictObject({
  items: Type.Array(ExtensionPackageEntrySchema, { maxItems: 512 }),
  total: Type.Integer({ minimum: 0, maximum: 512 })
});

export const ExtensionPackageMutationResultSchema = strictObject({
  items: Type.Array(ExtensionPackageEntrySchema, { maxItems: 512 }),
  total: Type.Integer({ minimum: 0, maximum: 512 }),
  changed: Type.Boolean()
});

const ExtensionPackageUpdateSchema = strictObject({
  source: PackageSourceSchema,
  scope: PackageScopeSchema,
  type: Type.Union([Type.Literal("npm"), Type.Literal("git")]),
  displayName: Type.String({ minLength: 1, maxLength: 512 })
});

export const ExtensionPackageUpdatesResultSchema = strictObject({
  items: Type.Array(ExtensionPackageUpdateSchema, { maxItems: 512 }),
  total: Type.Integer({ minimum: 0, maximum: 512 })
});

function strictObject<T extends Parameters<typeof Type.Object>[0]>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
