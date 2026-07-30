import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { runSessionBootstrapTransition } from "../app/session-transition.js";
import { submitRendererPrompt } from "../composer/prompt-submission-controller.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { resynchronizeRendererProjection } from "../connection/projection-recovery-controller.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { activateRendererTask } from "../workbench/task-activation-controller.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import {
  continueRendererSessionFrom,
  editRendererUserMessage,
  restoreRendererMessageEdit,
  sessionForkActionBlockedReason,
  submitRendererEditedMessage
} from "./session-lifecycle-controller.js";
import { useSessionProjectionStore } from "./session-projection-store.js";
import { installSessionProjectionFixture } from "./session-projection-test-support.js";

vi.mock("../app/session-transition.js", () => ({
  runIncrementalSessionTransition: vi.fn().mockResolvedValue(undefined),
  runSessionBootstrapTransition: vi.fn().mockResolvedValue(true)
}));

vi.mock("../workbench/task-activation-controller.js", () => ({
  activateRendererTask: vi.fn().mockResolvedValue(true)
}));

vi.mock("../composer/prompt-submission-controller.js", () => ({
  submitRendererPrompt: vi.fn().mockResolvedValue({
    accepted: true,
    operationId: "operation-edit",
    retainsAttachmentPreviews: false
  })
}));

vi.mock("../connection/projection-recovery-controller.js", () => ({
  resynchronizeRendererProjection: vi.fn().mockResolvedValue("committed")
}));

const runBootstrap = vi.mocked(runSessionBootstrapTransition);
const activateTask = vi.mocked(activateRendererTask);
const submitPrompt = vi.mocked(submitRendererPrompt);
const resynchronizeProjection = vi.mocked(resynchronizeRendererProjection);

