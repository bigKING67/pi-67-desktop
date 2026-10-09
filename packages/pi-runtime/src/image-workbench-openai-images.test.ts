import http from "node:http";
import { describe, expect, it, onTestFinished } from "vitest";
import { endpointUrl, generateOpenAIImages, readImageRequest, METADATA_KEY, type GenerateImages } from "./image-workbench-openai-images.js";

type Model = Parameters<GenerateImages>[0];
interface Recorded { url: string; headers: http.IncomingHttpHeaders; body: Buffer }
const key = "test-only-private-credential";
const png = Buffer.from("iVBORw0KGgo=", "base64");
const request = { endpoint: "images/generations", size: "1024x1024", quality: "low", background: "opaque", output_format: "png", n: 1 };

async function gateway(handler: (call: Recorded, res: http.ServerResponse) => void): Promise<{ model: Model; calls: Recorded[] }> {
  const calls: Recorded[] = [];
  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk as Buffer);
      const call = { url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) }; calls.push(call);
      handler(call, res);
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => { server.closeAllConnections(); return new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address(), port = typeof address === "object" && address ? address.port : 0;
  return { calls, model: { id: "gpt-image-2.5-sunburst", name: "Sunburst", api: "openai-images", provider: "newmoney-images", baseUrl: `http://127.0.0.1:${port}/v1`,
    type: "image", input: ["text", "image"], output: ["image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, headers: { "x-team": "t1" } } as Model };
}
const ok = (_call: Recorded, res: http.ServerResponse): void => {
  res.setHeader("x-request-id", "req-1");
  res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }], usage: { input_tokens: 7, output_tokens: 9, extra: key } }));
};

