import { readFileSync } from "node:fs";
import path from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import { IMAGE_PROVIDER_API, IMAGE_PROVIDER_ID } from "@pi67/domain";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { generateOpenAIImages } from "./image-workbench-openai-images.js";

type ProviderConfig = Parameters<ExtensionAPI["registerProvider"]>[1];

/**
 * The image Provider's base URL from the user's Pi `models.json` entry
 * `"newmoney-images": { "baseUrl": ..., "apiKey": ... }`. Pi stays the only
 * configuration source: the key is never read here, Pi resolves it per request
 * (`models.json`, environment interpolation or `auth.json`).
 */
export function imageProviderBaseUrl(agentDirectory: string): string | undefined {
  let text: string;
  try { text = readFileSync(path.join(agentDirectory, "models.json"), "utf8"); } catch { return undefined; }
  const errors: ParseError[] = [];
  const parsed: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || typeof parsed !== "object" || parsed === null) return undefined;
  const providers = (parsed as { providers?: unknown }).providers;
  const entry = typeof providers === "object" && providers !== null ? (providers as Record<string, unknown>)[IMAGE_PROVIDER_ID] : undefined;
  const baseUrl = typeof entry === "object" && entry !== null ? (entry as { baseUrl?: unknown }).baseUrl : undefined;
  return typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim() : undefined;
}

// The models behind the engine's Provider profiles (`PROFILE_MODELS`, kept equal by a
// test). Listed statically so registering the Provider never loads the engine.
const IMAGE_MODELS: readonly (readonly [id: string, name: string])[] = [
  ["gpt-image-2.5-flare", "GPT Image 2.5 Flare"], ["gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst"]
];

/** The Pi registration: image models from the engine's Provider profiles and the `openai-images` API. */
export function imageProviderRegistration(baseUrl: string): ProviderConfig {
  const models = IMAGE_MODELS.map(([id, name]) => ({
    id, name, type: "image" as const, api: IMAGE_PROVIDER_API, input: ["text", "image"] as ("text" | "image")[],
    output: ["image"] as ("text" | "image")[], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  }));
  return { name: "New Money 图像", baseUrl, images: { [IMAGE_PROVIDER_API]: { generateImages: generateOpenAIImages } }, models } as ProviderConfig;
}
