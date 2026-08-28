import type { PiProviderConfigurationSnapshot } from "@pi67/protocol";

export function createMockProviderConfigurationSnapshot(): PiProviderConfigurationSnapshot {
  return {
    revision: "c".repeat(64),
    syncState: "current",
    updatedAt: 1,
    providers: [
      {
        id: "openai",
        name: "OpenAI",
        origin: "builtin",
        configured: true,
        credentialSource: "stored",
        modelsJsonApiKeyConfigured: false,
        headerNames: [],
        models: [{
          id: "gpt-test",
          name: "GPT Test",
          api: "openai-responses",
          baseUrl: "https://api.openai.invalid/v1",
          input: ["text", "image"],
          reasoning: true,
          contextWindow: 128_000,
          maxTokens: 16_384,
          headerNames: [],
          advancedJson: "{}"
        }],
        modelCount: 1,
        advancedJson: "{}"
      },
      {
        id: "anthropic",
        name: "Anthropic",
        origin: "builtin",
        configured: false,
        modelsJsonApiKeyConfigured: false,
        headerNames: [],
        models: [{
          id: "claude-test",
          name: "Claude Test",
          api: "anthropic-messages",
          baseUrl: "https://api.anthropic.invalid",
          input: ["text", "image"],
          reasoning: true,
          contextWindow: 200_000,
          maxTokens: 16_384,
          headerNames: [],
          advancedJson: "{}"
        }],
        modelCount: 1,
        advancedJson: "{}"
      }
    ],
    credentials: [{ provider: "openai", type: "api_key" }],
    defaults: {
      global: { provider: "openai", model: "gpt-test" },
      effective: { provider: "openai", model: "gpt-test" },
      projectTrusted: true
    },
    vision: {
      global: { provider: "openai", model: "gpt-test" },
      effective: { provider: "openai", model: "gpt-test" },
      disabledByProject: false,
      projectTrusted: true
    },
    files: [
      { kind: "models", path: "/Users/test/.pi/agent/models.json", exists: false, valid: true },
      { kind: "auth", path: "/Users/test/.pi/agent/auth.json", exists: true, valid: true },
      { kind: "global-settings", path: "/Users/test/.pi/agent/settings.json", exists: true, valid: true },
      { kind: "project-settings", path: "/Users/test/project/.pi/settings.json", exists: false, valid: true }
    ],
    diagnostics: []
  };
}

export function createMockDeepSeekProviderConfigurationSnapshot(configured = false): PiProviderConfigurationSnapshot {
  const snapshot = createMockProviderConfigurationSnapshot();
  const openai = snapshot.providers.find((provider) => provider.id === "openai")!;
  const template = snapshot.providers.find((provider) => provider.id === "anthropic")!;
  return {
    ...snapshot,
    providers: [openai, {
      ...template,
      id: "deepseek",
      name: "DeepSeek",
      configured,
      ...(configured ? { credentialSource: "stored" as const } : {}),
      models: [{
        ...template.models[0]!,
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        api: "openai-completions",
        baseUrl: "https://api.deepseek.com",
        input: ["text"]
      }, {
        ...template.models[0]!,
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        api: "openai-completions",
        baseUrl: "https://api.deepseek.com",
        input: ["text"]
      }, {
        ...template.models[0]!,
        id: "deepseek-v4-flash-vision-exp",
        name: "DeepSeek V4 Flash Vision Exp",
        api: "openai-completions",
        baseUrl: "https://api.deepseek.com",
        input: ["text", "image"]
      }],
      modelCount: 3
    }]
  };
}