describe("openai-images Pi image API", () => {
  it("generation posts JSON with the Pi-resolved key and returns the image, request id and usage", async () => {
    const { model, calls } = await gateway(ok);
    const result = await generateOpenAIImages(model, { input: [{ type: "text", text: "a bottle" }] }, { apiKey: key, metadata: { [METADATA_KEY]: request } });
    expect(result.stopReason).toBe("stop");
    expect(result.output).toEqual([{ type: "image", mimeType: "image/png", data: png.toString("base64") }]);
    expect(result.responseId).toBe("req-1");
    expect(result.usage).toMatchObject({ input: 7, output: 9, totalTokens: 16 });
    expect(calls[0]?.url).toBe("/v1/images/generations");
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${key}`); expect(calls[0]?.headers["x-team"]).toBe("t1");
    expect(JSON.parse(calls[0]?.body.toString() ?? "{}")).toEqual({ model: "gpt-image-2.5-sunburst", size: "1024x1024", quality: "low", background: "opaque", output_format: "png", n: 1, prompt: "a bottle" });
  });

  it("edits post multipart references and the mask", async () => {
    const { model, calls } = await gateway(ok);
    const result = await generateOpenAIImages(model, { input: [{ type: "text", text: "remove the leaf" }, { type: "image", mimeType: "image/png", data: png.toString("base64") }] },
      { apiKey: key, metadata: { [METADATA_KEY]: { ...request, endpoint: "images/edits", mask: png.toString("base64") } } });
    expect(result.stopReason).toBe("stop");
    const call = calls[0];
    expect(call?.url).toBe("/v1/images/edits");
    const form = await new Request("http://localhost/", { method: "POST", headers: { "content-type": String(call?.headers["content-type"]) }, body: new Uint8Array(call?.body ?? Buffer.alloc(0)) }).formData();
    expect(form.get("prompt")).toBe("remove the leaf"); expect(form.get("model")).toBe("gpt-image-2.5-sunburst"); expect(form.get("n")).toBe("1");
    expect(form.getAll("image[]")).toHaveLength(1); expect(form.get("mask")).toBeInstanceOf(Blob);
  });

  it("returns fixed failure codes without sending, and never echoes a response body", async () => {
    const { model, calls } = await gateway((_call, res) => { res.statusCode = 503; res.end(JSON.stringify({ error: `${key} secret body` })); });
    const failed = await generateOpenAIImages(model, { input: [{ type: "text", text: "x" }] }, { apiKey: key, metadata: { [METADATA_KEY]: request } });
    expect(failed).toMatchObject({ stopReason: "error", errorMessage: "http_error:503", output: [] });
    expect(JSON.stringify(failed)).not.toContain(key);
    const unsent: [Parameters<GenerateImages>[2], Model, string][] = [
      [{ metadata: { [METADATA_KEY]: request } }, model, "missing_api_key"],
      [{ apiKey: "a\nb", metadata: { [METADATA_KEY]: request } }, model, "missing_api_key"],
      [{ apiKey: key }, model, "invalid_request"],
      [{ apiKey: key, metadata: { [METADATA_KEY]: { ...request, n: 2 } } }, model, "invalid_request"],
      [{ apiKey: key, metadata: { [METADATA_KEY]: { ...request, mask: "!!" } } }, model, "invalid_request"],
      [{ apiKey: key, metadata: { [METADATA_KEY]: request } }, { ...model, baseUrl: "http://images.example/v1" }, "invalid_endpoint"],
      [{ apiKey: key, metadata: { [METADATA_KEY]: request } }, { ...model, baseUrl: "https://u:p@images.example/v1" }, "invalid_endpoint"]
    ];
    for (const [options, target, code] of unsent) {
      expect(await generateOpenAIImages(target, { input: [{ type: "text", text: "x" }] }, options)).toMatchObject({ stopReason: "error", errorMessage: code });
    }
    expect(await generateOpenAIImages(model, { input: [{ type: "text", text: "x" }, { type: "image", mimeType: "image/png", data: "AAAA" }] }, { apiKey: key, metadata: { [METADATA_KEY]: request } }))
      .toMatchObject({ errorMessage: "invalid_request" });
    expect(await generateOpenAIImages(model, { input: [{ type: "text", text: "x" }] }, { apiKey: key, metadata: { [METADATA_KEY]: { ...request, endpoint: "images/edits" } } }))
      .toMatchObject({ errorMessage: "invalid_request" });
    expect(calls).toHaveLength(1);
  });

  for (const [name, body, code] of [
    ["no images", { data: [] }, "invalid_image_response"], ["url instead of base64", { data: [{ url: "https://x/y.png" }] }, "invalid_image_response"],
    ["malformed base64", { data: [{ b64_json: "!!not" }] }, "invalid_image_response"], ["not json", "<html>", "invalid_image_response"]
  ] as const) {
    it(`rejects ${name}`, async () => {
      const { model } = await gateway((_call, res) => res.end(typeof body === "string" ? body : JSON.stringify(body)));
      expect(await generateOpenAIImages(model, { input: [{ type: "text", text: "x" }] }, { apiKey: key, metadata: { [METADATA_KEY]: request } })).toMatchObject({ stopReason: "error", errorMessage: code, output: [] });
    });
  }

  it("refuses oversized responses by declared length", async () => {
    const { model } = await gateway((_call, res) => { res.setHeader("content-length", String(40_000_000)); res.end("{}"); });
    expect(await generateOpenAIImages(model, { input: [{ type: "text", text: "x" }] }, { apiKey: key, metadata: { [METADATA_KEY]: request } })).toMatchObject({ errorMessage: "response_size_limit" });
  });

  it("reports an aborted request as aborted", async () => {
    const controller = new AbortController();
    const { model } = await gateway(() => controller.abort());
    expect(await generateOpenAIImages(model, { input: [{ type: "text", text: "x" }] }, { apiKey: key, signal: controller.signal, metadata: { [METADATA_KEY]: request } })).toMatchObject({ stopReason: "aborted" });
  });

  it("parses requests and endpoints strictly", () => {
    expect(readImageRequest({ [METADATA_KEY]: request })).toEqual(request);
    expect(() => readImageRequest({})).toThrow(/invalid_request/);
    expect(endpointUrl("https://images.example/v1/", "images/edits")).toBe("https://images.example/v1/images/edits");
    expect(() => endpointUrl("not a url", "images/edits")).toThrow(/invalid_endpoint/);
    expect(() => endpointUrl("ftp://images.example", "images/edits")).toThrow(/invalid_endpoint/);
  });
});
