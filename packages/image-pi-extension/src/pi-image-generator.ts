import { ImageGenerationError, type ImageGenerationCall, type ImageGenerator } from "@pi67/image-engine";
import { METADATA_KEY, type GenerateImages, type NewMoneyImageRequest } from "./openai-images.js";

type ImageModel = Parameters<GenerateImages>[0];
type AssistantImages = Awaited<ReturnType<GenerateImages>>;
/** The slice of Pi's model registry the generator needs. */
export interface ImageRegistry {
  generateImages(model: ImageModel, context: Parameters<GenerateImages>[1], options?: Parameters<GenerateImages>[2]): Promise<AssistantImages>;
}

// Requests that never reach an implementation: Pi refused before sending.
const UNSENT = [/^Provider is not configured/u, /^No API key/u, /^missing_api_key$/u, /^invalid_endpoint$/u, /^invalid_request$/u];

/** Adapts the engine's generator contract onto Pi's `generateImages`. */
export function createPiImageGenerator(registry: ImageRegistry, model: ImageModel): ImageGenerator {
  return async (call: ImageGenerationCall, signal: AbortSignal) => {
    const request: NewMoneyImageRequest = { endpoint: call.endpoint, size: call.parameters.size, quality: call.parameters.quality,
      background: call.parameters.background, output_format: call.parameters.output_format, n: call.parameters.n,
      ...(call.mask ? { mask: call.mask.toString("base64") } : {}) };
    const result = await registry.generateImages(model, {
      input: [{ type: "text", text: call.prompt }, ...call.references.map((ref) => ({ type: "image" as const, mimeType: "image/png", data: ref.bytes.toString("base64") }))]
    }, { signal, metadata: { [METADATA_KEY]: request } });
    if (result.stopReason === "aborted" || signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Image generation aborted");
    if (result.stopReason === "error") {
      const message = result.errorMessage ?? "";
      const status = /^http_error:(\d{3})$/u.exec(message);
      if (status) throw new ImageGenerationError("http_error", Number(status[1]));
      if (UNSENT.some((pattern) => pattern.test(message))) throw new ImageGenerationError("provider_unavailable", undefined, false);
      if (message === "response_size_limit" || message === "invalid_image_response") throw new ImageGenerationError(message);
      throw new ImageGenerationError("transport_or_response_error");
    }
    const images = result.output.filter((item) => item.type === "image").map((item) => Buffer.from(item.data, "base64"));
    const usage = result.usage ? { input_tokens: result.usage.input, output_tokens: result.usage.output, total_tokens: result.usage.totalTokens } : undefined;
    return { images, usage, requestId: result.responseId };
  };
}
