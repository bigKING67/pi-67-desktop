import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { resynchronizeRendererProjection } from "../connection/projection-recovery-controller.js";
import {
  conversationNeedsAttention,
  useConversationAttentionStore
} from "../navigation/conversation-attention-store.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import { useTaskDraftStore } from "./task-draft-store.js";
import { rendererWorkbenchStore, selectedWorkbenchTask } from "./workbench-store.js";
import { activateRendererTask } from "./task-activation-controller.js";
import { registerRendererWorkspaceWithHost } from "./workspace-host-registration-controller.js";

vi.mock("../workspace/workspace-open-controller.js", () => ({
  openRendererWorkspaceDescriptor: vi.fn()
}));

vi.mock("../connection/projection-recovery-controller.js", () => ({
  resynchronizeRendererProjection: vi.fn()
}));

vi.mock("./workspace-host-registration-controller.js", () => ({
  registerRendererWorkspaceWithHost: vi.fn()
}));

const resynchronize = vi.mocked(resynchronizeRendererProjection);
const openWorkspace = vi.mocked(openRendererWorkspaceDescriptor);
const registerWorkspace = vi.mocked(registerRendererWorkspaceWithHost);
const request = vi.fn<typeof agentConnectionController.request>();

describe("task activation controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resynchronize.mockReset();
    openWorkspace.mockReset();
    registerWorkspace.mockReset();
    request.mockReset();
    registerWorkspace.mockResolvedValue(true);
    rendererWorkbenchStore.getState().reset();
    useConversationAttentionStore.getState().reset();
    useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
    useTaskDraftStore.getState().dispose();
    useAppStore.setState(useAppStore.getInitialState(), true);
    rendererWorkbenchStore.getState().registerWorkspace({
      id: "workspace-a",
      displayName: "A",
      identity: { canonicalPath: "/work/a", assurance: "filesystem" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
    rendererWorkbenchStore.getState().openTask({
      id: "task-a",
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionFileIdentity: "session-file-a",
        sessionPath: "/sessions/a.jsonl"
      },
      workspaceId: "workspace-a",
      sessionId: "session-a",
      taskGeneration: 3,
      lifecycle: "stopped",
      runtime: { phase: "stopped", detail: "会话尚未运行", recoverable: true },
      title: "Task A",
      sessionPath: "/sessions/a.jsonl",
      hasDraft: false,
      toolMode: "auto",
      attachmentCount: 0,
      recoveryHostInstanceId: "host",
      recoveryHostEpoch: 9
    });
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue({
      appInstanceId: "app",
      hostInstanceId: "host",
      hostEpoch: 9,
      sdkVersion: "fixture",
      eventSequence: 0
    });
    request.mockImplementation(async (type) => {
      if (type === "task.close") return { closed: true, stopped: false } as never;
      throw new Error(`Unexpected request: ${type}`);
    });
    vi.spyOn(agentConnectionController, "request").mockImplementation(request);
  });

  it("resynchronizes the exact selected Task and only reports committed activation as success", async () => {
    markTaskActive();
    useConversationAttentionStore.getState().mark("workspace-a", "session-file-a");
    resynchronize.mockResolvedValue("committed");

    await expect(activateRendererTask("task-a")).resolves.toBe(true);

    expect(registerWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: "workspace-a" }),
      { queryCatalog: false }
    );
    expect(resynchronize).toHaveBeenCalledWith(
      useAppStore.getState,
      useAppStore.setState,
      expect.objectContaining({
        hostEpoch: 9,
        deferRuntimeNotReady: true,
        context: {
          scope: "task",
          workspaceId: "workspace-a",
          taskId: "task-a",
          taskGeneration: 3,
          sessionId: "session-a",
          sessionFileIdentity: "session-file-a",
          sessionGeneration: 4
        }
      })
    );
    expect(conversationNeedsAttention(
      useConversationAttentionStore.getState(),
      "workspace-a",
      "session-file-a"
    )).toBe(false);
  });

  it("treats a live projected Session generation as current Host ownership", async () => {
    rendererWorkbenchStore.getState().updateTask("task-a", {
      lifecycle: "idle",
      runtime: { phase: "ready", detail: "Pi SDK 已就绪", recoverable: true },
      sessionGeneration: 4,
      recoveryHostInstanceId: undefined,
      recoveryHostEpoch: undefined
    });
    resynchronize.mockResolvedValue("committed");

    await expect(activateRendererTask("task-a")).resolves.toBe(true);

    expect(resynchronize).toHaveBeenCalledOnce();
    expect(openWorkspace).not.toHaveBeenCalled();
  });

  it("uses the authoritative Catalog title in conversation transition feedback", async () => {
    rendererWorkbenchStore.getState().updateTask("task-a", {
      title: "未命名会话",
      titleSource: "fallback",
      recentUserMessagePreview: "今天杭州天气如何"
    });
    installCatalogTitle("杭州实时天气查询", "generated");
    markTaskActive();
    resynchronize.mockResolvedValue("committed");

    await expect(activateRendererTask("task-a")).resolves.toBe(true);

    expect(useAppStore.getState().runtime.detail).toBe("正在切换至「杭州实时天气查询」");
    expect(resynchronize).toHaveBeenCalledWith(
      useAppStore.getState,
      useAppStore.setState,
      expect.objectContaining({
        recoveringDetail: "正在切换至「杭州实时天气查询」",
        readyDetail: "已切换至「杭州实时天气查询」"
      })
    );
  });

  it("never exposes an internal unnamed placeholder in conversation transition feedback", async () => {
    rendererWorkbenchStore.getState().updateTask("task-a", {
      title: "未命名会话",
      titleSource: "fallback"
    });
    markTaskActive();
    resynchronize.mockResolvedValue("committed");

    await expect(activateRendererTask("task-a")).resolves.toBe(true);

    expect(useAppStore.getState().runtime.detail).toBe("正在切换对话");
    expect(resynchronize).toHaveBeenCalledWith(
      useAppStore.getState,
      useAppStore.setState,
      expect.objectContaining({
        recoveringDetail: "正在切换对话",
        readyDetail: "已切换到对话"
      })
    );
  });

  it("settles the selected Task when activation recovery fails", async () => {
    markTaskActive();
    useConversationAttentionStore.getState().mark("workspace-a", "session-file-a");
    resynchronize.mockImplementation(async () => {
      useAppStore.setState({
        sessionTransitionPending: false,
        runtime: { phase: "failed", detail: "Current recovery failed", recoverable: true }
      });
      return "failed";
    });

    await expect(activateRendererTask("task-a")).resolves.toBe(false);
    expect(openWorkspace).not.toHaveBeenCalled();
    expect(conversationNeedsAttention(
      useConversationAttentionStore.getState(),
      "workspace-a",
      "session-file-a"
    )).toBe(true);
    expect(rendererWorkbenchStore.getState().tasks["task-a"]).toMatchObject({
      lifecycle: "lost",
      runtime: { phase: "failed", detail: "Current recovery failed" }
    });
    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: false,
      runtime: { phase: "failed", detail: "Current recovery failed" }
    });
  });

  it("preserves a newer transition when activation recovery is stale", async () => {
    markTaskActive();
    resynchronize.mockImplementation(async () => {
      useAppStore.setState({
        sessionTransitionPending: true,
        runtime: { phase: "recovering", detail: "Newer recovery", recoverable: true }
      });
      return "stale";
    });

    await expect(activateRendererTask("task-a")).resolves.toBe(false);

    expect(rendererWorkbenchStore.getState().tasks["task-a"]).toMatchObject({
      lifecycle: "idle",
      runtime: { phase: "ready" }
    });
    expect(useAppStore.getState()).toMatchObject({
      sessionTransitionPending: true,
      runtime: { phase: "recovering", detail: "Newer recovery" }
    });
  });

  it("reopens a cold formal Session once and transfers its draft to the replacement Task", async () => {
    markTaskActive();
    useTaskDraftStore.getState().setText("task-a", "保留这个草稿");
    rendererWorkbenchStore.getState().updateTask("task-a", { hasDraft: true });
    resynchronize.mockResolvedValue("runtime-not-ready");
    openWorkspace.mockImplementation(async () => {
      const replacement = selectedWorkbenchTask(rendererWorkbenchStore.getState());
      expect(replacement?.id).not.toBe("task-a");
      expect(replacement).toMatchObject({
        conversation: {
          kind: "session",
          workspaceId: "workspace-a",
          sessionFileIdentity: "session-file-a",
          sessionPath: "/sessions/a.jsonl"
        },
        sessionId: expect.stringMatching(/^pending:/u),
        lifecycle: "initializing",
        hasDraft: true
      });
      expect(replacement && useTaskDraftStore.getState().drafts[replacement.id]?.text)
        .toBe("保留这个草稿");
      return true;
    });

    await expect(activateRendererTask("task-a")).resolves.toBe(true);

    expect(rendererWorkbenchStore.getState().tasks["task-a"]).toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      "task.close",
      { mode: "dispose" },
      [],
      { context: expect.objectContaining({ taskId: "task-a", taskGeneration: 3 }) }
    );
    expect(request.mock.invocationCallOrder[0]).toBeLessThan(
      openWorkspace.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
    expect(openWorkspace).toHaveBeenCalledOnce();
    expect(openWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: "workspace-a" }),
      "/sessions/a.jsonl",
      "session-file-a"
    );
  });

  it("reopens a draft-restored Session without resyncing a synthetic pending Task", async () => {
    const current = rendererWorkbenchStore.getState().tasks["task-a"]!;
    const {
      sessionGeneration: _sessionGeneration,
      recoveryHostInstanceId: _recoveryHostInstanceId,
      recoveryHostEpoch: _recoveryHostEpoch,
      ...draftRestoredTask
    } = current;
    rendererWorkbenchStore.setState((state) => ({
      tasks: {
        ...state.tasks,
        "task-a": {
          ...draftRestoredTask,
          sessionId: "pending:draft-task-a",
          hasDraft: true
        }
      }
    }));
    useTaskDraftStore.getState().setText("task-a", "重启后仍需保留的输入");
    openWorkspace.mockResolvedValue(true);

    await expect(activateRendererTask("task-a")).resolves.toBe(true);

    expect(resynchronize).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalledWith(
      "task.close",
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(openWorkspace).toHaveBeenCalledOnce();
    expect(openWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: "workspace-a" }),
      "/sessions/a.jsonl",
      "session-file-a"
    );
    const replacement = selectedWorkbenchTask(rendererWorkbenchStore.getState());
    expect(replacement).toMatchObject({
      id: expect.not.stringMatching(/^task-a$/u),
      sessionId: expect.stringMatching(/^pending:/u),
      lifecycle: "initializing",
      hasDraft: true
    });
    expect(replacement && useTaskDraftStore.getState().drafts[replacement.id]?.text)
      .toBe("重启后仍需保留的输入");
  });

  it("abandons a late activation before resync when a newer Task is selected", async () => {
    markTaskActive();
    rendererWorkbenchStore.getState().openTask({
      ...rendererWorkbenchStore.getState().tasks["task-a"]!,
      id: "task-b",
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionFileIdentity: "session-file-b",
        sessionPath: "/sessions/b.jsonl"
      },
      sessionId: "session-b",
      sessionFileIdentity: "session-file-b",
      sessionPath: "/sessions/b.jsonl",
      title: "Task B"
    });
    rendererWorkbenchStore.getState().selectTask("task-a");
    const registration = deferred<boolean>();
    registerWorkspace.mockReturnValue(registration.promise);

    const activation = activateRendererTask("task-a");
    await vi.waitFor(() => expect(registerWorkspace).toHaveBeenCalledOnce());
    rendererWorkbenchStore.getState().selectTask("task-b");
    registration.resolve(true);

    await expect(activation).resolves.toBe(false);
    expect(resynchronize).not.toHaveBeenCalled();
    expect(selectedWorkbenchTask(rendererWorkbenchStore.getState())?.id).toBe("task-b");
  });

});

function markTaskActive(): void {
  rendererWorkbenchStore.getState().updateTask("task-a", {
    lifecycle: "idle",
    runtime: { phase: "ready", detail: "Pi SDK 已就绪", recoverable: true },
    sessionGeneration: 4
  });
}

function installCatalogTitle(name: string, nameSource: "generated" | "seed"): void {
  const store = useSessionCatalogStore.getState();
  const target = store.beginFirstPage("workspace-a");
  store.finishFirstPage(target, {
    items: [{
      fileIdentity: "session-file-a",
      id: "session-a",
      path: "/sessions/a.jsonl",
      cwd: "/work/a",
      name,
      nameSource,
      modifiedAt: 1,
      messageCount: 2
    }],
    total: 1,
    hasMore: false,
    revision: 1,
    itemCount: 1,
    source: "sqlite",
    state: "ready",
    rebuilding: false,
    incomplete: false,
    skippedCount: 0
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
