import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { endpointUrl, isRecord, rejectedParameter, responseImages, responseJSON } from "./image-workbench-http.js";

// The `openai-images` image API for Pi (ADR 0010 decision 9): Pi resolves the
// Provider's key and calls this through `modelRegistry.generateImages`, so no
// model request leaves Pi's routing. The engine's request travels in
// `options.metadata.newmoney_image`; the prompt and reference images travel in
// the Pi images context.
type ProviderConfig = Parameters<ExtensionAPI["registerProvider"]>[1];
type ProviderImages = NonNullable<NonNullable<Extract<ProviderConfig, { images?: unknown }>["images"]>[string]>;
export type GenerateImages = ProviderImages["generateImages"];
type ImageModel = Parameters<GenerateImages>[0];
type ImagesContext = Parameters<GenerateImages>[1];
type ImagesOptions = NonNullable<Parameters<GenerateImages>[2]>;
type AssistantImages = Awaited<ReturnType<GenerateImages>>;

export const METADATA_KEY = "newmoney_image";
export interface NewMoneyImageRequest {
  endpoint: "images/generations" | "images/edits";
  size: string; quality: string; background: string; output_format: "png"; n: 1;
  /** Base64 PNG, Provider polarity (alpha 0 = editable). */
  mask?: string;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/u;

export function readImageRequest(metadata: unknown): NewMoneyImageRequest {
  const value = isRecord(metadata) ? metadata[METADATA_KEY] : undefined;
  if (!isRecord(value)) throw new Error("invalid_request");
  const { endpoint, size, quality, background, output_format, n, mask } = value;
  if ((endpoint !== "images/generations" && endpoint !== "images/edits") || typeof size !== "string" || typeof quality !== "string" ||
      typeof background !== "string" || output_format !== "png" || n !== 1 || (mask !== undefined && (typeof mask !== "string" || !BASE64.test(mask)))) throw new Error("invalid_request");
  return { endpoint, size, quality, background, output_format, n, ...(typeof mask === "string" ? { mask } : {}) };
}

function usageOf(value: unknown): AssistantImages["usage"] {
  if (!isRecord(value)) return undefined;
  const count = (key: string): number => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0 ? value[key] as number : 0;
  const input = count("input_tokens"), output = count("output_tokens");
  return { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: count("total_tokens") || input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } as AssistantImages["usage"];
}

export const HTTP_ERROR = /^http_error:(\d{3})(?::([A-Za-z][A-Za-z0-9_.[\]]{0,47}))?$/u;
const KNOWN_FAILURES = new Set(["invalid_request", "invalid_endpoint", "missing_api_key", "response_size_limit", "invalid_image_response"]);

/**
 * Failures are returned, never thrown, as Pi's image contract requires. The
 * message is a fixed code (or `http_error:<status>`), never a response body,
 * so a gateway echoing the key cannot leak it into a receipt.
 */
export const generateOpenAIImages: GenerateImages = async (model: ImageModel, context: ImagesContext, options?: ImagesOptions): Promise<AssistantImages> => {
  const result: AssistantImages = { api: model.api, provider: model.provider, model: model.id, output: [], stopReason: "stop", timestamp: Date.now() };
  try {
    const request = readImageRequest(options?.metadata);
    const apiKey = options?.apiKey;
    if (typeof apiKey !== "string" || !apiKey.trim() || /[\r\n]/.test(apiKey)) throw new Error("missing_api_key");
    const url = endpointUrl(model.baseUrl, request.endpoint);
    const prompt = context.input.filter((item) => item.type === "text").map((item) => item.text).join("\n\n");
    const images = context.input.filter((item) => item.type === "image");
    const fields = { model: model.id, size: request.size, quality: request.quality, background: request.background, output_format: request.output_format, n: request.n, prompt };
    let body: string | FormData;
    if (request.endpoint === "images/generations") {
      if (images.length || request.mask) throw new Error("invalid_request");
      body = JSON.stringify(fields);
    } else {
      if (!images.length) throw new Error("invalid_request");
      body = new FormData();
      for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
      for (const [index, image] of images.entries()) body.append("image[]", new Blob([Buffer.from(image.data, "base64")], { type: image.mimeType }), `reference-${index}.png`);
      if (request.mask) body.set("mask", new Blob([Buffer.from(request.mask, "base64")], { type: "image/png" }), "mask.png");
    }
    const headers: Record<string, string> = { ...model.headers, ...(options?.headers as Record<string, string> | undefined), Authorization: `Bearer ${apiKey}` };
    if (typeof body === "string") headers["Content-Type"] = "application/json";
    const response = await (options?.fetch ?? fetch)(url, { method: "POST", headers, body, redirect: "error", ...(options?.signal ? { signal: options.signal } : {}) });
    await options?.onResponse?.({ status: response.status, headers: Object.fromEntries(response.headers.entries()) }, model);
    if (!response.ok) {
      const parameter = response.status === 400 ? await rejectedParameter(response) : (await response.body?.cancel(), undefined);
      throw new Error(`http_error:${response.status}${parameter ? `:${parameter}` : ""}`);
    }
    const data = await responseJSON(response);
    const requestId = response.headers.get("x-request-id");
    if (requestId) result.responseId = requestId;
    const usage = usageOf(isRecord(data) ? data.usage : undefined);
    if (usage) result.usage = usage;
    result.output = await responseImages(isRecord(data) ? data.data : undefined, options?.fetch ?? fetch, options?.signal);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    result.output = [];
    result.stopReason = options?.signal?.aborted ? "aborted" : "error";
    result.errorMessage = KNOWN_FAILURES.has(message) || HTTP_ERROR.test(message) ? message : "transport_or_response_error";
    return result;
  }
};
