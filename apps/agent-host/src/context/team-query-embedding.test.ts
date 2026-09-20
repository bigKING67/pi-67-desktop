import { afterEach, expect, it, vi } from "vitest";
import { EnterpriseContextGatewayClient } from "./enterprise-context-gateway-client.js";
import { createTeamQueryEmbedding } from "./team-query-embedding.js";
import { createTeamEmbeddingTransport } from "./team-index-model-transport.js";

const embedding = { protocol: "openai-compatible" as const, endpoint: "https://embed.invalid/v1", model: "embed", dimension: 4, apiKey: "synthetic-embedding" };
const scope = { userId: "user", teamId: "team", projectId: null as string | null };
const result = () => ({ model: "embed", data: [{ index: 0, embedding: [0.1, -0.2, 0.3, 0.4] }] });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function fixture() {
  const grant = { userId: "user", teamId: "team", role: "member", permissionRevision: "a".repeat(64),
    issuedAt: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    modelPolicy: { teamId: "team", revision: "1", allowedModels: [{ purpose: "embedding", endpoint: embedding.endpoint, modelId: embedding.model }] } };
  const fetcher = vi.fn<typeof fetch>(async (url) => (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).endsWith("/authorization") ? Response.json(grant) : Response.json(result()));
  vi.stubGlobal("fetch", fetcher);
  const lifetime = new AbortController(), caller = new AbortController(), source = createTeamQueryEmbedding(embedding, lifetime.signal);
  const gateway = new EnterpriseContextGatewayClient("https://service.invalid", "synthetic-service");
  const run = (query = "团队 SOP 如何执行？", selectedScope = scope) => source.embed(query, gateway, selectedScope, caller.signal);
  return { grant, fetcher, lifetime, caller, source, gateway, run };
}
it("authorizes each exact query and returns one immutable vector without sending text to the service", async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) {
    const vector = await f.run(); expect(vector).toEqual(result().data[0]!.embedding); expect(Object.isFrozen(vector)).toBe(true);
  }
  expect(f.fetcher).toHaveBeenCalledTimes(4);
  expect(f.source.model).toEqual({ endpoint: embedding.endpoint, model: "embed", dimension: 4 });
  expect(Object.isFrozen(f.source.model)).toBe(true);
  for (const [url, init] of f.fetcher.mock.calls) {
    if ((typeof url === "string" ? url : url instanceof URL ? url.href : url.url).endsWith("/authorization")) { expect(init?.method).toBe("GET"); expect(init?.body).toBeUndefined(); }
    else {
      expect(url).toBe("https://embed.invalid/v1/embeddings");
      expect(JSON.parse(Buffer.from(init?.body as Uint8Array).toString())).toEqual({ model: "embed", input: ["团队 SOP 如何执行？"], encoding_format: "float" });
      expect(init?.headers).toMatchObject({ Authorization: "Bearer synthetic-embedding" });
    }
  }
});
it.each(["", "  ", "x".repeat(8193), "字".repeat(2731), "\ud800"])("rejects empty/oversize/lossy text before any request %#", async query => {
  const f = fixture(); await expect(f.run(query)).rejects.toThrow("Team query embedding unavailable.");
  expect(f.fetcher).not.toHaveBeenCalled();
});
it("allows the exact UTF-8 input byte limit without truncation", async () => {
  const f = fixture(); await f.run("x".repeat(8192));
  const sent = JSON.parse(Buffer.from(f.fetcher.mock.calls[1]![1]!.body as Uint8Array).toString()) as { input: string[] };
  expect(sent.input[0]).toHaveLength(8192);
});
it.each([0, 3, 5, 4097, NaN])("refuses unsupported dimensions %s", dimension => {
  expect(() => createTeamQueryEmbedding({ ...embedding, dimension }, new AbortController().signal)).toThrow("unavailable");
});
it.each(["deny", "policy", "project"])("never sends query text when %s authorization fails", async mode => {
  const f = fixture();
  if (mode === "policy") f.grant.modelPolicy.allowedModels[0]!.purpose = "extraction";
  else f.fetcher.mockResolvedValueOnce(Response.json({}, { status: 403 }));
  await expect(f.run("synthetic-private-query", mode === "project" ? { ...scope, projectId: "project" } : scope)).rejects.toThrow("unavailable");
  expect(f.fetcher).toHaveBeenCalledOnce();
  if (mode === "project") expect(f.fetcher.mock.calls[0]![0]).toBe("https://service.invalid/v1/agent/teams/team/projects/project/authorization");
});
it("uses exact project authorization without requiring extraction permission", async () => {
  const f = fixture(); f.fetcher.mockResolvedValueOnce(Response.json({ ...f.grant, projectId: "project" }));
  await expect(f.run("query", { ...scope, projectId: "project" })).resolves.toEqual(result().data[0]!.embedding);
});
it.each([
  { model: "other", data: result().data }, { data: result().data }, { model: "embed", data: [] },
  { model: "embed", data: [...result().data, ...result().data] },
  { model: "embed", data: [{ index: 1, embedding: [1, 2, 3, 4] }] },
  { model: "embed", data: [{ index: 0, embedding: [1, 2, 3] }] },
  { model: "embed", data: [{ index: 0, embedding: [1, 2, 3, "4"] }] },
  { model: "embed", data: [{ index: 0, embedding: [1, 2, 3, 1e39] }] }
])("rejects mismatched model, shape, dimension or unsafe vector %#", async value => {
  const f = fixture(); f.fetcher.mockResolvedValueOnce(Response.json(f.grant)).mockResolvedValueOnce(Response.json(value));
  await expect(f.run()).rejects.toThrow("Team query embedding unavailable."); expect(f.fetcher).toHaveBeenCalledTimes(2);
});
it.each([Buffer.from("not-json"), Buffer.from([0xff]), Buffer.from('{"model":"embed","data":[{"index":0,"embedding":[1e400,2,3,4]}]}')])("sanitizes invalid JSON/UTF-8/nonfinite results %#", async bytes => {
  const f = fixture(); f.fetcher.mockResolvedValueOnce(Response.json(f.grant)).mockResolvedValueOnce(new Response(bytes, { headers: { "Content-Type": "application/json" } }));
  await expect(f.run()).rejects.toThrow("Team query embedding unavailable.");
});
it.each(["caller", "lifetime"] as const)("rejects late model results and drains non-cooperative fetch after %s cancellation", async kind => {
  const f = fixture(); let release!: (response: Response) => void;
  f.fetcher.mockResolvedValueOnce(Response.json(f.grant)).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  let settled = false; const run = f.run().finally(() => { settled = true; }); const rejected = expect(run).rejects.toThrow("unavailable");
  await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2)); f[kind].abort(new Error("synthetic-secret"));
  await new Promise(resolve => setTimeout(resolve, 10)); expect(settled).toBe(false);
  expect(f.fetcher.mock.calls[1]![1]!.signal!.aborted).toBe(true);
  release(Response.json(result())); await rejected;
});
it("does not retry a provider failure or expose its body", async () => {
  const f = fixture(); f.fetcher.mockResolvedValueOnce(Response.json(f.grant)).mockResolvedValueOnce(new Response("synthetic-secret", { status: 429 }));
  await expect(f.run()).rejects.toThrow("Team query embedding unavailable."); expect(f.fetcher).toHaveBeenCalledTimes(2);
});
it("query transport cannot invoke extraction, even with a matching embedding endpoint", async () => {
  const f = fixture(); const invoke = createTeamEmbeddingTransport(embedding, f.lifetime.signal);
  await expect(invoke("extraction", { baseUrl: embedding.endpoint, id: embedding.model }, Buffer.from("{}"), f.caller.signal)).rejects.toThrow("unavailable");
  expect(f.fetcher).not.toHaveBeenCalled();
});
