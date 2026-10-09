import { createImageApi } from "./image-workbench-openai-images.js";

// The `ark-images` image API for Pi (ADR 0010 decision 14): Volcengine Ark
// Seedream through `POST {baseUrl}/images/generations`. Seedream has no mask
// API, so an edit sends the current raster as the first reference with the
// instruction; the engine's deterministic composite still protects pixels.
// Ark adds a visible "AI生成" watermark unless told not to, so every request
// sends `watermark: false` (decision 5: no AI-content labeling).

/** The Seedream request body; exported for tests. */
export function arkImageBody(model: string, size: string, prompt: string, images: readonly { mimeType: string; data: string }[]): Record<string, unknown> {
  return {
    model, prompt, size, response_format: "b64_json", output_format: "png", watermark: false,
    ...(images.length ? { image: images.map((image) => `data:${image.mimeType.toLowerCase()};base64,${image.data}`) } : {})
  };
}

export const generateArkImages = createImageApi((model, request, prompt, images) => {
  if (request.endpoint === "images/generations" && (images.length || request.mask)) throw new Error("invalid_request");
  if (request.endpoint === "images/edits" && !images.length) throw new Error("invalid_request");
  return { endpoint: "images/generations", body: JSON.stringify(arkImageBody(model.id, request.size, prompt, images)) };
});
