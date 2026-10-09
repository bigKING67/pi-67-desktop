import {
  IMAGE_PROVIDER_ID,
  IMAGE_SOURCE_APIS,
  IMAGE_SOURCE_LIMITS,
  imageSourceProviderId,
  isImageSourceId,
  isImageSourceModelId,
  type ImageSourceApi
} from "@pi67/domain";
import type {
  PiCredentialSummary,
  PiImageGenerationConfiguration,
  PiImageGenerationSource,
  PiProviderConfigurationView
} from "@pi67/protocol";
import { endpointUrl } from "./image-workbench-http.js";

// `settings.json` `pi67Desktop.imageGeneration.sources` (ADR 0010 decision 14).
// Keys never live here: a source reuses a Pi Provider's credential, or its own
// key sits in `auth.json` under the source's Pi Provider id.

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const SOURCE_KEYS = new Set(["id", "name", "api", "provider", "baseUrl", "models"]);

function invalid(detail: string): never {
  throw new Error(`settings.json pi67Desktop.imageGeneration ${detail}.`);
}

export function parseImageGenerationSources(value: unknown): PiImageGenerationSource[] {
  if (value === undefined) return [];
  if (!isObject(value) || !Array.isArray(value.sources)) invalid("must contain a sources array");
  if (value.sources.length > IMAGE_SOURCE_LIMITS.sources) invalid(`allows at most ${IMAGE_SOURCE_LIMITS.sources} sources`);
  const ids = new Set<string>();
  return value.sources.map((raw: unknown) => {
    if (!isObject(raw) || Object.keys(raw).some((key) => !SOURCE_KEYS.has(key))) invalid("sources must be objects with id, name, api, provider or baseUrl, and models");
    const { id, name, api, provider, baseUrl, models } = raw;
    if (!isImageSourceId(id) || ids.has(id)) invalid("source ids must be unique lowercase identifiers");
    ids.add(id);
    if (typeof name !== "string" || !name.trim() || name.length > IMAGE_SOURCE_LIMITS.nameChars) invalid(`source ${id} needs a name`);
    if (!IMAGE_SOURCE_APIS.includes(api as ImageSourceApi)) invalid(`source ${id} has an unsupported api`);
    if ((provider === undefined) === (baseUrl === undefined)) invalid(`source ${id} must reuse a provider or name its own baseUrl`);
    if (provider !== undefined && (typeof provider !== "string" || !provider.trim() || provider.startsWith(IMAGE_PROVIDER_ID))) invalid(`source ${id} reuses an invalid provider`);
    if (baseUrl !== undefined) {
      let allowed = typeof baseUrl === "string";
      try { if (allowed) endpointUrl(baseUrl as string, "images"); } catch { allowed = false; }
      if (!allowed) invalid(`source ${id} baseUrl must be HTTPS or loopback without credentials or query`);
    }
    if (!Array.isArray(models) || !models.length || models.length > IMAGE_SOURCE_LIMITS.modelsPerSource ||
      !models.every(isImageSourceModelId) || new Set(models).size !== models.length) invalid(`source ${id} needs 1-${IMAGE_SOURCE_LIMITS.modelsPerSource} unique model ids`);
    return { id, name: name.trim(), api: api as ImageSourceApi, ...(provider === undefined ? {} : { provider: provider as string }),
      ...(baseUrl === undefined ? {} : { baseUrl: baseUrl as string }), models: [...models] };
  });
}

/** The Settings view: where each source sends requests and whether a key is available. */
export function projectImageGeneration(
  sources: readonly PiImageGenerationSource[],
  providers: readonly PiProviderConfigurationView[],
  credentials: readonly PiCredentialSummary[]
): PiImageGenerationConfiguration {
  return {
    sources: sources.map((source) => {
      const piProvider = imageSourceProviderId(source.id);
      const reused = source.provider === undefined ? undefined : providers.find((item) => item.id === source.provider);
      const endpoint = source.baseUrl ?? reused?.baseUrl ?? reused?.models.find((model) => model.baseUrl)?.baseUrl;
      const credential = source.provider === undefined
        ? credentials.some((item) => item.provider === piProvider) ? "stored" as const : "missing" as const
        : reused?.credentialSource !== undefined || reused?.modelsJsonApiKeyConfigured ? "reused" as const : "missing" as const;
      return { ...source, piProvider, ...(endpoint ? { endpoint } : {}), credential };
    })
  };
}

/** Image source Providers are managed in their own Settings section, not the Provider list. */
export function isImageSourceProvider(providerId: string): boolean {
  return providerId.startsWith(`${IMAGE_PROVIDER_ID}-`);
}
