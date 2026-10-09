import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { PiImageGenerationSource } from "@pi67/protocol";
import { parseImageGenerationSources, projectImageGeneration } from "./image-generation-settings.js";
import { parseSettingsDocument, setImageGenerationDocument } from "./pi-configuration-documents.js";
import { createPiConfigurationFixture as createFixture } from "./pi-configuration-service-test-fixture.js";

const reuse: PiImageGenerationSource = { id: "gateway", name: "本机代理", api: "openai-images", provider: "pi67-test", models: ["gpt-image-2.5-sunburst"] };
const own: PiImageGenerationSource = { id: "ark", name: "火山方舟", api: "ark-images", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", models: ["doubao-seedream-5-0-260128"] };

describe("image generation settings", () => {
  it("accepts reuse and own-endpoint sources and refuses anything ambiguous or unsafe", () => {
    expect(parseImageGenerationSources(undefined)).toEqual([]);
    expect(parseImageGenerationSources({ sources: [reuse, own] })).toEqual([reuse, own]);
    for (const [label, source] of [
      ["both", { ...reuse, baseUrl: own.baseUrl }], ["neither", { ...reuse, provider: undefined }], ["api", { ...reuse, api: "dalle" }],
      ["insecure", { ...own, baseUrl: "http://example.com/v1" }], ["query", { ...own, baseUrl: "https://x.example/v1?key=1" }],
      ["credentials", { ...own, baseUrl: "https://user:pw@x.example/v1" }], ["self", { ...reuse, provider: "newmoney-images-ark" }],
      ["models", { ...reuse, models: [] }], ["duplicate models", { ...reuse, models: ["a", "a"] }], ["key", { ...reuse, apiKey: "sk-x" }], ["name", { ...reuse, name: " " }]
    ] as const) expect(() => parseImageGenerationSources({ sources: [JSON.parse(JSON.stringify(source))] }), label).toThrow(/pi67Desktop\.imageGeneration/);
    expect(() => parseImageGenerationSources({ sources: [reuse, reuse] })).toThrow(/unique/);
    expect(() => parseImageGenerationSources({ sources: Array.from({ length: 9 }, (_, index) => ({ ...reuse, id: `s${index}` })) })).toThrow(/at most 8/);
  });

  it("writes into pi67Desktop without disturbing other settings and removes the key when empty", () => {
    const written = setImageGenerationDocument('{\n  "defaultProvider": "x", // keep\n  "defaultModel": "y"\n}\n', [own]);
    expect(written).toContain("// keep");
    expect(parseSettingsDocument(written)).toMatchObject({ selection: { provider: "x", model: "y" }, imageGeneration: [own] });
    expect(parseSettingsDocument(setImageGenerationDocument(written, [])).root).not.toHaveProperty("pi67Desktop.imageGeneration");
  });

  it("projects endpoints and credential state per source", () => {
    const providers = [{ id: "pi67-test", baseUrl: "http://127.0.0.1:8317/v1", credentialSource: "stored", modelsJsonApiKeyConfigured: false, models: [] }] as never;
    expect(projectImageGeneration([reuse, own], providers, []).sources).toEqual([
      { ...reuse, piProvider: "newmoney-images-gateway", endpoint: "http://127.0.0.1:8317/v1", credential: "reused" },
      { ...own, piProvider: "newmoney-images-ark", endpoint: own.baseUrl, credential: "missing" }
    ]);
    expect(projectImageGeneration([own], [], [{ provider: "newmoney-images-ark", type: "api_key" }]).sources[0]?.credential).toBe("stored");
    expect(projectImageGeneration([reuse], [], []).sources[0]).toMatchObject({ credential: "missing" });
  });

  it("persists sources through the configuration service and stores an own endpoint's key in auth.json", async () => {
    const fixture = await createFixture();
    try {
      const initial = await fixture.service.getGlobal();
      const saved = await fixture.service.saveGlobalProvider(initial.revision, { id: "pi67-test", baseUrl: "http://127.0.0.1:8317/v1", api: "openai-responses",
        models: [{ id: "chat", input: ["text"], reasoning: false, contextWindow: 16_384, maxTokens: 4_096 }] });
      const keyed = await fixture.service.storeGlobalCredential(saved.revision, "pi67-test", "fixture-reused-key");
      await expect(fixture.service.setGlobalImageGenerationSources(keyed.revision, [{ ...reuse, provider: "not-configured" }])).rejects.toMatchObject({ code: "RESOURCE_NOT_FOUND" });
      await expect(fixture.service.setGlobalImageGenerationSources(keyed.revision, [{ ...own, baseUrl: "http://example.com" }])).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
      const set = await fixture.service.setGlobalImageGenerationSources(keyed.revision, [reuse, own]);
      expect(set.imageGeneration.sources.map((source) => [source.id, source.endpoint, source.credential])).toEqual([
        ["gateway", "http://127.0.0.1:8317/v1", "reused"], ["ark", own.baseUrl, "missing"]
      ]);
      expect(set.providers.some((provider) => provider.id.startsWith("newmoney-images"))).toBe(false);
      const settings = await readFile(fixture.service.globalSettingsPath, "utf8");
      expect(JSON.parse(settings)).toMatchObject({ pi67Desktop: { imageGeneration: { sources: [reuse, own] } } });
      expect(settings).not.toContain("fixture-reused-key");
      const stored = await fixture.service.storeGlobalCredential(set.revision, "newmoney-images-ark", "fixture-ark-key");
      expect(stored.imageGeneration.sources[1]?.credential).toBe("stored");
      expect(JSON.stringify(stored)).not.toContain("fixture-ark-key");
      const cleared = await fixture.service.setGlobalImageGenerationSources(stored.revision, []);
      expect(cleared.imageGeneration.sources).toEqual([]);
    } finally {
      await fixture.dispose();
    }
  }, 30_000);
});
