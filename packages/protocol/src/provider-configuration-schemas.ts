import { Type, type TProperties } from "./typebox-schema.js";

export type PiConfigurationFileKind = "models" | "auth" | "global-settings" | "project-settings";
export type PiConfigurationChangeSource = "desktop" | "external" | "manual" | "catalog";
export type PiConfigurationReloadState = "applied" | "pending" | "not-loaded";
export type PiModelCatalogRefreshStatus =
  | "current"
  | "partial"
  | "timed-out"
  | "offline"
  | "unconfigured";

export interface PiConfigurationDiagnostic {
  file: PiConfigurationFileKind;
  message: string;
}

export interface PiConfigurationFileStatus {
  kind: PiConfigurationFileKind;
  path: string;
  exists: boolean;
  valid: boolean;
  modifiedAt?: number;
}

export interface PiCredentialSummary {
  provider: string;
  type: "api_key" | "oauth";
}

export type PiCredentialRevealResult =
  | { provider: string; status: "revealed"; apiKey: string }
  | { provider: string; status: "not-found" | "not-api-key" | "indirect" };

export interface PiModelConfigurationView {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  input: Array<"text" | "image">;
  reasoning: boolean;
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevels?: string[];
  headerNames: string[];
  advancedJson: string;
}

export interface PiProviderConfigurationView {
  id: string;
  name?: string;
  baseUrl?: string;
  api?: string;
  oauth?: "radius";
  authHeader?: boolean;
  origin: "models.json" | "builtin";
  configured: boolean;
  credentialSource?: "stored" | "runtime" | "environment" | "fallback" | "models_json_key" | "models_json_command";
  credentialLabel?: string;
  modelsJsonApiKeyConfigured: boolean;
  headerNames: string[];
  models: PiModelConfigurationView[];
  modelCount: number;
  advancedJson: string;
}

export interface PiDefaultModelSelection {
  provider: string;
  model: string;
}

export interface PiDefaultModelConfiguration {
  global?: PiDefaultModelSelection;
  project?: PiDefaultModelSelection;
  effective?: PiDefaultModelSelection;
  projectTrusted: boolean;
}

export type PiVisionAssistantOverride =
  | { mode: "disabled" }
  | { mode: "model"; provider: string; model: string };

export interface PiVisionAssistantConfiguration {
  global?: PiDefaultModelSelection;
  project?: PiVisionAssistantOverride;
  effective?: PiDefaultModelSelection;
  disabledByProject: boolean;
  projectTrusted: boolean;
}

export interface PiProviderConfigurationSnapshot {
  revision: string;
  syncState: "current" | "invalid";
  updatedAt: number;
  providers: PiProviderConfigurationView[];
  credentials: PiCredentialSummary[];
  defaults: PiDefaultModelConfiguration;
  vision: PiVisionAssistantConfiguration;
  files: PiConfigurationFileStatus[];
  diagnostics: PiConfigurationDiagnostic[];
}

export interface PiConfigurationHeaderMutation {
  name: string;
  value?: string;
  remove?: boolean;
}

export interface PiModelConfigurationInput {
  id: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  input?: Array<"text" | "image">;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  headers?: PiConfigurationHeaderMutation[];
  advancedJson?: string;
}

export interface PiProviderConfigurationInput {
  id: string;
  name?: string;
  baseUrl?: string;
  api?: string;
  oauth?: "radius";
  authHeader?: boolean;
  headers?: PiConfigurationHeaderMutation[];
  models: PiModelConfigurationInput[];
  advancedJson?: string;
}

export interface PiProviderConfigurationChanged {
  snapshot: PiProviderConfigurationSnapshot;
  source: PiConfigurationChangeSource;
  changedFiles: PiConfigurationFileKind[];
  taskReload: PiConfigurationReloadState;
}

export interface PiModelCatalogRefreshResult {
  status: PiModelCatalogRefreshStatus;
  snapshot: PiProviderConfigurationSnapshot;
  providers: string[];
  failedProviders: string[];
}

