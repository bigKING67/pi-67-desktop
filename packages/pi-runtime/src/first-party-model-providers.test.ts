import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  GROLAND_ANTHROPIC_BASE_URL,
  GROLAND_OPENAI_BASE_URL,
  GROLAND_PROVIDER_ID,
  installFirstPartyModelProviders
} from "./first-party-model-providers.js";

describe("first-party model providers", () => {
  it("registers Groland as one mixed-protocol Provider without embedding a credential", async () => {
    const runtime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false });
    const installation = installFirstPartyModelProviders(runtime);
    expect(installFirstPartyModelProviders(runtime)).toBe(installation);
    await installation;

    const provider = runtime.getProvider(GROLAND_PROVIDER_ID);
    const models = runtime.getModels(GROLAND_PROVIDER_ID);

    expect(provider?.name).toBe("Groland");
    expect(models).toHaveLength(7);
    expect(models.map((model) => model.id)).toEqual([
      "claude-opus-4-6",
      "claude-opus-4-7",
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-sonnet-5",
      "gpt-5.4",
      "gpt-5.5"
    ]);
    expect(models.every((model) => (
      model.input.includes("text") && model.input.includes("image") && model.reasoning
    ))).toBe(true);
    expect(models.slice(0, 5).every((model) => (
      model.api === "anthropic-messages" && model.baseUrl === GROLAND_ANTHROPIC_BASE_URL
    ))).toBe(true);
    expect(models.slice(5).every((model) => (
      model.api === "openai-responses" && model.baseUrl === GROLAND_OPENAI_BASE_URL
    ))).toBe(true);
    expect(runtime.getRegisteredProviderConfig(GROLAND_PROVIDER_ID)).not.toHaveProperty("apiKey");
    expect(runtime.getRegisteredProviderConfig(GROLAND_PROVIDER_ID)?.authHeader).toBe(false);
  });

  it("registers image sources from settings.json, reusing a Provider's address and key and leaving own keys to Pi", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "first-party-image-"));
    onTestFinished(() => fs.rm(agentDir, { recursive: true, force: true }));
    const modelsPath = path.join(agentDir, "models.json");
    await fs.writeFile(modelsPath, JSON.stringify({ providers: { codex: { baseUrl: "http://127.0.0.1:8317/v1", apiKey: "fixture-key", api: "openai-responses",
      models: [{ id: "gpt-5.5", name: "gpt-5.5", input: ["text"], contextWindow: 1000, maxTokens: 100 }] } } }));
    const unconfigured = await ModelRuntime.create({ modelsPath, allowModelNetwork: false });
    await installFirstPartyModelProviders(unconfigured, agentDir);
    expect(unconfigured.getModelsOfType("image").filter((model) => model.provider.startsWith("newmoney-images"))).toEqual([]);

    await fs.writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ pi67Desktop: { imageGeneration: { sources: [
      { id: "gateway", name: "本机代理", api: "openai-images", provider: "codex", models: ["gpt-image-2.5-sunburst", "gpt-image-2.5"] },
      { id: "ark", name: "火山方舟", api: "ark-images", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", models: ["doubao-seedream-5-0-260128"] }
    ] } } }));
    const runtime = await ModelRuntime.create({ modelsPath, allowModelNetwork: false });
    await installFirstPartyModelProviders(runtime, agentDir);
    expect(runtime.getProvider(GROLAND_PROVIDER_ID)?.name).toBe("Groland");
    expect((await runtime.getAvailableOfType("image", "newmoney-images-gateway")).map((model) => [model.id, model.api, model.baseUrl])).toEqual([
      ["gpt-image-2.5-sunburst", "openai-images", "http://127.0.0.1:8317/v1"], ["gpt-image-2.5", "openai-images", "http://127.0.0.1:8317/v1"]
    ]);
    // An own endpoint without a stored key is registered but not yet available; the key is stored through Pi's API-key login.
    expect(runtime.getModelsOfType("image").filter((model) => model.provider === "newmoney-images-ark").map((model) => model.api)).toEqual(["ark-images"]);
    expect(await runtime.getAvailableOfType("image", "newmoney-images-ark")).toEqual([]);
    expect(typeof runtime.getProvider("newmoney-images-ark")?.auth.apiKey?.["login"]).toBe("function");
    expect(JSON.stringify(runtime.getRegisteredProviderConfig("newmoney-images-ark"))).not.toContain("fixture-key");
  });
});
