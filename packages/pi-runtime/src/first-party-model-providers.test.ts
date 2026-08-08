import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
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
});
