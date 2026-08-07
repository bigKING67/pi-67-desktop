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
const Sha256Schema = Type.String({ pattern: "^[a-f0-9]{64}$" });
const ExtensionPackageTrustStateSchema = Type.Union([
  Type.Literal("builtin-verified"),
  Type.Literal("user-installed-observed"),
  Type.Literal("unverified"),
  Type.Literal("drifted"),
  Type.Literal("unavailable")
]);
const ExtensionPackageIntegrityReasonSchema = Type.Union([
  Type.Literal("receipt-missing"),
  Type.Literal("install-content-missing"),
  Type.Literal("package-identity-changed"),
  Type.Literal("manifest-changed"),
  Type.Literal("directory-identity-changed"),
  Type.Literal("content-hash-changed"),
  Type.Literal("receipt-invalid"),
  Type.Literal("inspection-limited"),
  Type.Literal("mutation-ambiguous")
]);

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
  }), { maxItems: 4 })),
  trustState: ExtensionPackageTrustStateSchema,
  trustReason: Type.Optional(ExtensionPackageIntegrityReasonSchema),
  trustObservedAt: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  manifestSha256: Type.Optional(Sha256Schema),
  contentSha256: Type.Optional(Sha256Schema)
});

export const ExtensionPackageListResultSchema = strictObject({
  items: Type.Array(ExtensionPackageEntrySchema, { maxItems: 512 }),
  total: Type.Integer({ minimum: 0, maximum: 512 })
});

export const ExtensionPackageMutationResultSchema = strictObject({
  items: Type.Array(ExtensionPackageEntrySchema, { maxItems: 512 }),
  total: Type.Integer({ minimum: 0, maximum: 512 }),
  changed: Type.Boolean(),
  receiptState: Type.Optional(Type.Union([
    Type.Literal("active"),
    Type.Literal("removed"),
    Type.Literal("ambiguous"),
    Type.Literal("not-applicable")
  ]))
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
