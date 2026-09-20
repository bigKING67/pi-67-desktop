import { writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLocalMemoryExtractionModel } from "./local-memory-extraction-model.js";
import { createPiConfigurationFixture } from "./pi-configuration-service-test-fixture.js";

const fixtures: Awaited<ReturnType<typeof createPiConfigurationFixture>>[] = [];
const selection = { provider: "memory-fixture", model: "extract" };
async function fixture(api = "openai-completions", headers?: Record<string, string>) {
  const value = await createPiConfigurationFixture({ initialAuthContent: JSON.stringify({
    "memory-fixture": { type: "api_key", key: "synthetic-memory-key" }
  }) });
  fixtures.push(value);
  await writeFile(value.service.modelsPath, JSON.stringify({ providers: {
    "memory-fixture": { baseUrl: "https://example.invalid/v1", api,
      ...(headers ? { headers } : {}), models: [{ id: "extract", input: ["text"], reasoning: false }] }
  } }));
  return value;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const value of fixtures.splice(0)) await value.dispose();
});

describe("Pi-owned memory extraction configuration", () => {
  it("resolves the exact Pi model and reloads rotated credentials without another store", async () => {
    const { service } = await fixture();
    const signal = new AbortController().signal;
    expect(await resolveLocalMemoryExtractionModel(service, selection, signal)).toEqual({
      protocol: "openai-compatible", endpoint: "https://example.invalid/v1", model: "extract", apiKey: "synthetic-memory-key"
    });
    // Use the same serialized, revision-checked mutation as the product. A raw
    // write races the automatic prewarm started by the previous resolution and
    // can legitimately trigger CONFIGURATION_CHANGED_EXTERNALLY (fail closed).
    const current = await service.getGlobal();
    await service.storeGlobalCredential(current.revision, selection.provider, "rotated-synthetic-key");
    expect((await resolveLocalMemoryExtractionModel(service, selection, signal)).apiKey).toBe("rotated-synthetic-key");
  });

  it.each(["openai-responses", "anthropic-messages"])("does not translate %s into a different protocol", async (api) => {
    const { service } = await fixture(api);
    await expect(resolveLocalMemoryExtractionModel(service, selection, new AbortController().signal))
      .rejects.toThrow(/Chat Completions/u);
  });

  it("does not silently omit extra provider headers", async () => {
    const { service } = await fixture("openai-completions", { "X-Synthetic-Tenant": "fixture" });
    await expect(resolveLocalMemoryExtractionModel(service, selection, new AbortController().signal))
      .rejects.toThrow(/headers/u);
  });

  it("rejects a missing model and cancellation before looking up credentials", async () => {
    const { service } = await fixture();
    await expect(resolveLocalMemoryExtractionModel(service, { ...selection, model: "missing" }, new AbortController().signal))
      .rejects.toThrow(/not in the Pi catalog/u);
    const create = vi.spyOn(service, "createModelRuntime");
    const controller = new AbortController(); controller.abort();
    await expect(resolveLocalMemoryExtractionModel(service, selection, controller.signal)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects OAuth delegation before invoking auth and redacts authentication failures", async () => {
    const { service } = await fixture();
    const runtime = await service.createModelRuntime();
    const configuration = { createModelRuntime: async () => runtime };
    const auth = vi.spyOn(runtime, "getAuth").mockRejectedValue(new Error("synthetic-secret-error"));
    const oauth = vi.spyOn(runtime, "isUsingOAuth").mockReturnValue(true);
    await expect(resolveLocalMemoryExtractionModel(configuration, selection, new AbortController().signal)).rejects.toThrow(/OAuth/u);
    expect(auth).not.toHaveBeenCalled();
    oauth.mockReturnValue(false);
    await expect(resolveLocalMemoryExtractionModel(configuration, selection, new AbortController().signal))
      .rejects.toThrow("Pi could not resolve memory extraction credentials.");
  });

  it("honors Pi auth endpoint overrides and rejects insecure destinations", async () => {
    const { service } = await fixture();
    const runtime = await service.createModelRuntime();
    const configuration = { createModelRuntime: async () => runtime };
    const auth = vi.spyOn(runtime, "getAuth").mockResolvedValue({ auth: { apiKey: "synthetic", baseUrl: "https://override.invalid/v1" } });
    expect((await resolveLocalMemoryExtractionModel(configuration, selection, new AbortController().signal)).endpoint)
      .toBe("https://override.invalid/v1");
    auth.mockResolvedValue({ auth: { apiKey: "synthetic", baseUrl: "http://remote.invalid/v1" } });
    await expect(resolveLocalMemoryExtractionModel(configuration, selection, new AbortController().signal))
      .rejects.toThrow(/HTTPS/u);
  });

  it("redacts configuration failures and rejects missing keys or provider environments", async () => {
    await expect(resolveLocalMemoryExtractionModel({ createModelRuntime: async () => { throw new Error("synthetic-secret"); } },
      selection, new AbortController().signal)).rejects.toThrow("Pi model configuration is unavailable for memory extraction.");
    const { service } = await fixture();
    const runtime = await service.createModelRuntime();
    const configuration = { createModelRuntime: async () => runtime };
    const auth = vi.spyOn(runtime, "getAuth").mockResolvedValue(undefined);
    await expect(resolveLocalMemoryExtractionModel(configuration, selection, new AbortController().signal))
      .rejects.toThrow(/configured API key/u);
    auth.mockResolvedValue({ auth: { apiKey: "synthetic" }, env: { SYNTHETIC_ACCOUNT: "fixture" } });
    await expect(resolveLocalMemoryExtractionModel(configuration, selection, new AbortController().signal))
      .rejects.toThrow(/provider environment/u);
  });
});
