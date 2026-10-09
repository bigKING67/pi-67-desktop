import type { RequestParameters } from "./provider-prepare.js";

// The engine never calls a model API. Hosts inject a generator that routes the
// request through Pi (`modelRegistry.generateImages`), which owns credentials
// and the Provider implementation (ADR 0010 decision 9).
export interface ImageGenerationCall {
  endpoint: "images/generations" | "images/edits";
  parameters: RequestParameters;
  prompt: string;
  references: { id: string; bytes: Buffer }[];
  /** Provider polarity: alpha 0 marks editable pixels. */
  mask?: Buffer | undefined;
}
export interface ImageGenerationOutcome {
  images: Buffer[];
  usage?: unknown;
  requestId?: string | undefined;
  httpStatus?: number | undefined;
}
export type ImageGenerator = (call: ImageGenerationCall, signal: AbortSignal) => Promise<ImageGenerationOutcome>;

export type ImageGenerationFailure = "http_error" | "response_size_limit" | "invalid_image_response" | "transport_or_response_error" | "provider_unavailable";

/**
 * A failure the generator can name. `sent: false` means no request left this
 * client (for example Pi reports the Provider is not configured), so the job
 * claim is released instead of recording a paid attempt.
 */
export class ImageGenerationError extends Error {
  constructor(readonly code: ImageGenerationFailure, readonly httpStatus?: number, readonly sent = true) { super(code); }
}

const USAGE_KEYS = new Set(["input_tokens", "output_tokens", "total_tokens", "input_tokens_details", "output_tokens_details", "text_tokens", "image_tokens", "cached_tokens"]);

// Only known numeric usage fields survive; anything else (including echoed secrets) is dropped.
export function numericUsage(value: unknown, depth = 0): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 2) return null;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!USAGE_KEYS.has(key)) continue;
    if (Number.isSafeInteger(item) && (item as number) >= 0) result[key] = item;
    else if (item && typeof item === "object") { const nested = numericUsage(item, depth + 1); if (nested) result[key] = nested; }
  }
  return Object.keys(result).length ? result : null;
}
