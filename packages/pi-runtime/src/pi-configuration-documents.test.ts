import type { ProviderSummary } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  parseModelsDocument,
  parseSettingsDocument,
  projectProviderConfigurations,
  removeProviderDocument,
  saveProviderDocument,
  setDefaultModelDocument,
  setVisionAssistantDocument
} from "./pi-configuration-documents.js";
import { setDesktopManagedPackagesDocument } from "./desktop-managed-package-document.js";

describe("Pi configuration documents", () => {
  it("parses Pi JSONC and preserves formatting, comments, and secret-only fields", () => {
    const source = [
      "{",
      "\t// user-owned provider configuration",
      "\t\"providers\": {",
      "\t\t\"custom\": {",
      "\t\t\t\"apiKey\": \"models-file-secret\",",
      "\t\t\t\"headers\": { \"X-Private\": \"header-secret\" },",
      "\t\t\t\"models\": [{",
      "\t\t\t\t\"id\": \"old-model\",",
      "\t\t\t\t\"headers\": { \"X-Model-Private\": \"model-header-secret\" },",
      "\t\t\t}],",
      "\t\t},",
      "\t},",
      "}",
      ""
    ].join("\r\n");

    expect(parseModelsDocument(source).providers).toHaveProperty("custom");
    const saved = saveProviderDocument(source, {
      id: "custom",
      name: "Custom Provider",
      models: [{ id: "old-model", name: "Updated model", input: ["text"] }]
    });

    expect(saved).toContain("// user-owned provider configuration");
    expect(saved).toContain("\r\n");
    expect(saved).toContain("\t\t\"custom\"");
    expect(saved).toContain("models-file-secret");
    expect(saved).toContain("header-secret");
    expect(saved).toContain("model-header-secret");
    expect(parseModelsDocument(saved).providers).toMatchObject({
      custom: {
        name: "Custom Provider",
        apiKey: "models-file-secret",
        headers: { "X-Private": "header-secret" },
        models: [{
          id: "old-model",
          name: "Updated model",
          headers: { "X-Model-Private": "model-header-secret" }
        }]
      }
    });
  });

  it("projects runtime models for built-in Providers without exposing Header values", () => {
    const providers = [{
      id: "builtin-provider",
      label: "Built-in Provider",
      configured: true,
      credentialSource: "stored",
      modelCount: 1
    }] satisfies ProviderSummary[];
    const projected = projectProviderConfigurations(parseModelsDocument("{}\n"), providers, [{
      provider: "builtin-provider",
      id: "builtin-model",
      name: "Built-in Model",
      api: "openai-responses",
      baseUrl: "https://example.invalid/v1",
      input: ["text", "image"],
      reasoning: true,
      contextWindow: 200_000,
      maxTokens: 32_000,
      thinkingLevels: ["off", "low", "high", "max"],
      headers: { "X-Provider-Feature": "runtime-header-secret" }
    }]);

    expect(projected).toEqual([expect.objectContaining({
      id: "builtin-provider",
      name: "Built-in Provider",
      origin: "builtin",
      configured: true,
      models: [expect.objectContaining({
        id: "builtin-model",
        api: "openai-responses",
        input: ["text", "image"],
        reasoning: true,
        contextWindow: 200_000,
        maxTokens: 32_000,
        thinkingLevels: ["off", "low", "high", "max"],
        headerNames: ["X-Provider-Feature"],
        advancedJson: "{}"
      })]
    })]);
    expect(JSON.stringify(projected)).not.toContain("runtime-header-secret");
  });

  it("keeps models.json model definitions authoritative over runtime projections", () => {
    const document = parseModelsDocument(JSON.stringify({
      providers: {
        custom: {
          models: [{ id: "configured-model", input: ["text"], reasoning: false }]
        }
      }
    }));
    const projected = projectProviderConfigurations(document, [{
      id: "custom",
      label: "Runtime label",
      configured: false,
      modelCount: 1
    }], [{
      provider: "custom",
      id: "runtime-model",
      name: "Runtime Model",
      api: "openai-responses",
      baseUrl: "https://example.invalid/v1",
      input: ["text"],
      reasoning: false,
      contextWindow: 8_192,
      maxTokens: 2_048,
      thinkingLevels: ["off"]
    }]);

    expect(projected[0]?.origin).toBe("models.json");
    expect(projected[0]?.models.map((model) => model.id)).toEqual(["configured-model"]);
  });

  it("rejects secret-bearing advanced JSON and duplicate model ids", () => {
    const base = { id: "custom", models: [{ id: "model-a" }] };
    expect(() => saveProviderDocument("{}\n", {
      ...base,
      advancedJson: JSON.stringify({ compat: { headers: { Authorization: "secret" } } })
    })).toThrow(/cannot read or write credential and header values/iu);
    expect(() => saveProviderDocument("{}\n", {
      id: "custom",
      models: [{ id: "duplicate" }, { id: "duplicate" }]
    })).toThrow(/must be unique/iu);
  });

  it("updates defaults and removes Providers without replacing unrelated fields", () => {
    const settings = "{\n  \"theme\": \"dark\"\n}\n";
    const selected = setDefaultModelDocument(settings, { provider: "custom", model: "model-a" });
    expect(parseSettingsDocument(selected)).toMatchObject({
      root: { theme: "dark", defaultProvider: "custom", defaultModel: "model-a" },
      selection: { provider: "custom", model: "model-a" }
    });
    expect(parseSettingsDocument(setDefaultModelDocument(selected, undefined)).selection).toBeUndefined();

    const models = JSON.stringify({ providers: { keep: { models: [] }, remove: { models: [] } } }, null, 2);
    expect(parseModelsDocument(removeProviderDocument(models, "remove")).providers).toEqual({
      keep: { models: [] }
    });
  });

  it("round-trips global and project visual-assistance overrides as Pi JSONC", () => {
    const settings = "{\n  // preserve user fields\n  \"theme\": \"dark\"\n}\n";
    const selected = setVisionAssistantDocument(settings, {
      mode: "model",
      provider: "bailian",
      model: "qwen3.7-flash"
    });
    expect(parseSettingsDocument(selected)).toMatchObject({
      root: { theme: "dark" },
      visionAssistant: { mode: "model", provider: "bailian", model: "qwen3.7-flash" }
    });
    expect(parseSettingsDocument(setVisionAssistantDocument(selected, { mode: "disabled" })).visionAssistant)
      .toEqual({ mode: "disabled" });
    expect(parseSettingsDocument(setVisionAssistantDocument(selected, undefined)).visionAssistant)
      .toBeUndefined();
  });

  it("projects stable Desktop Packages while preserving user Packages and JSONC", () => {
    const root = "/Users/test/.pi/agent/desktop-capabilities/shared-profile";
    const source = [
      "{",
      "  // user packages stay authoritative",
      "  \"theme\": \"dark\",",
      '  "packages": [',
      "    \"npm:user-package\",",
      `    "${root}/previous/packages/stale"`,
      "  ]",
      "}",
      ""
    ].join("\n");

    const projected = setDesktopManagedPackagesDocument(source, root, [
      { source: `${root}/active/packages/pi-workspace-resources`, extensions: [] },
      `${root}/active/packages/design-craft`
    ]);

    expect(projected).toContain("// user packages stay authoritative");
    expect(parseSettingsDocument(projected).root).toMatchObject({
      theme: "dark",
      packages: [
        "npm:user-package",
        { source: `${root}/active/packages/pi-workspace-resources`, extensions: [] },
        `${root}/active/packages/design-craft`
      ]
    });
    expect(projected).not.toContain("previous/packages/stale");
  });
});
