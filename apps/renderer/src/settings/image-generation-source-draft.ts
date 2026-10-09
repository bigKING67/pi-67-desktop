import { IMAGE_SOURCE_LIMITS, isImageSourceId, isImageSourceModelId, type ImageSourceApi } from "@pi67/domain";
import type { PiImageGenerationSource, PiImageGenerationSourceView, PiProviderConfigurationSnapshot } from "@pi67/protocol";

// Editing one image generation source (ADR 0010 decision 14). The key typed
// for an own endpoint is write-only: it travels once to Pi's credential store
// and an empty field keeps whatever key is stored.

export interface ImageSourceDraft {
  /** Set when editing an existing source; its id never changes. */
  existingId?: string;
  name: string;
  api: ImageSourceApi;
  mode: "reuse" | "own";
  provider: string;
  baseUrl: string;
  models: string[];
  apiKey: string;
}

export interface ReusableProvider { id: string; label: string; endpoint: string }

export const IMAGE_API_LABELS: Readonly<Record<ImageSourceApi, string>> = { "openai-images": "OpenAI 兼容图像接口", "ark-images": "火山方舟 Seedream" };

const IMAGE_MODEL_HINT = /image|seedream|dall-?e|flux|imagen|banana|kolors|cogview|wanx|recraft|ideogram|midjourney|sdxl|stable-diffusion/iu;

/** Whether a catalog id is probably an image generation model, for pre-selection only. */
export function isLikelyImageModel(id: string): boolean {
  return IMAGE_MODEL_HINT.test(id);
}

/** Ark speaks its own Seedream API; everything else defaults to the OpenAI Images shape. */
export function guessImageApi(endpoint: string | undefined, models: readonly string[] = []): ImageSourceApi {
  return /volces\.com|volcengine/iu.test(endpoint ?? "") || models.some((model) => /seedream/iu.test(model)) ? "ark-images" : "openai-images";
}

/** Configured Pi Providers a source can reuse: they need an address and a key. */
export function reusableProviders(snapshot: PiProviderConfigurationSnapshot): ReusableProvider[] {
  return snapshot.providers.flatMap((provider) => {
    const endpoint = provider.baseUrl ?? provider.models.find((model) => model.baseUrl)?.baseUrl;
    const keyed = provider.credentialSource !== undefined || provider.modelsJsonApiKeyConfigured;
    return provider.configured && endpoint && keyed ? [{ id: provider.id, label: provider.name ?? provider.id, endpoint }] : [];
  });
}

export function newSourceDraft(snapshot: PiProviderConfigurationSnapshot): ImageSourceDraft {
  const first = reusableProviders(snapshot)[0];
  return first
    ? { name: first.label, api: guessImageApi(first.endpoint), mode: "reuse", provider: first.id, baseUrl: "", models: [], apiKey: "" }
    : { name: "", api: "openai-images", mode: "own", provider: "", baseUrl: "", models: [], apiKey: "" };
}

export function draftFromSource(source: PiImageGenerationSourceView): ImageSourceDraft {
  return { existingId: source.id, name: source.name, api: source.api, mode: source.provider === undefined ? "own" : "reuse",
    provider: source.provider ?? "", baseUrl: source.baseUrl ?? "", models: [...source.models], apiKey: "" };
}

/** A stable id from the reused Provider or the endpoint's host, unique among existing sources. */
export function sourceIdFor(draft: ImageSourceDraft, taken: ReadonlySet<string>): string {
  if (draft.existingId) return draft.existingId;
  let seed = draft.mode === "reuse" ? draft.provider : "";
  if (draft.mode === "own") {
    try { seed = new URL(draft.baseUrl).hostname.split(".").find((part) => !["www", "api"].includes(part)) ?? ""; } catch { seed = ""; }
  }
  const base = seed.toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/^[^a-z]+|-+$/gu, "").slice(0, 20) || "images";
  for (let index = 1; ; index++) {
    const candidate = index === 1 ? base : `${base}-${index}`;
    if (!taken.has(candidate) && isImageSourceId(candidate)) return candidate;
  }
}

/** The first problem that prevents saving, in the words the form shows. */
export function draftProblem(draft: ImageSourceDraft, hasStoredKey: boolean): string | undefined {
  if (!draft.name.trim()) return "请填写名称。";
  if (draft.name.trim().length > IMAGE_SOURCE_LIMITS.nameChars) return `名称最多 ${IMAGE_SOURCE_LIMITS.nameChars} 个字符。`;
  if (draft.mode === "reuse" && !draft.provider) return "请选择要沿用的模型服务。";
  if (draft.mode === "own") {
    let url: URL | undefined;
    try { url = new URL(draft.baseUrl.trim()); } catch { url = undefined; }
    const loopback = url !== undefined && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!url || url.username || url.password || url.search || url.hash || !(url.protocol === "https:" || (url.protocol === "http:" && loopback))) {
      return "地址需为 HTTPS 或本机地址（127.0.0.1），且不能带账号或查询参数。";
    }
    if (!draft.apiKey.trim() && !hasStoredKey) return "请填写 API Key。";
  }
  if (!draft.models.length) return "请至少选择一个模型。";
  if (draft.models.length > IMAGE_SOURCE_LIMITS.modelsPerSource) return `每个来源最多 ${IMAGE_SOURCE_LIMITS.modelsPerSource} 个模型。`;
  if (!draft.models.every(isImageSourceModelId)) return "模型 ID 只能包含字母、数字和 . _ : / -。";
  return undefined;
}

export function toSource(draft: ImageSourceDraft, id: string): PiImageGenerationSource {
  return { id, name: draft.name.trim(), api: draft.api, ...(draft.mode === "reuse" ? { provider: draft.provider } : { baseUrl: draft.baseUrl.trim() }), models: [...draft.models] };
}

const plainSources = (current: readonly PiImageGenerationSourceView[]): PiImageGenerationSource[] => current.map(({ id, name, api, provider, baseUrl, models }) => (
  { id, name, api, ...(provider === undefined ? {} : { provider }), ...(baseUrl === undefined ? {} : { baseUrl }), models }));

/** The sources to save: the edited one replaces itself (or is appended), others keep their order. */
export function nextSources(current: readonly PiImageGenerationSourceView[], source: PiImageGenerationSource): PiImageGenerationSource[] {
  const plain = plainSources(current);
  const index = plain.findIndex((item) => item.id === source.id);
  return index < 0 ? [...plain, source] : plain.map((item, position) => (position === index ? source : item));
}

export function withoutSource(current: readonly PiImageGenerationSourceView[], id: string): PiImageGenerationSource[] {
  return plainSources(current).filter((item) => item.id !== id);
}
