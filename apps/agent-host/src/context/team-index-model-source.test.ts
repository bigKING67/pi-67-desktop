import { afterEach, expect, it, vi } from "vitest";
import { createTeamIndexModelSource } from "./team-index-model-source.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function fixture() {
  const settings = { extraction: { provider: "synthetic", model: "extract" },
    embedding: { protocol: "openai-compatible" as const, endpoint: "https://embedding.invalid/v1", model: "embed", dimension: 4, apiKey: "synthetic-embedding" } };
  const model = { provider: "synthetic", id: "extract", api: "openai-completions", baseUrl: "https://extraction.invalid/v1" };
  const runtime = { getError: () => undefined, getModel: vi.fn(() => model), getRegisteredProviderConfig: () => undefined,
    isUsingOAuth: vi.fn(() => false), isUsingSubscription: () => false,
    getAuth: vi.fn(async () => ({ auth: { apiKey: "synthetic-extraction", baseUrl: model.baseUrl } })) };
  const configuration = { createModelRuntime: vi.fn(async () => runtime as never) };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({})); vi.stubGlobal("fetch", fetcher);
  const owner = new AbortController();
  return { settings, model, runtime, configuration, fetcher, owner };
}
it("captures settings before awaits and exposes only model metadata plus a secret-bearing closure", async () => {
  const f = fixture(), source = createTeamIndexModelSource(f.configuration, f.settings);
  f.settings.extraction.model = "mutated"; f.settings.embedding.apiKey = "mutated"; f.settings.embedding.dimension = 8;
  const result = await source(f.owner.signal);
  expect(f.runtime.getModel).toHaveBeenCalledWith("synthetic", "extract");
  expect(result.embeddingDimension).toBe(4); expect(JSON.stringify(result)).not.toContain("synthetic");
  expect(f.fetcher).not.toHaveBeenCalled();
  await result.invoke("embedding", result.models.embedding, Buffer.from("{}"), f.owner.signal);
  expect(f.fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer synthetic-embedding" });
});
it("uses Pi's exact credential endpoint override and keeps request lifetime separate from resolution timeout", async () => {
  const deadline = new AbortController(), timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  const f = fixture(); f.runtime.getAuth.mockResolvedValue({ auth: { apiKey: "synthetic-override", baseUrl: "https://override.invalid/custom" } });
  const result = await createTeamIndexModelSource(f.configuration, f.settings)(f.owner.signal);
  expect(result.models.extraction.baseUrl).toBe("https://override.invalid/custom");
  expect(timeout).toHaveBeenCalledWith(15_000); deadline.abort();
  await result.invoke("extraction", result.models.extraction, Buffer.from("{}"), f.owner.signal);
  expect(f.fetcher.mock.calls[0]?.[0]).toBe("https://override.invalid/custom/chat/completions");
  f.owner.abort(); await expect(result.invoke("extraction", result.models.extraction, Buffer.from("{}"), new AbortController().signal)).rejects.toThrow("unavailable");
});
it("discards credentials that arrive after the model-resolution deadline", async () => {
  const f = fixture(), deadline = new AbortController(); vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  let release!: (value: Awaited<ReturnType<typeof f.runtime.getAuth>>) => void;
  f.runtime.getAuth.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const run = createTeamIndexModelSource(f.configuration, f.settings)(f.owner.signal);
  const rejected = expect(run).rejects.toThrow("configuration unavailable");
  await vi.waitFor(() => expect(f.runtime.getAuth).toHaveBeenCalledOnce()); deadline.abort();
  release({ auth: { apiKey: "synthetic-late", baseUrl: f.model.baseUrl } }); await rejected;
  expect(f.owner.signal.aborted).toBe(false); expect(f.fetcher).not.toHaveBeenCalled();
});
it.each([0, 3, 6, 4097, 65536, NaN])("rejects team dimension %s before Pi credential access", async dimension => {
  const f = fixture(); f.settings.embedding.dimension = dimension;
  await expect(createTeamIndexModelSource(f.configuration, f.settings)(f.owner.signal)).rejects.toThrow("Team index model configuration unavailable.");
  expect(f.configuration.createModelRuntime).not.toHaveBeenCalled();
});
it.each(["protocol", "oauth", "http", "key", "configuration"])("fails closed on %s without provider fallback", async mode => {
  const f = fixture();
  if (mode === "protocol") f.model.api = "openai-responses";
  if (mode === "oauth") f.runtime.isUsingOAuth.mockReturnValue(true);
  if (mode === "http") f.model.baseUrl = "http://127.0.0.1:8000/v1";
  if (mode === "key") f.runtime.getAuth.mockRejectedValue(new Error("synthetic-secret"));
  if (mode === "configuration") f.configuration.createModelRuntime.mockRejectedValue(new Error("synthetic-secret"));
  await expect(createTeamIndexModelSource(f.configuration, f.settings)(f.owner.signal)).rejects.toThrow("Team index model configuration unavailable.");
  expect(f.fetcher).not.toHaveBeenCalled();
});
it("rejects pre-cancelled resolution and late credentials after cancellation", async () => {
  const f = fixture(), source = createTeamIndexModelSource(f.configuration, f.settings);
  await expect(source(AbortSignal.abort())).rejects.toThrow("configuration unavailable"); expect(f.runtime.getAuth).not.toHaveBeenCalled();
  let release!: (value: Awaited<ReturnType<typeof f.runtime.getAuth>>) => void;
  f.runtime.getAuth.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const run = source(f.owner.signal), rejected = expect(run).rejects.toThrow("configuration unavailable");
  await vi.waitFor(() => expect(f.runtime.getAuth).toHaveBeenCalledOnce());
  f.owner.abort(); release({ auth: { apiKey: "synthetic-late", baseUrl: f.model.baseUrl } }); await rejected;
  expect(f.fetcher).not.toHaveBeenCalled();
});
