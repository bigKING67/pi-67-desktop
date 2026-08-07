import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProtocolRequestError } from "@pi67/protocol";
import { useAppStore } from "../app/app-store.js";
import {
  workspaceConnectionIdentity,
  workspaceDescriptorFixture
} from "../app/workspace-open-test-fixtures.js";
import {
  runIncrementalSessionTransition,
  runSessionBootstrapTransition
} from "../app/session-transition.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { activateRendererTask } from "../workbench/task-activation-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { useSessionProjectionStore } from "./session-projection-store.js";
import { ensureRendererSessionCreationAuthority } from "./session-creation-authority.js";
import { dismissUnconfirmedRendererSession } from "./session-creation-recovery-controller.js";
import { sessionLifecycleTask } from "./session-lifecycle-test-fixture.js";
import {
  beginRendererSessionIntent,
  createRendererSession,
  materializeRendererSessionIntent,
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

vi.mock("./session-creation-authority.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session-creation-authority.js")>()),
  ensureRendererSessionCreationAuthority: vi.fn()
}));

const runBootstrap = vi.mocked(runSessionBootstrapTransition);
const runIncremental = vi.mocked(runIncrementalSessionTransition);
const activateTask = vi.mocked(activateRendererTask);
const ensureCreationAuthority = vi.mocked(ensureRendererSessionCreationAuthority);

