import type { SessionSnapshot } from "@pi67/domain";
import { eventEnvelope, type CommandResults } from "@pi67/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { clearRendererQueue } from "../composer/queue-controller.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import {
  configureRuntimeProviderKey,
  reloadSessionResources,
  selectSessionModel
} from "../session/session-control-controller.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { installSessionProjectionFixture } from "../session/session-projection-test-support.js";
import { useSessionTreeStore } from "../session-tree/session-tree-store.js";
import { updateWorkspaceTrust } from "../workspace/workspace-trust-controller.js";
import { useAppStore } from "./app-store.js";

describe("App Store Session controls", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetStores();
    installSession("session-1", 3);
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue({
      appInstanceId: "app-1",
      hostInstanceId: "host-9",
      hostEpoch: 9,
      sdkVersion: "0.81.1",
      eventSequence: 0
    });
  });

  it("drops a delayed trust response and stale finally after the Session is replaced", async () => {
    const request = deferred<CommandResults["workspace.setTrust"]>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(request.promise as never);

    const updating = updateWorkspaceTrust("trusted");
    await Promise.resolve();
    installSession("session-2", 4);
    useAppStore.setState({
      trustUpdating: false,
      sessionTransitionPending: true,
      runtime: { phase: "recovering", detail: "正在恢复新会话", recoverable: true }
    });

    request.resolve(resourceCatalogResult("session-1", {
      resources: [{ kind: "skill", id: "old", label: "Old", status: "ready" }]
    }));
    await updating;

    expect(useAppStore.getState()).toMatchObject({
      trust: "unknown",
      trustUpdating: false,
      sessionTransitionPending: true,
      runtime: { phase: "recovering", detail: "正在恢复新会话" }
    });
    expect(useSessionProjectionStore.getState()).toMatchObject({
      authority: { sessionId: "session-2", sessionGeneration: 4 },
      resources: []
    });
  });

  it("keeps newer Session metadata when a trust response reloads controls and resources", async () => {
    const request = deferred<CommandResults["workspace.setTrust"]>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(request.promise as never);

    const updating = updateWorkspaceTrust("trusted");
    await Promise.resolve();
    emitMeta("Current session", { provider: "openai", id: "gpt" }, "off");
    request.resolve(resourceCatalogResult("session-1", {
      controls: {
        selectedModel: { provider: "anthropic", id: "claude" },
        thinkingLevel: "high"
      },
      modelCatalog: {
        models: [{ provider: "anthropic", id: "claude", label: "Claude", configured: true, reasoning: true }],
        providers: [{ id: "anthropic", label: "Anthropic", configured: true, modelCount: 1 }],
        availableThinkingLevels: ["off", "high", "max"]
      },
      resources: [{ kind: "skill", id: "current-resource", label: "Current", status: "ready" }]
    }));
    await updating;

    expect(useAppStore.getState()).toMatchObject({
      trust: "trusted",
      runtime: { phase: "ready", detail: "Pi 资源已就绪" }
    });
    expect(useSessionProjectionStore.getState()).toMatchObject({
      identity: {
        sessionPath: "/sessions/session-1.jsonl",
        sessionName: "Current session",
        cwd: "/workspace"
      },
      controls: {
        selectedModel: { provider: "openai", id: "gpt" },
        thinkingLevel: "off"
      },
      modelCatalog: {
        models: [{ provider: "anthropic", id: "claude", label: "Claude", configured: true, reasoning: true }],
        providers: [{ id: "anthropic", label: "Anthropic", configured: true, modelCount: 1 }],
        availableThinkingLevels: ["off", "high", "max"]
      },
      resources: [{ kind: "skill", id: "current-resource", label: "Current", status: "ready" }]
    });
  });

  it("does not publish trust readiness after a projection subscriber replaces the Session", async () => {
    vi.spyOn(agentConnectionController, "request").mockResolvedValue(resourceCatalogResult("session-1", {
      resources: [{ kind: "skill", id: "trigger-switch", label: "Switch", status: "ready" }]
    }) as never);
    let switched = false;
    const unsubscribe = useSessionProjectionStore.subscribe((state) => {
      if (switched || state.resources?.[0]?.id !== "trigger-switch") return;
      switched = true;
      installSession("session-2", 4);
      useAppStore.setState({
        trust: "unknown",
        sessionTransitionPending: true,
        runtime: { phase: "recovering", detail: "正在恢复新会话", recoverable: true }
      });
    });

    try {
      await updateWorkspaceTrust("trusted");
    } finally {
      unsubscribe();
    }

    expect(switched).toBe(true);
    expect(useAppStore.getState()).toMatchObject({
      trust: "unknown",
      sessionTransitionPending: true,
      runtime: { phase: "recovering", detail: "正在恢复新会话" }
    });
  });

  it("keeps a newer queue event when queue.clear acknowledgement arrives late", async () => {
    const request = deferred<{ cleared: number }>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(request.promise as never);

    const clearing = clearRendererQueue();
    await Promise.resolve();
    emitQueue(["newer steer"], ["newer follow-up"]);
    request.resolve({ cleared: 2 });

    await expect(clearing).resolves.toBe(true);
    expect(useSessionProjectionStore.getState().queue).toEqual({
      steeringQueue: ["newer steer"],
      followUpQueue: ["newer follow-up"]
    });
  });

  it("applies only model controls from a delayed narrow response", async () => {
    const request = deferred<CommandResults["model.select"]>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(request.promise as never);

    const selecting = selectSessionModel("anthropic", "claude");
    await Promise.resolve();
    emitQueue(["newer queue"], []);
    emitUsage(50, 0.5, 25);
    request.resolve({
      sessionId: "session-1",
      controls: {
        selectedModel: { provider: "anthropic", id: "claude" },
        thinkingLevel: "high"
      }
    });
    await selecting;

    expect(useSessionProjectionStore.getState()).toMatchObject({
      controls: { selectedModel: { provider: "anthropic", id: "claude" } },
      queue: { steeringQueue: ["newer queue"], followUpQueue: [] },
      usage: { tokens: 50, cost: 0.5, contextPercent: 25 }
    });
  });

  it("installs Provider catalog changes without rolling back newer Session controls", async () => {
    const request = deferred<CommandResults["model.setRuntimeKey"]>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(request.promise as never);

    const configuring = configureRuntimeProviderKey("anthropic", "sk-runtime-secret");
    await Promise.resolve();
    emitMeta("Current session", { provider: "openai", id: "gpt" }, "off");
    request.resolve({
      sessionId: "session-1",
      controls: {
        selectedModel: { provider: "anthropic", id: "claude" },
        thinkingLevel: "high"
      },
      modelCatalog: {
        models: [
        { provider: "openai", id: "gpt", label: "GPT", configured: true, reasoning: true },
        { provider: "anthropic", id: "claude", label: "Claude", configured: true, reasoning: true }
        ],
        providers: [
        { id: "openai", label: "OpenAI", configured: true, modelCount: 1 },
        { id: "anthropic", label: "Anthropic", configured: true, modelCount: 1, credentialSource: "runtime" }
        ],
        availableThinkingLevels: ["off", "high"]
      }
    });

    await expect(configuring).resolves.toBe(true);
    expect(useSessionProjectionStore.getState()).toMatchObject({
      identity: { sessionName: "Current session" },
      controls: {
        selectedModel: { provider: "openai", id: "gpt" },
        thinkingLevel: "off"
      },
      modelCatalog: {
        providers: expect.arrayContaining([
          expect.objectContaining({ id: "anthropic", configured: true, credentialSource: "runtime" })
        ])
      }
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "info",
      title: "anthropic API 密钥已在本次运行中启用"
    });
  });

  it("does not confirm a runtime API key after projection installation changes authority", async () => {
    vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      sessionId: "session-1",
      controls: {
        selectedModel: { provider: "openai", id: "gpt" },
        thinkingLevel: "high"
      },
      modelCatalog: {
        models: [{ provider: "openai", id: "gpt", label: "GPT", configured: true, reasoning: true }],
        providers: [
          { id: "openai", label: "OpenAI", configured: true, modelCount: 1 },
          { id: "anthropic", label: "Anthropic", configured: true, modelCount: 1, credentialSource: "runtime" }
        ],
        availableThinkingLevels: ["off", "high"]
      }
    } as never);
    let switched = false;
    const unsubscribe = useSessionProjectionStore.subscribe((state) => {
      if (switched || !state.modelCatalog?.providers.some((provider) => provider.id === "anthropic")) return;
      switched = true;
      installSession("session-2", 4);
    });

    try {
      await expect(configureRuntimeProviderKey("anthropic", "sk-runtime-secret"))
        .resolves.toBe(false);
    } finally {
      unsubscribe();
    }

    expect(switched).toBe(true);
    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      sessionId: "session-2",
      sessionGeneration: 4
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "Provider API 密钥状态需要重新确认"
    });
  });

  it("reloads resources without replacing conversation, tree, queue, or usage", async () => {
    const beforeMessages = useConversationStore.getState().messages;
    const beforeTree = useSessionTreeStore.getState().tree;
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      sessionId: "session-1",
      controls: {
        selectedModel: { provider: "anthropic", id: "claude" },
        thinkingLevel: "high"
      },
      modelCatalog: {
        models: [{ provider: "anthropic", id: "claude", label: "Claude", configured: true, reasoning: true }],
        providers: [{ id: "anthropic", label: "Anthropic", configured: true, modelCount: 1 }],
        availableThinkingLevels: ["off", "high"]
      },
      resources: [{ kind: "extension", id: "new", label: "New", status: "ready" }]
    } as never);
    emitQueue(["current queue"], []);
    emitUsage(60, 0.6, 30);

    await reloadSessionResources();

    expect(request).toHaveBeenCalledWith("resource.reload", {});
    expect(useConversationStore.getState().messages).toBe(beforeMessages);
    expect(useSessionTreeStore.getState().tree).toBe(beforeTree);
    expect(useSessionProjectionStore.getState()).toMatchObject({
      identity: {
        sessionPath: "/sessions/session-1.jsonl",
        sessionName: "session-1",
        cwd: "/workspace"
      },
      modelCatalog: {
        models: [{ provider: "anthropic", id: "claude", label: "Claude", configured: true, reasoning: true }],
        providers: [{ id: "anthropic", label: "Anthropic", configured: true, modelCount: 1 }]
      },
      controls: {
        selectedModel: { provider: "anthropic", id: "claude" },
        thinkingLevel: "high"
      },
      resources: [{ kind: "extension", id: "new", label: "New", status: "ready" }],
      queue: { steeringQueue: ["current queue"], followUpQueue: [] },
      usage: { tokens: 60, cost: 0.6, contextPercent: 30 }
    });
  });
});

