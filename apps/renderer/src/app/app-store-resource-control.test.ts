import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { reloadSessionResources } from "../session/session-control-controller.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { useSessionTreeStore } from "../session-tree/session-tree-store.js";
import {
  emitQueue,
  emitUsage,
  installSession,
  resetStores
} from "./app-store-session-control-test-support.js";

describe("App Store resource controls", () => {
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