describe("session lifecycle controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    runBootstrap.mockReset().mockResolvedValue(true);
    runIncremental.mockReset().mockResolvedValue(undefined);
    activateTask.mockReset().mockResolvedValue(true);
    ensureCreationAuthority.mockReset().mockResolvedValue(undefined);
    rendererWorkbenchStore.getState().reset();
    useTaskDraftStore.getState().dispose();
    useSessionProjectionStore.setState(useSessionProjectionStore.getInitialState(), true);
    useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
    useAppStore.setState(useAppStore.getInitialState(), true);
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    rendererWorkbenchStore.getState().registerWorkspace(
      workspaceDescriptorFixture("workspace-a", "/work/a", "filesystem")
    );
    useAppStore.setState({
      workspace: "/work/a",
      trust: "trusted",
      connected: true,
      hostEpoch: 7,
      connectionIdentity: workspaceConnectionIdentity(7)
    });
  });

  it("opens an offline-capable new Session intent without creating Pi state", () => {
    useAppStore.setState({ connected: false, connectionIdentity: undefined, hostEpoch: undefined });

    const taskId = beginRendererSessionIntent();

    expect(taskId).toMatch(/^task-/u);
    expect(ensureCreationAuthority).not.toHaveBeenCalled();
    expect(runBootstrap).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().tasks[taskId!]).toMatchObject({
      conversation: { kind: "provisional", workspaceId: "workspace-a", draftId: taskId },
      lifecycle: "draft",
      runtime: { phase: "stopped", detail: "首条消息尚未发送" }
    });
    expect(rendererWorkbenchStore.getState().tasks[taskId!]?.creationId).toBeUndefined();
    expect(rendererWorkbenchStore.getState().tasks[taskId!]?.creationStatus).toBeUndefined();
  });

  it("materializes the same intent Task exactly once when the first Prompt is submitted", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({} as never);
    const taskId = beginRendererSessionIntent();
    useTaskDraftStore.getState().setText(taskId!, "创建后发送");

    await expect(materializeRendererSessionIntent(taskId!)).resolves.toEqual({ status: "materialized" });

    expect(ensureCreationAuthority).toHaveBeenCalledOnce();
    expect(runBootstrap).toHaveBeenCalledOnce();
    const task = rendererWorkbenchStore.getState().tasks[taskId!];
    expect(task).toMatchObject({
      id: taskId,
      lifecycle: "initializing",
      creationStatus: "pending",
      creationId: expect.stringMatching(/^session-creation-/u)
    });
    await runBootstrap.mock.calls[0]![2].request();
    expect(request).toHaveBeenCalledWith(
      "session.create",
      { creationId: task!.creationId },
      [],
      expect.objectContaining({
        context: expect.objectContaining({ taskId, taskGeneration: 1 })
      })
    );
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
      creationStatus: "pending",
      creationId: expect.stringMatching(/^session-creation-/u)
    });

    await options.request();
    expect(request).toHaveBeenCalledWith("session.create", { creationId: task!.creationId }, [], {
      context: {
        scope: "task",
        workspaceId: "workspace-a",
        taskId: task!.id,
        taskGeneration: task!.taskGeneration
      },
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
    expect(rendererWorkbenchStore.getState().tasks[task!.id]?.creationId).toBeUndefined();
    expect(rendererWorkbenchStore.getState().tasks[task!.id]?.creationStatus).toBeUndefined();
    expect(useTaskDraftStore.getState().drafts[task!.id]?.text).toBe("保留这个草稿");
  });

  it("keeps an unconfirmed Task when acknowledgement arrives without its bootstrap event", async () => {
    vi.spyOn(agentConnectionController, "request").mockRejectedValue(new Error("resolver unavailable"));
    await createRendererSession();
    const options = runBootstrap.mock.calls[0]![2];
    const [task] = Object.values(rendererWorkbenchStore.getState().tasks);

    options.onMissingBootstrap?.();

    expect(rendererWorkbenchStore.getState().tasks[task!.id]).toMatchObject({
      lifecycle: "draft",
      creationId: task!.creationId,
      creationStatus: "unconfirmed",
      runtime: {
        phase: "failed",
        detail: "对话创建结果尚未确认。请重新检查；如仍无法确认，可放弃占位后再次新建。",
        recoverable: true
      }
    });
  });

  it("keeps one unconfirmed Task when the create acknowledgement outcome is unknown", async () => {
    vi.spyOn(agentConnectionController, "request").mockRejectedValue(new Error("resolver unavailable"));
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
        detail: "对话创建结果尚未确认。请重新检查；如仍无法确认，可放弃占位后再次新建。",
        recoverable: true
      }
    });
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "warning",
      title: "正在确认对话是否已创建"
    });
  });

  it.each(["connection-lost", "host-replaced", "superseded"] as const)(
    "automatically rechecks an unconfirmed create after a %s transition",
    async (reason) => {
      const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({
        status: "missing",
        creationId: "ignored-by-test"
      } as never);
      await createRendererSession();
      const options = runBootstrap.mock.calls[0]![2];
      const [task] = Object.values(rendererWorkbenchStore.getState().tasks);

      options.onStale?.(reason);

      await vi.waitFor(() => expect(request).toHaveBeenCalledWith(
        "session.creation.resolve",
        { creationId: task!.creationId },
        [],
        { context: { scope: "workspace", workspaceId: "workspace-a" } }
      ));
      expect(rendererWorkbenchStore.getState().tasks[task!.id]?.creationStatus).toBe("unconfirmed");
    }
  );

  it("assigns creation identity independently of Catalog readiness", async () => {
    await createRendererSession();

    const [task] = Object.values(rendererWorkbenchStore.getState().tasks);
    expect(task?.creationId).toMatch(/^session-creation-/u);
    expect(task?.creationStatus).toBe("pending");
  });

  it("allows a fresh create after the unconfirmed placeholder is dismissed", async () => {
    await createRendererSession();
    const firstOptions = runBootstrap.mock.calls[0]![2];
    const [unconfirmed] = Object.values(rendererWorkbenchStore.getState().tasks);
    firstOptions.onError(new ProtocolRequestError({
      code: "REQUEST_OUTCOME_UNKNOWN",
      message: "not acknowledged",
      recoverable: true
    }));
    expect(dismissUnconfirmedRendererSession(unconfirmed!.id)).toBe(true);
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({} as never);

    await createRendererSession();
    expect(runBootstrap).toHaveBeenCalledTimes(2);
    await runBootstrap.mock.calls[1]![2].request();

    expect(request).toHaveBeenCalledOnce();
    const [secondTask] = Object.values(rendererWorkbenchStore.getState().tasks);
    expect(request).toHaveBeenCalledWith("session.create", { creationId: secondTask!.creationId }, [], {
      context: expect.objectContaining({
        scope: "task",
        workspaceId: "workspace-a",
        taskId: secondTask!.id
      }),
      onAcknowledgementDelayed: expect.any(Function)
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

  it("waits for matching Renderer connection authority before opening a provisional Task", async () => {
    useAppStore.setState({ connected: false, hostEpoch: undefined, connectionIdentity: undefined });

    let releaseAuthority!: () => void;
    ensureCreationAuthority.mockReturnValueOnce(new Promise<void>((resolve) => {
      releaseAuthority = resolve;
    }));
    const creation = createRendererSession();
    await vi.waitFor(() => expect(ensureCreationAuthority).toHaveBeenCalledOnce());
    expect(runBootstrap).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().tasks).toEqual({});

    releaseAuthority();
    await creation;

    expect(runBootstrap).toHaveBeenCalledOnce();
    expect(Object.values(rendererWorkbenchStore.getState().tasks)).toHaveLength(1);
  });

  it("coalesces repeated creation attempts while Renderer connection authority is pending", async () => {
    useAppStore.setState({ connected: false, hostEpoch: undefined, connectionIdentity: undefined });

    let releaseAuthority!: () => void;
    const authority = new Promise<void>((resolve) => {
      releaseAuthority = resolve;
    });
    ensureCreationAuthority.mockReturnValue(authority);
    const first = createRendererSession();
    const second = createRendererSession();
    await vi.waitFor(() => expect(ensureCreationAuthority).toHaveBeenCalledTimes(2));
    releaseAuthority();
    await Promise.all([first, second]);

    expect(runBootstrap).toHaveBeenCalledOnce();
    expect(Object.values(rendererWorkbenchStore.getState().tasks)).toHaveLength(1);
  });

  it("does not leave a provisional Task when Renderer connection establishment fails", async () => {
    useAppStore.setState({ connected: false, hostEpoch: undefined, connectionIdentity: undefined });
    ensureCreationAuthority.mockRejectedValueOnce(new Error("connection failed"));

    await createRendererSession();

    expect(runBootstrap).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().tasks).toEqual({});
    expect(useNotificationStore.getState().items.at(-1)).toMatchObject({
      level: "error",
      title: "无法创建 Pi 会话",
      message: "connection failed"
    });
  });

  it("does not create while the initial Workspace Catalog is still settling", async () => {
    useAppStore.setState({ workspaceOpenPending: true });

    await createRendererSession();

    expect(ensureCreationAuthority).not.toHaveBeenCalled();
    expect(runBootstrap).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().tasks).toEqual({});
  });

  it("selects an already-open Session Task instead of creating a duplicate", async () => {
    rendererWorkbenchStore.getState().openTask(
      sessionLifecycleTask("task-existing", "/sessions/existing.jsonl")
    );

    await openRendererSession("/sessions/existing.jsonl", "session-file-task-existing");

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
        kind: "provisional",
        workspaceId: "workspace-a",
        draftId: expect.any(String)
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
