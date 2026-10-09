import { describe, expect, it } from "vitest";
import { ImageGenerationError, type ImageGenerationCall } from "@pi67/image-engine";
import { createPiImageGenerator, type ImageRegistry } from "./image-workbench-generator.js";
import { METADATA_KEY, type GenerateImages } from "./image-workbench-openai-images.js";

type Model = Parameters<GenerateImages>[0];
type Result = Awaited<ReturnType<GenerateImages>>;
const model = { id: "gpt-image-2.5-sunburst", api: "openai-images", provider: "newmoney-images", baseUrl: "https://x/v1" } as Model;
const call: ImageGenerationCall = {
  endpoint: "images/edits", parameters: { model: "gpt-image-2.5-sunburst", size: "1024x1024", quality: "low", background: "transparent", output_format: "png", n: 1 },
  prompt: "remove the leaf", references: [{ id: "background", bytes: Buffer.from("ref") }], mask: Buffer.from("mask")
};
const base = (patch: Partial<Result>): Result => ({ api: "openai-images", provider: "newmoney-images", model: model.id, output: [], stopReason: "stop", timestamp: 1, ...patch });

function registry(result: Result): ImageRegistry & { seen: unknown[] } {
  const seen: unknown[] = [];
  return { seen, generateImages: (...args) => { seen.push(args); return Promise.resolve(result); } };
}

describe("Pi image generator adapter", () => {
  it("sends the prompt, references and request through Pi and returns decoded images", async () => {
    const pi = registry(base({ output: [{ type: "text", text: "note" }, { type: "image", mimeType: "image/png", data: Buffer.from("png").toString("base64") }], responseId: "req-1",
      usage: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 7, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }));
    const signal = new AbortController().signal;
    const outcome = await createPiImageGenerator(pi, model)(call, signal);
    expect(outcome.images.map((image) => image.toString())).toEqual(["png"]);
    expect(outcome).toMatchObject({ requestId: "req-1", usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } });
    const [sentModel, context, options] = pi.seen[0] as [Model, { input: unknown[] }, { signal: AbortSignal; metadata: Record<string, unknown> }];
    expect(sentModel).toBe(model);
    expect(context.input).toEqual([{ type: "text", text: "remove the leaf" }, { type: "image", mimeType: "image/png", data: Buffer.from("ref").toString("base64") }]);
    expect(options.signal).toBe(signal);
    expect(options.metadata[METADATA_KEY]).toEqual({ endpoint: "images/edits", size: "1024x1024", quality: "low", background: "transparent", output_format: "png", n: 1, mask: Buffer.from("mask").toString("base64") });
  });

  it("maps Pi failures to engine failures, marking unsent ones", async () => {
    const cases: [string, Partial<ImageGenerationError>][] = [
      ["http_error:429", { code: "http_error", httpStatus: 429, sent: true }],
      ["http_error:400:quality", { code: "http_error", httpStatus: 400, sent: true, rejectedParameter: "quality" }],
      ["Provider is not configured: newmoney-images", { code: "provider_unavailable", sent: false }],
      ["No API key for provider: newmoney-images", { code: "provider_unavailable", sent: false }],
      ["missing_api_key", { code: "provider_unavailable", sent: false }], ["invalid_endpoint", { code: "provider_unavailable", sent: false }],
      ["response_size_limit", { code: "response_size_limit", sent: true }], ["invalid_image_response", { code: "invalid_image_response", sent: true }],
      ["socket hang up", { code: "transport_or_response_error", sent: true }]
    ];
    for (const [message, expected] of cases) {
      const failure = await createPiImageGenerator(registry(base({ stopReason: "error", errorMessage: message })), model)(call, new AbortController().signal).catch((error: unknown) => error);
      expect(failure, message).toBeInstanceOf(ImageGenerationError);
      expect(failure, message).toMatchObject(expected);
    }
    const missing = await createPiImageGenerator(registry(base({ stopReason: "error" })), model)(call, new AbortController().signal).catch((error: unknown) => error);
    expect(missing).toMatchObject({ code: "transport_or_response_error" });
  });

  it("rethrows the abort reason when Pi reports an aborted request", async () => {
    const controller = new AbortController(); const reason = new Error("stop"); controller.abort(reason);
    await expect(createPiImageGenerator(registry(base({ stopReason: "aborted" })), model)(call, controller.signal)).rejects.toBe(reason);
    await expect(createPiImageGenerator(registry(base({ stopReason: "aborted" })), model)(call, new AbortController().signal)).rejects.toThrow(/aborted/);
  });

  it("omits mask and usage when absent", async () => {
    const pi = registry(base({ output: [] }));
    const outcome = await createPiImageGenerator(pi, model)({ ...call, mask: undefined, references: [] }, new AbortController().signal);
    expect(outcome).toEqual({ images: [], usage: undefined, requestId: undefined });
    const options = (pi.seen[0] as [unknown, unknown, { metadata: Record<string, Record<string, unknown>> }])[2];
    expect(options.metadata[METADATA_KEY]?.mask).toBeUndefined();
  });
});
