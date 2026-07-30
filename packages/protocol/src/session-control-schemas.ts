import { Type, type TProperties } from "./typebox-schema.js";

export const ModelSummarySchema = strictObject({
  provider: Type.String(),
  id: Type.String(),
  label: Type.String(),
  configured: Type.Boolean(),
  contextWindow: Type.Optional(Type.Number()),
  reasoning: Type.Boolean()
});

export const ProviderSummarySchema = strictObject({
  id: Type.String(),
  label: Type.String(),
  configured: Type.Boolean(),
  credentialSource: Type.Optional(Type.Union([
    Type.Literal("stored"),
    Type.Literal("runtime"),
    Type.Literal("environment"),
    Type.Literal("fallback"),
    Type.Literal("models_json_key"),
    Type.Literal("models_json_command")
  ])),
  credentialLabel: Type.Optional(Type.String()),
  modelCount: Type.Number()
});

export const SessionControlsViewSchema = strictObject({
  selectedModel: Type.Optional(strictObject({ provider: Type.String(), id: Type.String() })),
  thinkingLevel: Type.String()
});

export const SessionModelCatalogViewSchema = strictObject({
  models: Type.Array(ModelSummarySchema),
  providers: Type.Array(ProviderSummarySchema),
  availableThinkingLevels: Type.Array(Type.String())
});

export const SessionControlResultSchema = strictObject({
  sessionId: Type.String(),
  controls: SessionControlsViewSchema
});

export const SessionModelCatalogResultSchema = strictObject({
  sessionId: Type.String(),
  controls: SessionControlsViewSchema,
  modelCatalog: SessionModelCatalogViewSchema
});

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
