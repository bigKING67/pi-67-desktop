import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { imageSourceProviderId, type ImageSourceApi } from "@pi67/domain";
import type { PiImageGenerationSource } from "@pi67/protocol";
import { generateArkImages } from "./image-workbench-ark-images.js";
import { generateOpenAIImages, type GenerateImages } from "./image-workbench-openai-images.js";
import { parseSettingsDocument } from "./pi-configuration-documents.js";

type ProviderConfig = Parameters<ModelRuntime["registerProvider"]>[1];

const IMAGE_APIS: Record<ImageSourceApi, GenerateImages> = { "openai-images": generateOpenAIImages, "ark-images": generateArkImages };

/** The user's image sources from global `settings.json`; an unreadable or invalid file yields none (Settings reports it). */
export async function readImageGenerationSources(agentDirectory: string): Promise<PiImageGenerationSource[]> {
  try { return parseSettingsDocument(await readFile(path.join(agentDirectory, "settings.json"), "utf8")).imageGeneration; }
  catch { return []; }
}

// Pi resolves `!command` and `$ENV` in configured keys; `$$` and `$!` are its literal escapes.
const literalConfigValue = (value: string): string => value.replace(/[$!]/gu, (character) => `$${character}`);

/**
 * One Pi image Provider per source (ADR 0010 decision 14). A reused Provider's
 * address and key are resolved by Pi now and held only in this runtime's
 * memory; a source with its own endpoint leaves the key to Pi (`auth.json`).
 * A source whose reused Provider has no address yet is skipped.
 */
export async function imageSourceRegistrations(runtime: Pick<ModelRuntime, "getAuth" | "getModels">, sources: readonly PiImageGenerationSource[]): Promise<[string, ProviderConfig][]> {
  const registrations: [string, ProviderConfig][] = [];
  for (const source of sources) {
    let baseUrl = source.baseUrl, apiKey: string | undefined;
    if (source.provider !== undefined) {
      const resolved = (await runtime.getAuth(source.provider).catch(() => undefined))?.auth;
      baseUrl = resolved?.baseUrl ?? runtime.getModels(source.provider).find((model) => model.baseUrl)?.baseUrl;
      const key = resolved?.apiKey;
      apiKey = typeof key === "string" && key ? literalConfigValue(key) : undefined;
    }
    if (!baseUrl) continue;
    const models = source.models.map((id) => ({
      id, name: id, type: "image" as const, api: source.api, input: ["text", "image"] as ("text" | "image")[],
      output: ["image"] as ("text" | "image")[], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    }));
    registrations.push([imageSourceProviderId(source.id), {
      name: source.name, baseUrl, ...(apiKey ? { apiKey } : {}), images: { [source.api]: { generateImages: IMAGE_APIS[source.api] } }, models
    } as ProviderConfig]);
  }
  return registrations;
}
