import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProtocolRequestError } from "@pi67/protocol";
import { useAppStore } from "../app/app-store.js";
import {
  runIncrementalSessionTransition,
  runSessionBootstrapTransition
} from "../app/session-transition.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { activateRendererTask } from "../workbench/task-activation-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { useSessionProjectionStore } from "./session-projection-store.js";
import {
  createRendererSession,
  openRendererSession,
  rollbackRendererSession
} from "./session-lifecycle-controller.js";

vi.mock("../app/session-transition.js", () => ({
  runIncrementalSessionTransition: vi.fn().mockResolvedValue(undefined),
  runSessionBootstrapTransition: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../workbench/task-activation-controller.js", () => ({
  activateRendererTask: vi.fn().mockResolvedValue(true)
}));

const runBootstrap = vi.mocked(runSessionBootstrapTransition);
const runIncremental = vi.mocked(runIncrementalSessionTransition);
const activateTask = vi.mocked(activateRendererTask);

describe("session lifecycle controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    runBootstrap.mockReset().mockResolvedValue(true);
    runIncremental.mockReset().mockResolvedValue(undefined);
    activateTask.mockReset().mockResolvedValue(true);
    rendererWorkbenchStore.getState().reset();
    useTaskDraftStore.getState().dispose();
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    useAppStore.setState(useAppStore.getInitialState(), true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    rendererWorkbenchStore.getState().registerWorkspace(workspace());
    useAppStore.setState({ workspace: "/work/a", trust: "trusted" });
  });

  it("opens a provisional Task before requesting a new Pi Session", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({} as never);

    await createRendererSession();

    expect(runBootstrap).toHaveBeenCalledOnce();
    const options = runBootstrap.mock.calls[0]![2];
    expect(options).toMatchObject({
      detail: "正在创建 Pi 新会话",
      refreshSessionCatalogFor: "workspace-a"
    });
    const [task] = Object.values(rendererWorkbenchStore.getState().tasks);
    expect(task).toMatchObject({
      conversation: { kind: "provisional", workspaceId: "workspace-a" },
      sessionId: expect.stringMatching(/^pending:task-/u),
      lifecycle: "initializing",
      runtime: { phase: "starting", detail: "正在启动 Pi 会话" },
      creationStatus: "pending"
    });

    await options.request();
    expect(request).toHaveBeenCalledWith("session.create", {}, [], {
      onAcknowledgementDelayed: expect.any(Function)
    });
    const delayed = request.mock.calls[0]?.[3]?.onAcknowledgementDelayed;
    delayed?.();
    expect(rendererWorkbenchStore.getState().tasks[task!.id]).toMatchObject({
      creationStatus: "confirming",
      runtime: { phase: "starting", detail: "正在确认对话是否已创建" }
    });
  });

  it("removes an empty provisional Task when creation fails", async () => {
    await createRendererSession();
    const options = runBootstrap.mock.calls[0]![2];

    options.onError(new Error("create failed"));

    expect(rendererWorkbenchStore.getState().tasks).toEqual({});
    expect(useAppStore.getState().runtime).toEqual({
      phase: "failed",
      detail: "无法创建 Pi 会话：create failed",
      recoverable: true
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法创建 Pi 会话",
      message: "create failed"
    });
  });

  it("preserves a non-empty in-memory draft when creation fails", async () => {
    await createRendererSession();
    const options = runBootstrap.mock.calls[0]![2];
    const [task] = Object.values(rendererWorkbenchStore.getState().tasks);
    useTaskDraftStore.getState().setText(task!.id, "保留这个草稿");

    options.onError(new Error("create failed"));

    expect(rendererWorkbenchStore.getState().tasks[task!.id]).toMatchObject({
      lifecycle: "draft",
      runtime: { phase: "failed", detail: "无法创建 Pi 会话", recoverable: true }
    });
    expect(rendererWorkbenchStore.getState().tasks[task!.id]?.creationStatus).toBeUndefined();
    expect(useTaskDraftStore.getState().drafts[task!.id]?.text).toBe("保留这个草稿");
  });

  it("keeps one unconfirmed Task when the create acknowledgement outcome is unknown", async () => {
    await createRendererSession();
    const options = runBootstrap.mock.calls[0]![2];
    const [task] = Object.values(rendererWorkbenchStore.getState().tasks);

    options.onError(new ProtocolRequestError({
      code: "REQUEST_OUTCOME_UNKNOWN",
      message: "not acknowledged",
      recoverable: true
    }));

    expect(rendererWorkbenchStore.getState().tasks[task!.id]).toMatchObject({
      lifecycle: "draft",
      creationStatus: "unconfirmed",
      runtime: {
        phase: "failed",
        detail: "对话创建结果尚未确认，请等待运行服务完成对账。",
        recoverable: true
      }
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "正在确认对话是否已创建"
    });
  });

  it("selects the existing pending creation instead of issuing a second create", async () => {
    await createRendererSession();
    const [task] = Object.values(rendererWorkbenchStore.getState().tasks);

    await createRendererSession();

    expect(runBootstrap).toHaveBeenCalledOnce();
    expect(rendererWorkbenchStore.getState().selectedSurface).toEqual({
      kind: "conversation",
      conversation: task!.conversation
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "正在确认对话是否已创建"
    });
  });

  it("selects an already-open Session Task instead of creating a duplicate", async () => {
    rendererWorkbenchStore.getState().openTask(task("task-existing", "/sessions/existing.jsonl"));

    await openRendererSession("/sessions/existing.jsonl");

    expect(activateTask).toHaveBeenCalledWith("task-existing");
    expect(runBootstrap).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().runtimeTaskOrder).toEqual(["task-existing"]);
  });

  it("opens a catalog Session with the selected Workspace cwd override", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({} as never);

    await openRendererSession("/sessions/catalog.jsonl");

    const options = runBootstrap.mock.calls[0]![2];
    expect(options).toMatchObject({
      detail: "正在恢复 Pi 会话",
      refreshSessionCatalogFor: "workspace-a"
    });
    const [pending] = Object.values(rendererWorkbenchStore.getState().tasks);
    expect(pending).toMatchObject({
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionPath: "/sessions/catalog.jsonl"
      },
      sessionPath: "/sessions/catalog.jsonl"
    });

    await options.request();
    expect(request).toHaveBeenCalledWith("session.open", {
      path: "/sessions/catalog.jsonl",
      cwdOverride: "/work/a"
    });
  });

  it("does not start a second transition without Workspace authority", async () => {
    useAppStore.setState({ sessionTransitionPending: true });
    await createRendererSession();
    await openRendererSession("/sessions/blocked.jsonl");
    expect(runBootstrap).not.toHaveBeenCalled();

    useAppStore.setState({ sessionTransitionPending: false, workspace: undefined });
    rendererWorkbenchStore.getState().reset();
    await createRendererSession();
    await openRendererSession("/sessions/no-workspace.jsonl");
    expect(runBootstrap).not.toHaveBeenCalled();
  });

  it("routes rollback through the incremental transition and reports unknown failures", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({} as never);

    await rollbackRendererSession("entry-7");

    expect(runIncremental).toHaveBeenCalledOnce();
    const options = runIncremental.mock.calls[0]![2];
    expect(options).toMatchObject({
      detail: "正在回退 Pi 会话",
      readyDetail: "Pi 会话已回退",
      refreshChanges: true
    });
    await options.request();
    expect(request).toHaveBeenCalledWith("session.rollback", { entryId: "entry-7" });

    options.onError("non-error failure");
    expect(useAppStore.getState().runtime).toMatchObject({
      phase: "failed",
      detail: "无法回退 Pi 会话：未知错误"
    });
  });
});

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
    toolMode: "auto" as const,
    attachmentCount: 0
  };
}
