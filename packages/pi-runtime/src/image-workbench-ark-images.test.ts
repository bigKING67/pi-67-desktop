import http from "node:http";
import { describe, expect, it, onTestFinished } from "vitest";
import { arkImageBody, generateArkImages } from "./image-workbench-ark-images.js";
import { METADATA_KEY, type GenerateImages } from "./image-workbench-openai-images.js";

type Model = Parameters<GenerateImages>[0];
const key = "test-only-ark-credential";
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
const request = (endpoint: string, mask?: string) => ({ [METADATA_KEY]: { endpoint, size: "2048x2048", quality: "low", background: "opaque", output_format: "png", n: 1, ...(mask ? { mask } : {}) } });

async function ark(respond: (body: Record<string, unknown>, res: http.ServerResponse) => void): Promise<{ model: Model; bodies: Record<string, unknown>[]; paths: string[] }> {
  const bodies: Record<string, unknown>[] = [], paths: string[] = [];
  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk as Buffer);
      paths.push(req.url ?? ""); const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; bodies.push(body);
      respond(body, res);
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => { server.closeAllConnections(); return new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address(), port = typeof address === "object" && address ? address.port : 0;
  return { bodies, paths, model: { id: "doubao-seedream-5-0-pro-260628", name: "Seedream", api: "ark-images", provider: "newmoney-images-ark", baseUrl: `http://127.0.0.1:${port}/api/v3`,
    type: "image", input: ["text", "image"], output: ["image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as Model };
}

describe("ark-images Pi image API (Seedream)", () => {
  it("always disables the watermark and asks for base64 PNG at the explicit size", () => {
    expect(arkImageBody("m", "2048x2048", "a bottle", [])).toEqual({ model: "m", prompt: "a bottle", size: "2048x2048", response_format: "b64_json", output_format: "png", watermark: false });
    expect(arkImageBody("m", "2048x2048", "p", [{ mimeType: "image/PNG", data: "AAAA" }]).image).toEqual(["data:image/png;base64,AAAA"]);
  });

  it("generates through /images/generations with the Pi-resolved key", async () => {
    const { model, bodies, paths } = await ark((_body, res) => res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64"), size: "2048x2048" }], usage: { generated_images: 1, output_tokens: 16384, total_tokens: 16384 } })));
    const result = await generateArkImages(model, { input: [{ type: "text", text: "a bottle" }] }, { apiKey: key, metadata: request("images/generations") });
    expect(result).toMatchObject({ stopReason: "stop", output: [{ type: "image", mimeType: "image/png" }] });
    expect(result.usage).toMatchObject({ output: 16384, totalTokens: 16384 });
    expect(paths).toEqual(["/api/v3/images/generations"]);
    expect(bodies[0]).toMatchObject({ model: "doubao-seedream-5-0-pro-260628", watermark: false, size: "2048x2048" });
    expect(bodies[0]).not.toHaveProperty("quality"); expect(bodies[0]).not.toHaveProperty("image");
  });

  it("turns an edit into a reference-guided generation and drops the mask", async () => {
    const { model, bodies, paths } = await ark((_body, res) => res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] })));
    const reference = { type: "image" as const, mimeType: "image/png", data: png.toString("base64") };
    const result = await generateArkImages(model, { input: [{ type: "text", text: "remove the leaf" }, reference] }, { apiKey: key, metadata: request("images/edits", png.toString("base64")) });
    expect(result.stopReason).toBe("stop");
    expect(paths).toEqual(["/api/v3/images/generations"]);
    expect(bodies[0]?.image).toEqual([`data:image/png;base64,${png.toString("base64")}`]);
    expect(JSON.stringify(bodies[0])).not.toContain("mask");
  });

  it("names a refused parameter, never the message, and treats a failed image row as an invalid response", async () => {
    const refused = await ark((_body, res) => { res.statusCode = 400; res.end(JSON.stringify({ error: { code: "InvalidParameter", message: `${key} bad size`, param: "size" } })); });
    const failed = await generateArkImages(refused.model, { input: [{ type: "text", text: "x" }] }, { apiKey: key, metadata: request("images/generations") });
    expect(failed).toMatchObject({ stopReason: "error", errorMessage: "http_error:400:size" }); expect(JSON.stringify(failed)).not.toContain(key);
    const partial = await ark((_body, res) => res.end(JSON.stringify({ data: [{ error: { code: "OutputImageSensitiveContentDetected", message: "x" } }] })));
    expect(await generateArkImages(partial.model, { input: [{ type: "text", text: "x" }] }, { apiKey: key, metadata: request("images/generations") })).toMatchObject({ errorMessage: "invalid_image_response" });
    const invalid = await ark((_body, res) => res.end("{}"));
    expect(await generateArkImages(invalid.model, { input: [{ type: "text", text: "x" }] }, { apiKey: key, metadata: request("images/edits") })).toMatchObject({ errorMessage: "invalid_request" });
    expect(invalid.bodies).toHaveLength(0);
  });
});
