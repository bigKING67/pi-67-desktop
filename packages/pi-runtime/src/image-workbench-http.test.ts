import http from "node:http";
import { describe, expect, it, onTestFinished } from "vitest";
import { downloadImage, endpointUrl, imageMimeType, rejectedParameter, responseImages } from "./image-workbench-http.js";

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);

async function server(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ base: string; seen: http.IncomingHttpHeaders[] }> {
  const seen: http.IncomingHttpHeaders[] = [];
  const instance = http.createServer((req, res) => { seen.push(req.headers); handler(req, res); });
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => { instance.closeAllConnections(); return new Promise<void>((resolve) => instance.close(() => resolve())); });
  const address = instance.address();
  return { base: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`, seen };
}

describe("image API transport", () => {
  it("allows HTTPS and loopback endpoints only", () => {
    expect(endpointUrl("https://www.micuapi.ai/v1/", "images/generations")).toBe("https://www.micuapi.ai/v1/images/generations");
    expect(endpointUrl("http://127.0.0.1:8317/v1", "images/edits")).toBe("http://127.0.0.1:8317/v1/images/edits");
    for (const bad of ["http://example.com/v1", "https://user:pw@example.com/v1", "https://example.com/v1?key=x", "ftp://example.com", "nope"]) {
      expect(() => endpointUrl(bad, "images/generations"), bad).toThrow("invalid_endpoint");
    }
  });

  it("recognises PNG, JPEG and WebP by signature only", () => {
    expect([png, jpeg, webp, Buffer.from("<html>")].map(imageMimeType)).toEqual(["image/png", "image/jpeg", "image/webp", undefined]);
  });

  it("downloads URL results through validated redirects without sending credentials", async () => {
    const { base, seen } = await server((req, res) => {
      if (req.url === "/signed") { res.writeHead(302, { location: "/final.jpg" }); res.end(); return; }
      res.setHeader("content-type", "image/jpeg"); res.end(jpeg);
    });
    expect(await downloadImage(`${base}/signed`, fetch, undefined)).toEqual({ mimeType: "image/jpeg", data: jpeg.toString("base64") });
    expect(seen.every((headers) => headers.authorization === undefined)).toBe(true);
  });

  it("rejects non-images, insecure hops, failures and endless redirects", async () => {
    const { base } = await server((req, res) => {
      if (req.url === "/html") { res.end("<html>"); return; }
      if (req.url === "/insecure") { res.writeHead(302, { location: "http://example.com/a.png" }); res.end(); return; }
      if (req.url === "/loop") { res.writeHead(302, { location: "/loop" }); res.end(); return; }
      res.writeHead(404); res.end();
    });
    for (const path of ["/html", "/insecure", "/loop", "/missing"]) {
      await expect(downloadImage(`${base}${path}`, fetch, undefined), path).rejects.toThrow("invalid_image_response");
    }
    await expect(downloadImage("http://example.com/a.png", fetch, undefined)).rejects.toThrow("invalid_image_response");
  });

  it("reads inline and URL rows and refuses malformed ones", async () => {
    const { base } = await server((_req, res) => { res.end(webp); });
    expect(await responseImages([{ b64_json: png.toString("base64") }, { url: `${base}/x.webp` }], fetch, undefined)).toEqual([
      { type: "image", mimeType: "image/png", data: png.toString("base64") }, { type: "image", mimeType: "image/webp", data: webp.toString("base64") }
    ]);
    for (const rows of [[], undefined, [{}], [{ b64_json: "not base64!" }]]) {
      await expect(responseImages(rows, fetch, undefined)).rejects.toThrow("invalid_image_response");
    }
  });

  it("names a rejected parameter as a bounded token and never keeps the message", async () => {
    const respond = (body: string) => new Response(body, { status: 400 });
    expect(await rejectedParameter(respond(JSON.stringify({ error: { message: "quality must be low (key sk-secret)", param: "quality" } })))).toBe("quality");
    for (const body of [JSON.stringify({ error: { param: "sk-secret value with spaces" } }), JSON.stringify({ error: "x" }), "not json"]) {
      expect(await rejectedParameter(respond(body)), body).toBeUndefined();
    }
  });
});
