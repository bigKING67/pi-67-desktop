import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROVIDER_DISCOVERY_OPENAI_API,
  DEFAULT_PROVIDER_DISCOVERY_PROTOCOLS,
  mergeDiscoveredModels,
  ProviderModelDiscovery
} from "./ProviderModelDiscovery.js";

describe("Provider model discovery", () => {
  it("defaults the three protocol families on and presents Responses as the preferred OpenAI route", () => {
    const markup = renderToStaticMarkup(createElement(ProviderModelDiscovery, {
      apiKey: "",
      draft: {
        id: "gateway",
        baseUrl: "http://127.0.0.1:8317/v1",
        models: [],
        advancedJson: "{}"
      },
      hasStoredCredential: true,
      onApiKeyChange: vi.fn()
    }));

    expect(markup).toContain("OpenAI 兼容");
    expect(markup).toContain("Anthropic Messages");
    expect(markup).toContain("Google Gemini");
    expect(DEFAULT_PROVIDER_DISCOVERY_PROTOCOLS).toEqual(["openai", "anthropic", "gemini"]);
    expect(DEFAULT_PROVIDER_DISCOVERY_OPENAI_API).toBe("openai-responses");
    expect(markup).toContain("Responses 优先");
    expect(markup).toContain("留空则使用已保存的 Pi API Key");
  });

  it("adds selected discoveries with exact model-level APIs and preserves existing rows", () => {
    const existing = [{
      id: "manual-model",
      api: "company-custom-api",
      input: ["text" as const],
      reasoning: true,
      advancedJson: "{}"
    }];
    const models = mergeDiscoveredModels(existing, [
      {
        id: "manual-model",
        protocol: "openai",
        api: "openai-responses",
        discoveredBy: ["openai"],
        verification: "catalog"
      },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        supplier: "supplier-a",
        protocol: "anthropic",
        api: "anthropic-messages",
        discoveredBy: ["anthropic"],
        verification: "catalog"
      }
    ]);

    expect(models).toHaveLength(2);
    expect(models[0]).toEqual(existing[0]);
    expect(models[1]).toEqual({
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      api: "anthropic-messages",
      input: ["text"],
      reasoning: false,
      advancedJson: "{}"
    });
  });
});