function installSession(sessionId: string, sessionGeneration: number): void {
  const value = snapshot(sessionId);
  useAppStore.setState({
    connected: true,
    hostEpoch: 9,
    workspace: "/workspace",
    trust: "unknown",
    trustUpdating: false,
    sessionTransitionPending: false,
    runtime: { phase: "ready", detail: "Ready", recoverable: true }
  });
  const authority = installSessionProjectionFixture(
    useAppStore.getState(),
    value,
    sessionGeneration
  );
  if (!authority) throw new Error("Expected Session projection fixture authority.");
  useConversationStore.getState().replaceSnapshot(value, authority);
  useSessionTreeStore.getState().replaceProjection(authority, value.tree);
}

function emitQueue(steeringQueue: string[], followUpQueue: string[]): void {
  const payload = { steeringQueue, followUpQueue };
  useAppStore.getState().receiveAgentEvent(
    { type: "queue.changed", payload },
    eventEnvelope("queue.changed", payload, {
      hostEpoch: 9,
      sequence: 1,
      sessionId: "session-1",
      sessionGeneration: 3
    })
  );
}

function emitUsage(tokens: number, cost: number, contextPercent: number): void {
  const payload = { tokens, cost, contextPercent };
  useAppStore.getState().receiveAgentEvent(
    { type: "usage.changed", payload },
    eventEnvelope("usage.changed", payload, {
      hostEpoch: 9,
      sequence: 2,
      sessionId: "session-1",
      sessionGeneration: 3
    })
  );
}

