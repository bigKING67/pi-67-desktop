import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ImageContent, ImagesInputContent } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Check } from "typebox/value";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES = 4;
const MAX_TEXT_CHARS = 12_000;
const MODEL_ID = Type.String({ minLength: 1, maxLength: 512, pattern: "\\S" });
const IMAGE_MODELS_INPUT = Type.Object({ provider: Type.Optional(MODEL_ID) }, { additionalProperties: false });
const GENERATE_IMAGE_INPUT = Type.Object({
  provider: MODEL_ID,
  model: MODEL_ID,
  prompt: Type.String({ minLength: 1, maxLength: 16_000, pattern: "\\S" }),
  referencePaths: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 4_096, pattern: "\\S" }), {
    minItems: 1, maxItems: MAX_IMAGES
  }))
}, { additionalProperties: false });

export function hasNativeImageToolInput(toolName: string, input: unknown): boolean {
  if (toolName === "image_models") return Check(IMAGE_MODELS_INPUT, input);
  return toolName === "generate_image" && Check(GENERATE_IMAGE_INPUT, input);
}

/** Pi owns image-model discovery, credentials, provider execution and usage. */
export function createNativeImageTools(): ToolDefinition[] {
  const discover = defineTool({
    name: "image_models",
    label: "可用生图模型",
    description: "List authenticated image-generation models from the current Pi SDK registry. Omit provider to list every source; pass provider only with an id this tool already returned, never a guessed one. Returns model identities and modalities only, never credentials or endpoints.",
    promptSnippet: "Discover configured SDK-native image models (call with no provider) before generating an image.",
    parameters: IMAGE_MODELS_INPUT,
    executionMode: "parallel",
    async execute(_id, input, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const options = signal ? { signal } : {};
      let models = await ctx.modelRegistry.getAvailableOfType("image", input.provider, options);
      // A guessed or stale Provider id must not read as "nothing configured" when other sources exist.
      let note: string | undefined;
      if (models.length === 0 && input.provider !== undefined) {
        models = await ctx.modelRegistry.getAvailableOfType("image", undefined, options);
        if (models.length) note = `No image model for provider "${input.provider}"; these are the configured ones.`;
      }
      signal?.throwIfAborted();
      const entries = models.slice(0, 64).map((model) => ({
        provider: model.provider, model: model.id, name: model.name, input: model.input, output: model.output
      }));
      return {
        content: [{ type: "text" as const, text: entries.length
          ? JSON.stringify({ ...(note ? { note } : {}), models: entries, truncated: models.length > entries.length })
          : "NATIVE_IMAGE_MODEL_UNAVAILABLE: No authenticated SDK image model is configured. Configure a Pi-supported image provider; chat/vision models and legacy image-gen configuration are not image-generation credentials." }],
        details: { models: entries, truncated: models.length > entries.length }
      };
    }
  });
  const generate = defineTool({
    name: "generate_image",
    label: "SDK 原生生图",
    description: "Generate or edit images using one explicitly selected Pi SDK image model. Optional referencePaths are local image files read through the ordinary read tool and its permissions. No provider fallback, automatic file save or chat-model switch. This sends the prompt/references to the selected image provider and may incur a charge.",
    promptSnippet: "Generate an image through Pi's native image API when the user requests an image.",
    promptGuidelines: [
      "Use image_models to find an authenticated image model; never invent a model or reuse a chat-only model.",
      "State the selected provider/model before generating. Use only referencePaths explicitly selected for this image task.",
      "Do not retry a failed generation through another provider or model; report the failure. Images appear in the tool result and are not implicitly saved to the Workspace.",
      "For a layer of an image project, use image_generate instead so the result is staged as a candidate in that project."
    ],
    parameters: GENERATE_IMAGE_INPUT,
    executionMode: "sequential",
    async execute(_id, input, signal, onUpdate, ctx) {
      signal?.throwIfAborted();
      const model = ctx.modelRegistry.getModelOfType("image", input.provider, input.model);
      if (!model) throw new Error("NATIVE_IMAGE_MODEL_UNAVAILABLE: Select an image model returned by image_models.");
      const available = await ctx.modelRegistry.getAvailableOfType("image", input.provider, signal ? { signal } : {});
      signal?.throwIfAborted();
      if (!available.some((candidate) => candidate.id === model.id)) {
        throw new Error("NATIVE_IMAGE_CREDENTIAL_UNAVAILABLE: The selected image provider is not authenticated.");
      }
      if (input.referencePaths?.length && !model.input.includes("image")) {
        throw new Error("NATIVE_IMAGE_REFERENCE_UNSUPPORTED: The selected image model does not accept reference images.");
      }
      const context: ImagesInputContent[] = [{ type: "text", text: input.prompt }];
      for (const path of input.referencePaths ?? []) {
        signal?.throwIfAborted();
        const read = await ctx.executeTool("read", { path }, signal ? { signal } : {});
        if (read.isError) throw new Error("NATIVE_IMAGE_REFERENCE_UNAVAILABLE: Reference-image read failed or was denied; no generation was submitted.");
        const images = read.result.content.filter((block): block is ImageContent => block.type === "image");
        if (images.length !== 1 || !isBoundedImage(images[0]!)) {
          throw new Error("NATIVE_IMAGE_REFERENCE_INVALID: Each reference must be a supported image of at most 10 MiB.");
        }
        context.push(images[0]!);
      }
      signal?.throwIfAborted();
      const details = { provider: model.provider, model: model.id };
      onUpdate?.({ content: [{ type: "text", text: `正在使用 ${model.provider}/${model.id} 生成图片…` }], details });
      const result = await ctx.modelRegistry.generateImages(model, { input: context }, signal ? { signal } : {});
      const usage = result.usage ? { usage: result.usage } : {};
      if (signal?.aborted || result.stopReason !== "stop") {
        return { content: [{ type: "text" as const, text: result.stopReason === "aborted" || signal?.aborted
          ? "NATIVE_IMAGE_GENERATION_ABORTED: Image generation was cancelled; the provider may already have accepted the request."
          : "NATIVE_IMAGE_GENERATION_FAILED: The selected SDK image provider failed. No fallback or retry was performed." }],
          details: { ...details, stopReason: result.stopReason }, isError: true, ...usage };
      }
      const images = result.output.filter((block): block is ImageContent => block.type === "image");
      if (!images.length || images.length > MAX_IMAGES || result.output.length > 32 || !images.every(isBoundedImage)) {
        return { content: [{ type: "text" as const, text: "NATIVE_IMAGE_RESULT_INVALID: Expected one to four supported images, each at most 10 MiB." }],
          details, isError: true, ...usage };
      }
      let textRemaining = MAX_TEXT_CHARS;
      const output = result.output.map((block) => {
        if (block.type === "image") return block;
        const text = block.text.slice(0, textRemaining);
        textRemaining -= text.length;
        return { ...block, text };
      });
      return {
        content: [
          { type: "text" as const, text: `已通过 ${model.provider}/${model.id} 生成 ${images.length} 张图片。` },
          ...output
        ],
        details: { ...details, imageCount: images.length }, ...usage
      };
    }
  });
  return [discover, generate];
}

function isBoundedImage(image: ImageContent): boolean {
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(image.mimeType)
    || !image.data.length || image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return false;
  const bytes = Buffer.from(image.data, "base64");
  return bytes.byteLength <= MAX_IMAGE_BYTES && bytes.toString("base64") === image.data;
}
