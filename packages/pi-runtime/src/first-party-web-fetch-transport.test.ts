import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer, type RequestListener, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openPinnedPublicResponse } from "./first-party-web-fetch-transport.js";
import { fetchPublicText } from "./first-party-web-fetch.js";
import { MAX_RESPONSE_BYTES, readBoundedResponseBytes } from "./first-party-web-tool-contract.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }));
});
async function serve(handler: RequestListener): Promise<URL> {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port.");
  return new URL(`http://pinned-fetch.invalid:${address.port}/document`);
}

describe("public fetch socket binding", () => {
  it("preserves a previously configured global dispatcher when the production module is imported", () => {
    const script = `
      const key = Symbol.for('undici.globalDispatcher.1');
      const sentinel = { dispatch() { throw new Error('unexpected global dispatch'); } };
      globalThis[key] = sentinel;
      await import(process.argv[1]);
      if (globalThis[key] !== sentinel) throw new Error('global dispatcher replaced');
    `;
    expect(() => execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script,
      new URL("./first-party-web-fetch-transport.ts", import.meta.url).href], {
      cwd: fileURLToPath(new URL("../", import.meta.url)), timeout: 10000, stdio: "pipe"
    })).not.toThrow();
  });
  it("uses the supplied snapshot for a real socket while preserving the original Host", async () => {
    let host: string | undefined;
    let closed!: () => void;
    const socketClosed = new Promise<void>((resolve) => { closed = resolve; });
    const url = await serve((request, response) => {
      host = request.headers.host;
      request.socket.once("close", closed);
      response.end("bound");
    });
    const opened = await openPinnedPublicResponse(url, ["127.0.0.1"]);
    try { expect(new TextDecoder().decode(await readBoundedResponseBytes(opened.response, "too-large"))).toBe("bound"); }
    finally { await opened.dispose(); }
    await socketClosed;
    expect(host).toBe(url.host);
  });
  it("retains Fetch decompression and enforces the decoded byte limit", async () => {
    const compressed = gzipSync(Buffer.alloc(MAX_RESPONSE_BYTES + 1, 97));
    const url = await serve((_request, response) => {
      response.writeHead(200, { "content-encoding": "gzip", "content-length": compressed.length });
      response.end(compressed);
    });
    const opened = await openPinnedPublicResponse(url, ["127.0.0.1"]);
    try { await expect(readBoundedResponseBytes(opened.response, "decoded-too-large")).rejects.toThrow("decoded-too-large"); }
    finally { await opened.dispose(); }
  });
  it("aborts an active response and destroys its owned connection", async () => {
    const url = await serve((_request, response) => { response.writeHead(200); response.write("pending"); });
    const controller = new AbortController();
    const opened = await openPinnedPublicResponse(url, ["127.0.0.1"], controller.signal);
    const reading = readBoundedResponseBytes(opened.response, "too-large");
    controller.abort();
    await expect(reading).rejects.toThrow();
    await opened.dispose();
  });
  it("does not follow redirects inside its transport", async () => {
    let requests = 0;
    const url = await serve((_request, response) => { requests += 1; response.writeHead(302, { location: "/next" }); response.end(); });
    const opened = await openPinnedPublicResponse(url, ["127.0.0.1"]);
    try { expect(opened.response.status).toBe(302); }
    finally { await opened.dispose(); }
    expect(requests).toBe(1);
  });
  it("returns promptly on DNS cancellation and never opens a late response", async () => {
    let resolve!: (addresses: string[]) => void;
    const pending = new Promise<string[]>((done) => { resolve = done; });
    const openPublicResponse = vi.fn();
    const controller = new AbortController();
    const result = fetchPublicText("https://cancelled.invalid", {
      fetch: vi.fn(), resolveAddresses: () => pending, openPublicResponse
    }, controller.signal);
    controller.abort(new Error("cancel-dns"));
    await expect(result).rejects.toThrow("cancel-dns");
    resolve(["93.184.216.34"]);
    await Promise.resolve();
    expect(openPublicResponse).not.toHaveBeenCalled();
  });
  it("revalidates same-host redirects and disposes the first hop before rejecting a changed address", async () => {
    const dispose = vi.fn(async () => {});
    const openPublicResponse = vi.fn(async (_url: URL, _addresses: readonly string[]) => ({ response: new Response(null, { status: 302, headers: { location: "/next" } }), dispose }));
    const resolveAddresses = vi.fn().mockResolvedValueOnce(["93.184.216.34"]).mockResolvedValueOnce(["127.0.0.1"]);
    await expect(fetchPublicText("https://changing.invalid", { fetch: vi.fn(), resolveAddresses, openPublicResponse }))
      .rejects.toThrow("FETCH_SSRF_REJECTED");
    expect(openPublicResponse).toHaveBeenCalledOnce();
    expect(openPublicResponse.mock.calls[0]?.[1]).toEqual(["93.184.216.34"]);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
