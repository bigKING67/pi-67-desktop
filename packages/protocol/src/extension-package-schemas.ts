import { Type } from "typebox";

const PackageSourceSchema = Type.String({
  minLength: 1,
  maxLength: 4_096,
  pattern: "^(?![\\s\\S]*\\u0000)(?=[\\s\\S]*\\S)[\\s\\S]+$"
});
const PackageScopeSchema = Type.Union([Type.Literal("global"), Type.Literal("project")]);

export const ExtensionPackageTargetSchema = strictObject({
  source: PackageSourceSchema,
  scope: PackageScopeSchema
});

export const ExtensionPackageEnabledTargetSchema = strictObject({
  source: PackageSourceSchema,
  scope: PackageScopeSchema,
  enabled: Type.Boolean()
});

export const ExtensionPackageInheritanceTargetSchema = strictObject({
  source: PackageSourceSchema
});

const ExtensionPackageEntrySchema = strictObject({
  source: PackageSourceSchema,
  scope: PackageScopeSchema,
  enabled: Type.Boolean(),
  filtered: Type.Boolean(),
  installed: Type.Boolean()
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
