import { IMAGE_SOURCE_LIMITS, type ImageSourceApi } from "@pi67/domain";
import { PiConfigurationIdentifierSchema } from "./pi-model-selection-schema.js";
import { strictObject, Type } from "./typebox-schema.js";

// Image generation sources (ADR 0010 decision 14), stored in global Pi
// `settings.json` at `pi67Desktop.imageGeneration`. A source reuses a
// configured Pi Provider (address and key follow it) or names its own
// endpoint whose key lives in Pi `auth.json` under the source's Provider id.

export interface PiImageGenerationSource {
  id: string;
  name: string;
  api: ImageSourceApi;
  /** A configured Pi Provider to reuse; exclusive with `baseUrl`. */
  provider?: string;
  /** The source's own HTTPS or loopback endpoint; exclusive with `provider`. */
  baseUrl?: string;
  models: string[];
}

export interface PiImageGenerationSourceView extends PiImageGenerationSource {
  /** The Pi Provider id the source registers (`newmoney-images-<id>`). */
  piProvider: string;
  /** The endpoint requests go to: the reused Provider's or the source's own. */
  endpoint?: string;
  credential: "reused" | "stored" | "missing";
}

export interface PiImageGenerationConfiguration {
  sources: PiImageGenerationSourceView[];
}

export interface ImageGenerationCommandPayloads {
  "image.generation.sources.set": { expectedRevision: string; sources: PiImageGenerationSource[] };
}

const SourceIdSchema = Type.String({ minLength: 1, maxLength: 24, pattern: "^[a-z][a-z0-9-]{0,23}$" });
const ModelIdSchema = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$" });
const sourceFields = {
  id: SourceIdSchema,
  name: Type.String({ minLength: 1, maxLength: IMAGE_SOURCE_LIMITS.nameChars, pattern: "\\S" }),
  api: Type.Union([Type.Literal("openai-images"), Type.Literal("ark-images")]),
  provider: Type.Optional(PiConfigurationIdentifierSchema),
  baseUrl: Type.Optional(Type.String({ minLength: 1, maxLength: IMAGE_SOURCE_LIMITS.baseUrlBytes, pattern: "^https?://" })),
  models: Type.Array(ModelIdSchema, { minItems: 1, maxItems: IMAGE_SOURCE_LIMITS.modelsPerSource })
};

export const PiImageGenerationSourceSchema = strictObject(sourceFields);

export const PiImageGenerationConfigurationSchema = strictObject({
  sources: Type.Array(strictObject({
    ...sourceFields,
    piProvider: Type.String({ minLength: 1, maxLength: 64, pattern: "^newmoney-images-[a-z][a-z0-9-]{0,23}$" }),
    endpoint: Type.Optional(Type.String({ minLength: 1, maxLength: IMAGE_SOURCE_LIMITS.baseUrlBytes })),
    credential: Type.Union([Type.Literal("reused"), Type.Literal("stored"), Type.Literal("missing")])
  }), { maxItems: IMAGE_SOURCE_LIMITS.sources })
});

export const ImageGenerationCommandPayloadSchemas = {
  "image.generation.sources.set": strictObject({
    expectedRevision: Type.String({ minLength: 64, maxLength: 64, pattern: "^[0-9a-f]{64}$" }),
    sources: Type.Array(PiImageGenerationSourceSchema, { maxItems: IMAGE_SOURCE_LIMITS.sources })
  })
} as const;
