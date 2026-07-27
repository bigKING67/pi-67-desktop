import { Type, type TProperties } from "typebox";
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
  id: Type.String(),
  label: Type.String(),
  path: Type.Optional(Type.String()),
  status: Type.Union([
    Type.Literal("ready"),
    Type.Literal("partial"),
    Type.Literal("tui-only"),
    Type.Literal("failed")
  ]),
  detail: Type.Optional(Type.String())
});

export const SessionResourceCatalogResultSchema = strictObject({
  sessionId: Type.String(),
  controls: SessionControlsViewSchema,
  modelCatalog: SessionModelCatalogViewSchema,
  resources: Type.Array(ResourceSummarySchema)
});

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