const IdentifierSchema = Type.String({ minLength: 1, maxLength: 512 });
const RevisionSchema = Type.String({ minLength: 64, maxLength: 64, pattern: "^[0-9a-f]{64}$" });
const OptionalTextSchema = Type.Optional(Type.String({ minLength: 1, maxLength: 16_384 }));
const AdvancedJsonSchema = Type.Optional(Type.String({ maxLength: 262_144 }));
const InputKindSchema = Type.Union([Type.Literal("text"), Type.Literal("image")]);

export const PiConfigurationHeaderMutationSchema = strictObject({
  name: Type.String({ minLength: 1, maxLength: 256 }),
  value: Type.Optional(Type.String({ minLength: 1, maxLength: 16_384 })),
  remove: Type.Optional(Type.Boolean())
});

export const PiModelConfigurationInputSchema = strictObject({
  id: IdentifierSchema,
  name: OptionalTextSchema,
  api: OptionalTextSchema,
  baseUrl: OptionalTextSchema,
  input: Type.Optional(Type.Array(InputKindSchema, { minItems: 1, maxItems: 2, uniqueItems: true })),
  reasoning: Type.Optional(Type.Boolean()),
  contextWindow: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
  maxTokens: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
  headers: Type.Optional(Type.Array(PiConfigurationHeaderMutationSchema, { maxItems: 128 })),
  advancedJson: AdvancedJsonSchema
});

export const PiProviderConfigurationInputSchema = strictObject({
  id: IdentifierSchema,
  name: OptionalTextSchema,
  baseUrl: OptionalTextSchema,
  api: OptionalTextSchema,
  oauth: Type.Optional(Type.Literal("radius")),
  authHeader: Type.Optional(Type.Boolean()),
  headers: Type.Optional(Type.Array(PiConfigurationHeaderMutationSchema, { maxItems: 128 })),
  models: Type.Array(PiModelConfigurationInputSchema, { maxItems: 512 }),
  advancedJson: AdvancedJsonSchema
});

const PiConfigurationFileKindSchema = Type.Union([
  Type.Literal("models"),
  Type.Literal("auth"),
  Type.Literal("global-settings"),
  Type.Literal("project-settings")
]);

const PiConfigurationDiagnosticSchema = strictObject({
  file: PiConfigurationFileKindSchema,
  message: Type.String({ minLength: 1, maxLength: 4_096 })
});

const PiConfigurationFileStatusSchema = strictObject({
  kind: PiConfigurationFileKindSchema,
  path: Type.String({ minLength: 1, maxLength: 32_768 }),
  exists: Type.Boolean(),
  valid: Type.Boolean(),
  modifiedAt: Type.Optional(Type.Number({ minimum: 0 }))
});

const PiCredentialSummarySchema = strictObject({
  provider: IdentifierSchema,
  type: Type.Union([Type.Literal("api_key"), Type.Literal("oauth")])
});

export const PiCredentialRevealResultSchema = Type.Union([
  strictObject({
    provider: IdentifierSchema,
    status: Type.Literal("revealed"),
    apiKey: Type.String({ minLength: 1, maxLength: 16_384 })
  }),
  strictObject({
    provider: IdentifierSchema,
    status: Type.Union([
      Type.Literal("not-found"),
      Type.Literal("not-api-key"),
      Type.Literal("indirect")
    ])
  })
]);

const CredentialSourceSchema = Type.Union([
  Type.Literal("stored"),
  Type.Literal("runtime"),
  Type.Literal("environment"),
  Type.Literal("fallback"),
  Type.Literal("models_json_key"),
  Type.Literal("models_json_command")
]);

const PiModelConfigurationViewSchema = strictObject({
  id: IdentifierSchema,
  name: OptionalTextSchema,
  api: OptionalTextSchema,
  baseUrl: OptionalTextSchema,
  input: Type.Array(InputKindSchema, { minItems: 1, maxItems: 2, uniqueItems: true }),
  reasoning: Type.Boolean(),
  contextWindow: Type.Optional(Type.Number({ minimum: 1 })),
  maxTokens: Type.Optional(Type.Number({ minimum: 1 })),
  thinkingLevels: Type.Optional(Type.Array(IdentifierSchema, { maxItems: 7, uniqueItems: true })),
  headerNames: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 128 }),
  advancedJson: Type.String({ maxLength: 262_144 })
});

