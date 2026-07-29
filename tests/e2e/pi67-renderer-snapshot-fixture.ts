import type { FixtureMessage } from "./pi67-renderer-fixture-types.js";

interface MockSessionControlCommandResult {
  snapshot: Record<string, unknown>;
  result: unknown;
}

export type MockSessionControlCommandHandler = (
  type: string,
  payload: Record<string, unknown>,
  snapshot: Record<string, unknown>
) => MockSessionControlCommandResult | undefined;

type MockSessionControlWindow = Window & typeof globalThis & {
  __pi67ApplyMockSessionControlCommand?: MockSessionControlCommandHandler;
};

export function createMockSessionSnapshot(messages: FixtureMessage[]): Record<string, unknown> {
  const recentMessages = messages.slice(-100);
  return {
    sessionId: "session-test",
    sessionPath: "/Users/test/.pi/agent/sessions/demo.jsonl",
    cwd: "/Users/test/Projects/pi-demo",
    streaming: false,
    messages: recentMessages,
    messagePage: {
      ...(recentMessages[0] === undefined ? {} : { startCursor: recentMessages[0].id }),
      ...(recentMessages.at(-1) === undefined ? {} : { endCursor: recentMessages.at(-1)!.id }),
      hasOlder: messages.length > 100,
      hasNewer: false
    },
    models: [
      { provider: "openai", id: "gpt-test", label: "GPT Test", configured: true, reasoning: true },
      { provider: "anthropic", id: "claude-test", label: "Claude Test", configured: false, reasoning: true }
    ],
    providers: [
      { id: "openai", label: "OpenAI", configured: true, credentialSource: "stored", modelCount: 1 },
      { id: "anthropic", label: "Anthropic", configured: false, modelCount: 1 },
      { id: "codex", label: "codex", configured: true, credentialSource: "stored", modelCount: 3 },
      { id: "deepseek", label: "DeepSeek", configured: true, credentialSource: "stored", modelCount: 2 },
      { id: "amazon-bedrock", label: "Amazon Bedrock", configured: false, modelCount: 109 },
      { id: "ant-ling", label: "Ant Ling", configured: false, modelCount: 3 },
      { id: "azure-openai-responses", label: "Azure OpenAI", configured: false, modelCount: 46 },
      { id: "google", label: "Google", configured: false, modelCount: 18 },
      { id: "mistral", label: "Mistral", configured: false, modelCount: 12 },
      { id: "xai", label: "xAI", configured: false, modelCount: 7 }
    ],
    selectedModel: { provider: "openai", id: "gpt-test" },
    thinkingLevel: "medium",
    availableThinkingLevels: ["off", "medium", "high"],
    steeringQueue: [],
    followUpQueue: [],
    tree: { nodes: [], truncated: false, total: 0 },
    resources: [{
      kind: "skill",
      id: "design-craft",
      label: "design-craft",
      path: "/Users/test/.agents/skills/design-craft/SKILL.md",
      source: "~/.agents/skills",
      scope: "user",
      origin: "top-level",
      status: "ready"
    }, {
      kind: "prompt",
      id: "review",
      label: "/review",
      path: "/Users/test/.pi/agent/prompts/review.md",
      source: "~/.pi/agent/prompts",
      scope: "user",
      origin: "top-level",
      status: "ready"
    }, {
      kind: "extension",
      id: "/Users/test/Projects/pi-demo/.pi/extensions/project-tools.ts",
      label: ".pi/extensions/project-tools.ts",
      path: "/Users/test/Projects/pi-demo/.pi/extensions/project-tools.ts",
      source: ".pi/extensions",
      scope: "project",
      origin: "top-level",
      status: "ready"
    }, {
      kind: "context",
      id: "/Users/test/.pi/agent/AGENTS.md",
      label: "AGENTS.md",
      path: "/Users/test/.pi/agent/AGENTS.md",
      source: "/Users/test/.pi/agent/AGENTS.md",
      scope: "user",
      origin: "top-level",
      status: "ready"
    }, {
      kind: "context",
      id: "/Users/test/Projects/pi-demo/AGENTS.md",
      label: "AGENTS.md",
      path: "/Users/test/Projects/pi-demo/AGENTS.md",
      source: "/Users/test/Projects/pi-demo/AGENTS.md",
      scope: "project",
      origin: "top-level",
      status: "ready"
    }],
    stats: { tokens: 0, cost: 0, contextPercent: 0 }
  };
}

export function installMockSessionControlCommandHandler(): void {
  const controlWindow = window as MockSessionControlWindow;
  controlWindow.__pi67ApplyMockSessionControlCommand = (type, payload, snapshot) => {
    if (type === "model.setRuntimeKey" && typeof payload.provider === "string") {
      const providerId = payload.provider;
      const models = snapshot.models as Array<Record<string, unknown>>;
      const providers = snapshot.providers as Array<Record<string, unknown>>;
      const nextSnapshot = {
        ...snapshot,
        models: models.map((model) => model.provider === providerId ? { ...model, configured: true } : model),
        providers: providers.map((provider) => provider.id === providerId
          ? { ...provider, configured: true, credentialSource: "runtime" }
          : provider)
      };
      return { snapshot: nextSnapshot, result: modelCatalogResult(nextSnapshot) };
    }
    if (type === "model.select" && typeof payload.provider === "string" && typeof payload.id === "string") {
      const nextSnapshot = {
        ...snapshot,
        selectedModel: { provider: payload.provider, id: payload.id }
      };
      return { snapshot: nextSnapshot, result: controlResult(nextSnapshot) };
    }
    if (type === "thinking.set" && typeof payload.level === "string") {
      const nextSnapshot = { ...snapshot, thinkingLevel: payload.level };
      return { snapshot: nextSnapshot, result: controlResult(nextSnapshot) };
    }
    if (type === "workspace.setTrust" || type === "resource.reload") {
      return { snapshot, result: resourceCatalogResult(snapshot) };
    }
    return undefined;
  };

  function controlResult(snapshot: Record<string, unknown>): Record<string, unknown> {
    return {
      sessionId: snapshot.sessionId,
      controls: {
        ...(snapshot.selectedModel === undefined ? {} : { selectedModel: snapshot.selectedModel }),
        thinkingLevel: snapshot.thinkingLevel
      }
    };
  }

  function modelCatalogResult(snapshot: Record<string, unknown>): Record<string, unknown> {
    return {
      ...controlResult(snapshot),
      modelCatalog: {
        models: snapshot.models,
        providers: snapshot.providers,
        availableThinkingLevels: snapshot.availableThinkingLevels
      }
    };
  }

  function resourceCatalogResult(snapshot: Record<string, unknown>): Record<string, unknown> {
    return { ...modelCatalogResult(snapshot), resources: snapshot.resources };
  }
}