function emitMeta(
  sessionName: string,
  selectedModel: NonNullable<SessionSnapshot["selectedModel"]>,
  thinkingLevel: string
): void {
  const payload = {
    sessionName,
    selectedModel,
    thinkingLevel,
    streaming: false
  };
  useAppStore.getState().receiveAgentEvent(
    { type: "session.metaChanged", payload },
    eventEnvelope("session.metaChanged", payload, {
      hostEpoch: 9,
      sequence: 3,
      sessionId: "session-1",
      sessionGeneration: 3
    })
  );
}

function snapshot(
  sessionId: string,
  overrides: Partial<SessionSnapshot> = {}
): SessionSnapshot {
  return {
    sessionId,
    sessionPath: `/sessions/${sessionId}.jsonl`,
    sessionName: sessionId,
    cwd: "/workspace",
    streaming: false,
    messages: [{ id: "message-1", role: "assistant", parts: [{ type: "text", text: "ready" }] }],
    messagePage: { hasOlder: false, hasNewer: false },
    models: [{ provider: "openai", id: "gpt", label: "GPT", configured: true, reasoning: true }],
    providers: [{ id: "openai", label: "OpenAI", configured: true, modelCount: 1 }],
    selectedModel: { provider: "openai", id: "gpt" },
    thinkingLevel: "high",
    availableThinkingLevels: ["off", "high"],
    steeringQueue: [],
    followUpQueue: [],
    tree: {
      nodes: [{
        id: "entry-1",
        parentId: null,
        type: "message",
        preview: "ready",
        active: true,
        depth: 0
      }],
      truncated: false,
      total: 1
    },
    resources: [],
    stats: { tokens: 10, cost: 0.1, contextPercent: 5 },
    ...overrides
  };
}

function resourceCatalogResult(
  sessionId: string,
  overrides: Partial<CommandResults["workspace.setTrust"]> = {}
): CommandResults["workspace.setTrust"] {
  return {
    sessionId,
    controls: {
      selectedModel: { provider: "openai", id: "gpt" },
      thinkingLevel: "high"
    },
    modelCatalog: {
      models: [{ provider: "openai", id: "gpt", label: "GPT", configured: true, reasoning: true }],
      providers: [{ id: "openai", label: "OpenAI", configured: true, modelCount: 1 }],
      availableThinkingLevels: ["off", "high"]
    },
    resources: [],
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve
  };
}

function resetStores(): void {
  useAppStore.setState(useAppStore.getInitialState(), true);
  useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
  useConversationStore.setState(useConversationStore.getInitialState(), true);
  useSessionTreeStore.setState(useSessionTreeStore.getInitialState(), true);
  useNotificationStore.setState(useNotificationStore.getInitialState(), true);
}