const PiProviderConfigurationViewSchema = strictObject({
  id: IdentifierSchema,
  name: OptionalTextSchema,
  baseUrl: OptionalTextSchema,
  api: OptionalTextSchema,
  oauth: Type.Optional(Type.Literal("radius")),
  authHeader: Type.Optional(Type.Boolean()),
  origin: Type.Union([Type.Literal("models.json"), Type.Literal("builtin")]),
  configured: Type.Boolean(),
  credentialSource: Type.Optional(CredentialSourceSchema),
  credentialLabel: OptionalTextSchema,
  modelsJsonApiKeyConfigured: Type.Boolean(),
  headerNames: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 128 }),
  models: Type.Array(PiModelConfigurationViewSchema, { maxItems: 512 }),
  modelCount: Type.Integer({ minimum: 0 }),
  advancedJson: Type.String({ maxLength: 262_144 })
});

const PiDefaultModelSelectionSchema = strictObject({
  provider: IdentifierSchema,
  model: IdentifierSchema
});

const PiDefaultModelConfigurationSchema = strictObject({
  global: Type.Optional(PiDefaultModelSelectionSchema),
  project: Type.Optional(PiDefaultModelSelectionSchema),
  effective: Type.Optional(PiDefaultModelSelectionSchema),
  projectTrusted: Type.Boolean()
});

const PiVisionAssistantOverrideSchema = Type.Union([
  strictObject({ mode: Type.Literal("disabled") }),
  strictObject({
    mode: Type.Literal("model"),
    provider: IdentifierSchema,
    model: IdentifierSchema
  })
]);

const PiVisionAssistantConfigurationSchema = strictObject({
  global: Type.Optional(PiDefaultModelSelectionSchema),
  project: Type.Optional(PiVisionAssistantOverrideSchema),
  effective: Type.Optional(PiDefaultModelSelectionSchema),
  disabledByProject: Type.Boolean(),
  projectTrusted: Type.Boolean()
});

export const PiProviderConfigurationSnapshotSchema = strictObject({
  revision: RevisionSchema,
  syncState: Type.Union([Type.Literal("current"), Type.Literal("invalid")]),
  updatedAt: Type.Number({ minimum: 0 }),
  providers: Type.Array(PiProviderConfigurationViewSchema, { maxItems: 512 }),
  credentials: Type.Array(PiCredentialSummarySchema, { maxItems: 512 }),
  defaults: PiDefaultModelConfigurationSchema,
  vision: PiVisionAssistantConfigurationSchema,
  files: Type.Array(PiConfigurationFileStatusSchema, { minItems: 4, maxItems: 4 }),
  diagnostics: Type.Array(PiConfigurationDiagnosticSchema, { maxItems: 64 })
});

export const PiProviderConfigurationChangedSchema = strictObject({
  snapshot: PiProviderConfigurationSnapshotSchema,
  source: Type.Union([
    Type.Literal("desktop"),
    Type.Literal("external"),
    Type.Literal("manual"),
    Type.Literal("catalog")
  ]),
  changedFiles: Type.Array(PiConfigurationFileKindSchema, { maxItems: 4, uniqueItems: true }),
  taskReload: Type.Union([Type.Literal("applied"), Type.Literal("pending"), Type.Literal("not-loaded")])
});

export const PiModelCatalogRefreshResultSchema = strictObject({
  status: Type.Union([
    Type.Literal("current"),
    Type.Literal("partial"),
    Type.Literal("timed-out"),
    Type.Literal("offline"),
    Type.Literal("unconfigured")
  ]),
  snapshot: PiProviderConfigurationSnapshotSchema,
  providers: Type.Array(IdentifierSchema, { maxItems: 512, uniqueItems: true }),
  failedProviders: Type.Array(IdentifierSchema, { maxItems: 512, uniqueItems: true })
});

export const PiConfigurationExpectedRevisionSchema = RevisionSchema;
export const PiConfigurationProviderIdSchema = IdentifierSchema;

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