describe("session message actions controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    runBootstrap.mockReset().mockResolvedValue(true);
    activateTask.mockReset().mockResolvedValue(true);
    submitPrompt.mockReset().mockResolvedValue({
      accepted: true,
      operationId: "operation-edit",
      retainsAttachmentPreviews: false
    });
    resynchronizeProjection.mockReset().mockResolvedValue("committed");
    rendererWorkbenchStore.getState().reset();
    useTaskDraftStore.getState().dispose();
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    useAppStore.setState(useAppStore.getInitialState(), true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    rendererWorkbenchStore.getState().registerWorkspace(workspace());
    useAppStore.setState({ workspace: "/work/a", trust: "trusted" });
  });

  it("creates a distinct Task from an Assistant entry and preserves the source Task", async () => {
    installActiveSession();
    const sourceTask = rendererWorkbenchStore.getState().tasks["task-active"]!;
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({} as never);
    runBootstrap.mockImplementation(async (_get, _set, options) => {
      await options.request();
      return true;
    });

    await expect(continueRendererSessionFrom("assistant-entry-1")).resolves.toBe(true);

    const forkCall = request.mock.calls.find(([type]) => type === "session.forkFromTask");
    expect(forkCall).toBeDefined();
    expect(forkCall?.[1]).toEqual({
      sourceTaskId: "task-active",
      sourceTaskGeneration: 1,
      sourceSessionId: "session-1",
      sourceSessionGeneration: 3,
      entryId: "assistant-entry-1"
    });
    expect(forkCall?.[3]).toEqual({
      context: expect.objectContaining({
        scope: "task",
        workspaceId: "workspace-a",
        taskId: expect.not.stringMatching(/^task-active$/u),
        taskGeneration: 1
      })
    });
    expect(runBootstrap.mock.calls[0]?.[2]).toMatchObject({
      detail: "正在准备 Pi 会话",
      refreshSessionCatalogFor: "workspace-a"
    });
    const workbench = rendererWorkbenchStore.getState();
    expect(workbench.runtimeTaskOrder).toHaveLength(2);
    expect(workbench.tasks["task-active"]).toEqual(sourceTask);
    expect(workbench.runtimeTaskOrder).toContain("task-active");
    expect(workbench.selectedSurface).toMatchObject({
      kind: "conversation",
      conversation: { kind: "provisional", workspaceId: "workspace-a" }
    });
  });

  it("forks only when an inline edit is sent and submits it without using the Composer", async () => {
    installActiveSession();
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({} as never);
    runBootstrap.mockImplementation(async (_get, _set, options) => {
      await options.request();
      return true;
    });

    await expect(editRendererUserMessage(
      "task-active",
      "user-entry-2",
      "  修改这条历史问题  "
    )).resolves.toEqual({ status: "accepted" });

    expect(runBootstrap.mock.calls[0]?.[2]).toMatchObject({
      preserveCurrentProjectionDuringRequest: true,
      refreshSessionCatalogFor: "workspace-a"
    });
    expect(request).toHaveBeenCalledWith(
      "session.fork",
      { entryId: "user-entry-2", position: "before" },
      [],
      {
        context: {
          scope: "task",
          workspaceId: "workspace-a",
          taskId: "task-active",
          taskGeneration: 1,
          sessionId: "session-1",
          sessionGeneration: 3
        }
      }
    );
    expect(submitPrompt).toHaveBeenCalledWith(
      "修改这条历史问题",
      [],
      "send",
      expect.stringMatching(/^submission-/u)
    );
    expect(rendererWorkbenchStore.getState().runtimeTaskOrder).toEqual(["task-active"]);
  });

  it("retries a prepared inline edit without forking a second time", async () => {
    installActiveSession();
    vi.spyOn(agentConnectionController, "request").mockResolvedValue({} as never);
    runBootstrap.mockImplementation(async (_get, _set, options) => {
      await options.request();
      return true;
    });
    submitPrompt
      .mockResolvedValueOnce({ accepted: false, error: "prompt rejected" })
      .mockResolvedValueOnce({
        accepted: true,
        operationId: "operation-retry",
        retainsAttachmentPreviews: false
      });

    await expect(editRendererUserMessage(
      "task-active",
      "user-entry-2",
      "修改后的问题"
    )).resolves.toEqual({ status: "prepared", error: "prompt rejected" });
    await expect(submitRendererEditedMessage(
      "task-active",
      "修改后的问题"
    )).resolves.toEqual({ status: "accepted" });

    expect(runBootstrap).toHaveBeenCalledOnce();
    expect(submitPrompt).toHaveBeenCalledTimes(2);
  });

  it("restores the source Session when a prepared inline edit is cancelled", async () => {
    installActiveSession();
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({} as never);
    runBootstrap.mockImplementation(async (_get, _set, options) => {
      await options.request();
      return true;
    });

    await expect(restoreRendererMessageEdit(
      "task-active",
      "/sessions/original.jsonl"
    )).resolves.toBe(true);

    expect(runBootstrap.mock.calls[0]?.[2]).toMatchObject({
      preserveCurrentProjectionDuringRequest: true
    });
    expect(request).toHaveBeenCalledWith(
      "session.open",
      { path: "/sessions/original.jsonl", cwdOverride: "/work/a" },
      [],
      {
        context: {
          scope: "task",
          workspaceId: "workspace-a",
          taskId: "task-active",
          taskGeneration: 1,
          sessionId: "session-1",
          sessionGeneration: 3
        }
      }
    );
  });

  it("does not overwrite an existing draft or fork while the current task is active", async () => {
    installActiveSession();
    useTaskDraftStore.getState().setText("task-active", "保留当前草稿");

    await expect(editRendererUserMessage(
      "task-active",
      "user-entry-2",
      "历史问题"
    )).resolves.toEqual({
      status: "failed",
      error: "输入框已有草稿或附件，请先发送或清空后再编辑历史消息。"
    });

    expect(runBootstrap).not.toHaveBeenCalled();
    expect(submitPrompt).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "编辑消息",
      message: "输入框已有草稿或附件，请先发送或清空后再编辑历史消息。"
    });

    useTaskDraftStore.getState().setText("task-active", "");
    useAppStore.setState({
      operation: {
        operationId: "operation-1",
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-1",
        sessionGeneration: 3,
        startedAt: 1
      }
    });
    expect(sessionForkActionBlockedReason()).toBe("当前任务结束或停止后可用");
    await expect(continueRendererSessionFrom("assistant-entry-1")).resolves.toBe(false);
    expect(runBootstrap).not.toHaveBeenCalled();
  });

  it("recovers the authoritative projection and never submits after a failed edit fork", async () => {
    installActiveSession();
    runBootstrap.mockImplementation(async (_get, _set, options) => {
      options.onError(new Error("fork rejected"));
      return false;
    });

    await expect(editRendererUserMessage(
      "task-active",
      "user-entry-2",
      "历史问题"
    )).resolves.toEqual({
      status: "failed",
      error: "无法准备 Pi 会话"
    });

    expect(resynchronizeProjection).toHaveBeenCalledWith(
      useAppStore.getState,
      useAppStore.setState,
      expect.objectContaining({
        hostEpoch: 9,
        failureTitle: "无法恢复 Pi 会话"
      })
    );
    expect(submitPrompt).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法准备 Pi 会话",
      message: "fork rejected 会话状态已重新同步，可继续使用。"
    });
  });

  it("removes a failed continuation target and reactivates the source Task", async () => {
    installActiveSession();
    const request = vi.spyOn(agentConnectionController, "request").mockImplementation((type) => {
      if (type === "session.forkFromTask") return Promise.reject(new Error("source changed"));
      return Promise.resolve({} as never);
    });
    runBootstrap.mockImplementation(async (_get, _set, options) => {
      try {
        await options.request();
        return true;
      } catch (error) {
        options.onError(error);
        return false;
      }
    });

    await expect(continueRendererSessionFrom("assistant-entry-1")).resolves.toBe(false);

    expect(request.mock.calls.some(([type]) => type === "task.close")).toBe(true);
    expect(rendererWorkbenchStore.getState().runtimeTaskOrder).toEqual(["task-active"]);
    expect(rendererWorkbenchStore.getState().tasks["task-active"]).toBeDefined();
    expect(rendererWorkbenchStore.getState().selectedSurface).toEqual({
      kind: "conversation",
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionPath: "/sessions/session-1.jsonl"
      }
    });
    expect(activateTask).toHaveBeenCalledWith("task-active");
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法创建接续任务",
      message: "source changed"
    });
  });
});

