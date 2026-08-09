import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { reloadSessionResources } from "../session/session-control-controller.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { useSessionTreeStore } from "../session-tree/session-tree-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import {
  emitQueue,
  emitUsage,
  installSession,
  resetStores
} from "./app-store-session-control-test-support.js";
import { useAppStore } from "./app-store.js";

describe("App Store resource controls", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetStores();
    installSession("session-1", 3);
    openSessionTask("session-1", 3);
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

  it("keeps the runtime stable and explains when no Session is available to reload", async () => {
    useSessionProjectionStore.getState().reset();
    const runtime = useAppStore.getState().runtime;
    const request = vi.spyOn(agentConnectionController, "request");

    await reloadSessionResources();

    expect(request).not.toHaveBeenCalled();
    expect(useAppStore.getState().runtime).toEqual(runtime);
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "info",
      title: "暂时无法重新加载 Pi 资源",
      message: "当前 Pi 会话尚未就绪。"
    });
  });

  it("does not reload the previous Session while a provisional task is selected", async () => {
    openProvisionalTask();
    const request = vi.spyOn(agentConnectionController, "request");

    await reloadSessionResources();

    expect(request).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "info",
      title: "暂时无法重新加载 Pi 资源",
      message: "当前 Pi 会话尚未就绪。"
    });
  });
});

function openSessionTask(sessionId: string, sessionGeneration: number): void {
  const workbench = rendererWorkbenchStore.getState();
  workbench.reset();
  workbench.registerWorkspace({
    id: "workspace-1",
    displayName: "Workspace",
    identity: { canonicalPath: "/workspace", assurance: "filesystem" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  });
  workbench.openTask({
    id: `task-${sessionId}`,
    conversation: {
      kind: "session",
      workspaceId: "workspace-1",
      sessionFileIdentity: `session-file-${sessionId}`,
      sessionPath: `/sessions/${sessionId}.jsonl`
    },
    workspaceId: "workspace-1",
    sessionId,
    taskGeneration: 1,
    sessionGeneration,
    sessionFileIdentity: `session-file-${sessionId}`,
    sessionPath: `/sessions/${sessionId}.jsonl`,
    lifecycle: "idle",
    runtime: { phase: "ready", detail: "Ready", recoverable: true },
    title: sessionId,
    hasDraft: false,
    attachmentCount: 0,
    toolMode: "auto"
  });
}

function openProvisionalTask(): void {
  rendererWorkbenchStore.getState().openTask({
    id: "task-provisional",
    conversation: {
      kind: "provisional",
      workspaceId: "workspace-1",
      draftId: "task-provisional"
    },
    workspaceId: "workspace-1",
    sessionId: "pending:task-provisional",
    taskGeneration: 1,
    lifecycle: "draft",
    runtime: { phase: "stopped", detail: "首条消息尚未发送", recoverable: true },
    title: "新会话",
    hasDraft: false,
    attachmentCount: 0,
    toolMode: "auto"
  });
}
