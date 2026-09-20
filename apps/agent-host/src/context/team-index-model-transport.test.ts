import { afterEach, expect, it, vi } from "vitest";
import { NATIVE_TEAM_MODEL_MAX_BODY } from "@pi67/protocol";
import { createTeamIndexModelTransport } from "./team-index-model-transport.js";

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const embedding = { protocol: "openai-compatible" as const, endpoint: "https://embedding.invalid/custom/v1/", model: "embed", apiKey: "synthetic-embedding" };
  const extraction = { ...embedding, endpoint: "https://extraction.invalid/v1", model: "extract", apiKey: "synthetic-extraction" };
  const owner = new AbortController(), caller = new AbortController();
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [] })); vi.stubGlobal("fetch", fetcher);
  const invoke = createTeamIndexModelTransport({ embedding, extraction }, owner.signal);
  const request = (purpose: "embedding" | "extraction" = "embedding") => {
    const selected = purpose === "embedding" ? embedding : extraction;
    return invoke(purpose, { baseUrl: selected.endpoint, id: selected.model }, Buffer.from(JSON.stringify({ model: selected.model })), caller.signal);
  };
  return { embedding, extraction, owner, caller, fetcher, invoke, request };
}

it.each(["embedding", "extraction"] as const)("posts %s only to its captured route/key without cookies or retries", async purpose => {
  const f = fixture();
  const result = await f.request(purpose);
  const selected = purpose === "embedding" ? f.embedding : f.extraction;
  expect(result).toEqual({ status: 200, body: new TextEncoder().encode('{"data":[]}') });
  expect(f.fetcher).toHaveBeenCalledOnce();
  expect(f.fetcher.mock.calls[0]).toEqual([
    purpose === "embedding" ? "https://embedding.invalid/custom/v1/embeddings" : "https://extraction.invalid/v1/chat/completions",
    { method: "POST", redirect: "error", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: expect.any(AbortSignal),
      headers: { Authorization: `Bearer ${selected.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: new TextEncoder().encode(JSON.stringify({ model: selected.model })) }
  ]);
});

it("snapshots credentials and rejects drifted route selection before fetch", async () => {
  const f = fixture(), original = { baseUrl: f.embedding.endpoint, id: f.embedding.model };
  f.embedding.apiKey = "mutated"; f.embedding.endpoint = "https://other.invalid"; f.embedding.model = "other";
  await expect(f.request()).rejects.toThrow("Team model request unavailable.");
  expect(f.fetcher).not.toHaveBeenCalled();
  await f.invoke("embedding", original, Buffer.from("{}"), f.caller.signal);
  expect(f.fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer synthetic-embedding" });
});

it.each([
  { endpoint: "http://127.0.0.1:8000/v1" }, { endpoint: "https://user:pass@host.invalid" },
  { endpoint: "https://host.invalid?token=secret" }, { endpoint: "https://host.invalid#fragment" },
  { endpoint: "https://host.invalid\\v1" }, { endpoint: " https://host.invalid" },
  { endpoint: "https://host.invalid/" + "a".repeat(2048) }, { endpoint: "not-url" },
  { model: "a".repeat(129) }, { model: "two models" }, { model: "" },
  { apiKey: "x\r\nInjected: key" }, { apiKey: "" }, { apiKey: "x".repeat(4097) }
])("rejects invalid team credentials/routes without exposing values %#", change => {
  const f = fixture();
  expect(() => createTeamIndexModelTransport({ embedding: { ...f.embedding, ...change }, extraction: f.extraction }, f.owner.signal))
    .toThrow("Team model request unavailable.");
  expect(f.fetcher).not.toHaveBeenCalled();
});

it("rejects oversized request bodies before network use", async () => {
  const f = fixture();
  await expect(f.invoke("embedding", { baseUrl: f.embedding.endpoint, id: f.embedding.model }, new Uint8Array(NATIVE_TEAM_MODEL_MAX_BODY + 1), f.caller.signal)).rejects.toThrow("unavailable");
  expect(f.fetcher).not.toHaveBeenCalled();
});

it.each([302, 429, 503])("never reads provider error/redirect bodies or retries status %s", async status => {
  const f = fixture(), cancel = vi.fn();
  f.fetcher.mockResolvedValue(new Response(new ReadableStream({ cancel }), { status, headers: { Location: "https://other.invalid" } }));
  if (status === 302) await expect(f.request()).rejects.toThrow("unavailable");
  else expect(await f.request()).toEqual({ status, body: new TextEncoder().encode('{"error":{"message":"Team model request failed"}}') });
  expect(cancel).toHaveBeenCalledOnce(); expect(f.fetcher).toHaveBeenCalledOnce();
});

it.each(["text/html", "text/event-stream", ""])("rejects non-JSON response type %s", async type => {
  const f = fixture(), response = new Response("synthetic-secret", { headers: { "Content-Type": type } });
  const cancel = vi.spyOn(response.body!, "cancel"); f.fetcher.mockResolvedValue(response);
  await expect(f.request()).rejects.toThrow("Team model request unavailable."); expect(cancel).toHaveBeenCalledOnce();
});

it("bounds streamed decoded bytes independently of a false Content-Length", async () => {
  const f = fixture(), cancel = vi.fn();
  let chunks = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(chunks++ === 0 ? NATIVE_TEAM_MODEL_MAX_BODY : 1)); }, cancel });
  f.fetcher.mockResolvedValue(new Response(body, { headers: { "Content-Type": "application/json", "Content-Length": "1" } }));
  await expect(f.request()).rejects.toThrow("unavailable"); expect(cancel).toHaveBeenCalledOnce();
});

it("owns reused stream chunks and accepts the exact response byte limit", async () => {
  const f = fixture();
  const bytes = new Uint8Array(NATIVE_TEAM_MODEL_MAX_BODY / 2); let n = 0;
  f.fetcher.mockResolvedValue(new Response(new ReadableStream({ pull(c) {
    if (n === 2) { c.close(); return; } bytes.fill(++n); c.enqueue(bytes);
  } }, { highWaterMark: 0 }), { headers: { "Content-Type": "application/json; charset=utf-8" } }));
  const result = await f.request();
  expect(result.body.length).toBe(NATIVE_TEAM_MODEL_MAX_BODY);
  expect(result.body[0]).toBe(1); expect(result.body[NATIVE_TEAM_MODEL_MAX_BODY / 2]).toBe(2);
});

it.each(["owner", "caller"] as const)("cancels a stalled response reader on %s retirement", async kind => {
  const f = fixture(), cancel = vi.fn();
  f.fetcher.mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "application/json" } }));
  const run = f.request(), rejected = expect(run).rejects.toThrow("Team model request unavailable.");
  await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce()); f[kind].abort(new Error("synthetic-secret"));
  await rejected; expect(cancel).toHaveBeenCalledOnce(); expect(f.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  await expect(f.request()).rejects.toThrow("unavailable"); expect(f.fetcher).toHaveBeenCalledOnce();
});

it("sanitizes network and stream exceptions without retry", async () => {
  const f = fixture(); f.fetcher.mockRejectedValueOnce(new Error("synthetic-private-key"));
  await expect(f.request()).rejects.toThrow("Team model request unavailable.");
  f.fetcher.mockResolvedValue(new Response(new ReadableStream({ start(c) { c.error(new Error("synthetic-private-body")); } }), { headers: { "Content-Type": "application/json" } }));
  await expect(f.request()).rejects.toThrow("Team model request unavailable."); expect(f.fetcher).toHaveBeenCalledTimes(2);
});

it("rejects followed redirects and discards a late response after cancellation", async () => {
  const f = fixture(), response = Response.json({ secret: "synthetic" });
  Object.defineProperty(response, "redirected", { value: true }); f.fetcher.mockResolvedValueOnce(response);
  await expect(f.request()).rejects.toThrow("unavailable");
  let release!: (value: Response) => void;
  f.fetcher.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const run = f.request(), rejected = expect(run).rejects.toThrow("unavailable");
  f.owner.abort(); const late = Response.json({}); const cancel = vi.spyOn(late.body!, "cancel"); release(late);
  await rejected; expect(cancel).toHaveBeenCalledOnce();
});
it("rejects a mismatched response URL and a success without a response stream", async () => {
  const f = fixture(), response = Response.json({});
  Object.defineProperty(response, "url", { value: "https://other.invalid" }); f.fetcher.mockResolvedValueOnce(response);
  await expect(f.request()).rejects.toThrow("unavailable");
  f.fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(f.request()).rejects.toThrow("unavailable"); expect(f.fetcher).toHaveBeenCalledTimes(2);
});