function installActiveSession(): void {
  rendererWorkbenchStore.getState().openTask({
    ...task("task-active", "/sessions/session-1.jsonl"),
    sessionId: "session-1",
    sessionGeneration: 3
  });
  useAppStore.setState({
    connected: true,
    hostEpoch: 9,
    workspace: "/work/a",
    trust: "trusted",
    runtime: { phase: "ready", detail: "Pi 会话已就绪", recoverable: true }
  });
  installSessionProjectionFixture(
    { connected: true, hostEpoch: 9 },
    snapshot("session-1"),
    3
  );
}

function snapshot(sessionId: string) {
  return {
    sessionId,
    sessionPath: `/sessions/${sessionId}.jsonl`,
    cwd: "/work/a",
    streaming: false,
    messages: [],
    messagePage: { hasOlder: false, hasNewer: false },
    models: [],
    providers: [],
    thinkingLevel: "off",
    availableThinkingLevels: ["off"],
    steeringQueue: [],
    followUpQueue: [],
    tree: { nodes: [], truncated: false, total: 0 },
    resources: []
  };
}

function workspace() {
  return {
    id: "workspace-a",
    displayName: "A",
    identity: { canonicalPath: "/work/a", assurance: "filesystem" as const },
    trust: "trusted" as const,
    trustProvenance: "native-picker" as const,
    availability: "available" as const
  };
}

function task(id: string, sessionPath: string) {
  return {
    id,
    conversation: { kind: "session" as const, workspaceId: "workspace-a", sessionPath },
    workspaceId: "workspace-a",
    sessionId: `session-${id}`,
    taskGeneration: 1,
    sessionGeneration: 2,
    lifecycle: "idle" as const,
    runtime: { phase: "ready" as const, detail: "Pi 会话已就绪", recoverable: true },
    title: id,
    sessionPath,
    hasDraft: false,
    attachmentCount: 0
  };
}
