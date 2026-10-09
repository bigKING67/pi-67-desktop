import { describe, expect, it } from "vitest";
import type { PiImageGenerationSourceView, PiProviderConfigurationSnapshot } from "@pi67/protocol";
import {
  draftFromSource, draftProblem, guessImageApi, isLikelyImageModel, newSourceDraft, nextSources, reusableProviders, sourceIdFor, toSource, withoutSource,
  type ImageSourceDraft
} from "./image-generation-source-draft.js";

const provider = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id === "codex" ? "本机代理" : id, configured: true, credentialSource: "stored",
  modelsJsonApiKeyConfigured: false, baseUrl: "http://127.0.0.1:8317/v1", models: [], ...extra });
const snapshot = (providers: unknown[]) => ({ providers, imageGeneration: { sources: [] } }) as unknown as PiProviderConfigurationSnapshot;
const view: PiImageGenerationSourceView = { id: "ark", name: "火山方舟", api: "ark-images", baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  models: ["doubao-seedream-5-0-260128"], piProvider: "newmoney-images-ark", endpoint: "https://ark.cn-beijing.volces.com/api/v3", credential: "stored" };
const own = (patch: Partial<ImageSourceDraft> = {}): ImageSourceDraft => ({ name: "micu", api: "openai-images", mode: "own", provider: "", baseUrl: "https://www.micuapi.ai/v1", models: ["gpt-image-2.5"], apiKey: "k", ...patch });

describe("image source drafts", () => {
  it("recognises image models and the Ark API for pre-selection", () => {
    expect(["gpt-image-2.5-sunburst", "doubao-seedream-5-0-260128", "gemini-3.1-flash-image", "dall-e-3", "flux-1.1-pro"].every(isLikelyImageModel)).toBe(true);
    expect(["gpt-5.5", "claude-opus-4-8", "doubao-seed-2-0-mini-260428"].some(isLikelyImageModel)).toBe(false);
    expect(guessImageApi("https://ark.cn-beijing.volces.com/api/v3")).toBe("ark-images");
    expect(guessImageApi("http://127.0.0.1:8317/v1", ["doubao-seedream-5-0-260128"])).toBe("ark-images");
    expect(guessImageApi("https://www.micuapi.ai/v1", ["gpt-image-2.5"])).toBe("openai-images");
  });

  it("offers only configured Providers with an address and a key, and defaults to reusing the first", () => {
    const listed = reusableProviders(snapshot([provider("codex"), provider("nokey", { credentialSource: undefined }), provider("noaddress", { baseUrl: undefined }), provider("off", { configured: false })]));
    expect(listed).toEqual([{ id: "codex", label: "本机代理", endpoint: "http://127.0.0.1:8317/v1" }]);
    expect(newSourceDraft(snapshot([provider("codex")]))).toMatchObject({ mode: "reuse", provider: "codex", name: "本机代理", api: "openai-images" });
    expect(newSourceDraft(snapshot([]))).toMatchObject({ mode: "own", provider: "" });
  });

  it("derives stable unique ids and never renames an existing source", () => {
    expect(sourceIdFor(own(), new Set())).toBe("micuapi");
    expect(sourceIdFor(own(), new Set(["micuapi"]))).toBe("micuapi-2");
    expect(sourceIdFor(own({ mode: "reuse", provider: "volcengine-ark" }), new Set())).toBe("volcengine-ark");
    expect(sourceIdFor(own({ baseUrl: "http://127.0.0.1:8317/v1" }), new Set())).toBe("images");
    expect(sourceIdFor(draftFromSource(view), new Set(["ark"]))).toBe("ark");
  });

  it("explains the first problem and never requires re-entering a stored key", () => {
    expect(draftProblem(own(), false)).toBeUndefined();
    expect(draftProblem(own({ apiKey: "" }), false)).toMatch(/API Key/);
    expect(draftProblem(own({ apiKey: "" }), true)).toBeUndefined();
    for (const baseUrl of ["http://example.com/v1", "https://u:p@x.example/v1", "https://x.example/v1?key=1", "not a url"]) expect(draftProblem(own({ baseUrl }), true), baseUrl).toMatch(/HTTPS/);
    expect(draftProblem(own({ baseUrl: "http://127.0.0.1:8317/v1" }), true)).toBeUndefined();
    expect(draftProblem(own({ models: [] }), true)).toMatch(/至少/);
    expect(draftProblem(own({ models: ["bad model"] }), true)).toMatch(/模型 ID/);
    expect(draftProblem(own({ name: " " }), true)).toMatch(/名称/);
    expect(draftProblem(own({ mode: "reuse", provider: "" }), true)).toMatch(/模型服务/);
  });

  it("saves only source fields, keeps order and never carries the key", () => {
    const saved = toSource(own(), "micuapi");
    expect(saved).toEqual({ id: "micuapi", name: "micu", api: "openai-images", baseUrl: "https://www.micuapi.ai/v1", models: ["gpt-image-2.5"] });
    expect(JSON.stringify(nextSources([view], saved))).not.toContain("credential");
    expect(nextSources([view], saved).map((item) => item.id)).toEqual(["ark", "micuapi"]);
    expect(nextSources([view], { ...toSource(draftFromSource(view), "ark"), name: "方舟" })).toEqual([{ id: "ark", name: "方舟", api: "ark-images", baseUrl: view.baseUrl, models: view.models }]);
    expect(withoutSource([view], "ark")).toEqual([]);
  });
});
