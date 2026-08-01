import type { CommandResults } from "@pi67/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { clearRendererQueue } from "../composer/queue-controller.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import {
  configureRuntimeProviderKey,
  selectSessionModel
} from "../session/session-control-controller.js";
import {
  useModelSelectionStore
} from "../session/model-selection-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { updateWorkspaceTrust } from "../workspace/workspace-trust-controller.js";
import { useAppStore } from "./app-store.js";
import {
  deferred,
  emitMeta,
  emitQueue,
  emitUsage,
  installSession,
  resetStores,
  resourceCatalogResult,
  resyncResult
} from "./app-store-session-control-test-support.js";

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
    expect(useModelSelectionStore.getState()).toMatchObject({
      status: "confirmed",
      target: { provider: "anthropic", id: "claude", label: "anthropic/claude" }
    });
  });

  it("does not call Pi when the requested model is already authoritative", async () => {
    const request = vi.spyOn(agentConnectionController, "request");

    await selectSessionModel("openai", "gpt");

    expect(request).not.toHaveBeenCalled();
    expect(useModelSelectionStore.getState().status).toBe("idle");
  });

  it("deduplicates the same pending model selection and exposes its pending target", async () => {
    const request = deferred<CommandResults["model.select"]>();
    const send = vi.spyOn(agentConnectionController, "request").mockReturnValue(request.promise as never);

    const first = selectSessionModel("anthropic", "claude");
    const second = selectSessionModel("anthropic", "claude");

    expect(second).toBe(first);
    expect(send).toHaveBeenCalledTimes(1);
    expect(useModelSelectionStore.getState()).toMatchObject({
      status: "pending",
      target: { provider: "anthropic", id: "claude", label: "anthropic/claude" }
    });

    request.resolve({
      sessionId: "session-1",
      controls: {
        selectedModel: { provider: "anthropic", id: "claude" },
        thinkingLevel: "high"
      }
    });
    await first;

    expect(useModelSelectionStore.getState().status).toBe("confirmed");
  });

  it("resynchronizes once when a newer control event makes the model response stale", async () => {
    const request = deferred<CommandResults["model.select"]>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(request.promise as never);
    const resync = vi.spyOn(agentConnectionController, "resyncProjection")
      .mockImplementation(async (install) => install(resyncResult({ provider: "anthropic", id: "claude" })));

    const selecting = selectSessionModel("anthropic", "claude");
    await Promise.resolve();
    emitMeta("Newer metadata", { provider: "openai", id: "gpt-newer" }, "off");
    request.resolve({
      sessionId: "session-1",
      controls: {
        selectedModel: { provider: "anthropic", id: "claude" },
        thinkingLevel: "high"
      }
    });
    await selecting;

    expect(resync).toHaveBeenCalledTimes(1);
    expect(useSessionProjectionStore.getState().controls?.selectedModel).toEqual({
      provider: "anthropic",
      id: "claude"
    });
    expect(useModelSelectionStore.getState().status).toBe("confirmed");
  });

  it("drops an old model response without clearing a newer selection", async () => {
    const first = deferred<CommandResults["model.select"]>();
    const second = deferred<CommandResults["model.select"]>();
    vi.spyOn(agentConnectionController, "request")
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never);

    const selectingFirst = selectSessionModel("anthropic", "claude");
    const selectingSecond = selectSessionModel("deepseek", "deepseek-v4-flash");
    second.resolve({
      sessionId: "session-1",
      controls: {
        selectedModel: { provider: "deepseek", id: "deepseek-v4-flash" },
        thinkingLevel: "high"
      }
    });
    await selectingSecond;
    first.resolve({
      sessionId: "session-1",
      controls: {
        selectedModel: { provider: "anthropic", id: "claude" },
        thinkingLevel: "high"
      }
    });
    await selectingFirst;

    expect(useSessionProjectionStore.getState().controls?.selectedModel).toEqual({
      provider: "deepseek",
      id: "deepseek-v4-flash"
    });
    expect(useModelSelectionStore.getState()).toMatchObject({
      status: "confirmed",
      target: { provider: "deepseek", id: "deepseek-v4-flash" }
    });
  });

  it("clears pending model feedback when the Session is replaced", async () => {
    const request = deferred<CommandResults["model.select"]>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(request.promise as never);

    const selecting = selectSessionModel("anthropic", "claude");
    await Promise.resolve();
    installSession("session-2", 4);
    request.resolve({
      sessionId: "session-1",
      controls: {
        selectedModel: { provider: "anthropic", id: "claude" },
        thinkingLevel: "high"
      }
    });
    await selecting;

    expect(useSessionProjectionStore.getState().authority).toMatchObject({
      sessionId: "session-2",
      sessionGeneration: 4
    });
    expect(useModelSelectionStore.getState().status).toBe("idle");
  });

  it("keeps a failed model selection observable without changing the authoritative model", async () => {
    vi.spyOn(agentConnectionController, "request").mockRejectedValue(new Error("fixture model failure") as never);

    await selectSessionModel("anthropic", "claude");

    expect(useSessionProjectionStore.getState().controls?.selectedModel).toEqual({ provider: "openai", id: "gpt" });
    expect(useModelSelectionStore.getState()).toMatchObject({
      status: "failed",
      error: "fixture model failure",
      target: { provider: "anthropic", id: "claude" }
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法切换模型",
      message: "fixture model failure"
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

});
