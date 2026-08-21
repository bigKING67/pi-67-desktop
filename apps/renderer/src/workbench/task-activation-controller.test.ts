import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectionRecoveryDisposition } from "../connection/projection-recovery-controller.js";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { resynchronizeRendererProjection } from "../connection/projection-recovery-controller.js";
import {
  conversationNeedsAttention,
  useConversationAttentionStore
} from "../navigation/conversation-attention-store.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import { useTaskDraftStore } from "./task-draft-store.js";
import { rendererWorkbenchStore, selectedWorkbenchTask } from "./workbench-store.js";
import { activateRendererTask, resumeRendererTask } from "./task-activation-controller.js";
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

  it.each<ProjectionRecoveryDisposition>(["failed", "stale"])(
    "returns false when Task activation recovery is %s",
    async (disposition) => {
      markTaskActive();
      useConversationAttentionStore.getState().mark("workspace-a", "session-file-a");
      resynchronize.mockResolvedValue(disposition);

      await expect(activateRendererTask("task-a")).resolves.toBe(false);
      expect(openWorkspace).not.toHaveBeenCalled();
      expect(conversationNeedsAttention(
        useConversationAttentionStore.getState(),
        "workspace-a",
        "session-file-a"
      )).toBe(true);
    }
  );

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

  it("reattaches a surviving same-Host Runtime without incrementing the Task generation", async () => {
    resynchronize.mockResolvedValue("committed");
    const request = vi.spyOn(agentConnectionController, "request");

    await expect(resumeRendererTask("task-a")).resolves.toBe(true);

    expect(registerWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: "workspace-a" }),
      { queryCatalog: false }
    );
    expect(resynchronize).toHaveBeenCalledWith(
      useAppStore.getState,
      useAppStore.setState,
      expect.objectContaining({ hostEpoch: 9, deferRuntimeNotReady: true })
    );
    expect(request).not.toHaveBeenCalled();
    expect(openWorkspace).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().tasks["task-a"]?.taskGeneration).toBe(3);
    expect(rendererWorkbenchStore.getState().tasks["task-a"]?.recoveryHostEpoch).toBeUndefined();
  });

  it("shares one task-scoped flight across concurrent activate and resume requests", async () => {
    const registration = deferred<boolean>();
    registerWorkspace.mockReturnValue(registration.promise);
    resynchronize.mockResolvedValue("committed");

    const activation = activateRendererTask("task-a");
    const resume = resumeRendererTask("task-a");

    expect(resume).toBe(activation);
    await vi.waitFor(() => expect(registerWorkspace).toHaveBeenCalledOnce());
    registration.resolve(true);
    await expect(Promise.all([activation, resume])).resolves.toEqual([true, true]);
    expect(resynchronize).toHaveBeenCalledOnce();
  });

  it("clears a failed task flight so an explicit retry can recover", async () => {
    registerWorkspace.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    resynchronize.mockResolvedValue("committed");

    await expect(resumeRendererTask("task-a")).resolves.toBe(false);
    expect(rendererWorkbenchStore.getState().tasks["task-a"]).toMatchObject({
      lifecycle: "lost",
      runtime: { phase: "failed", detail: "目标工作区当前不可用。" }
    });

    await expect(resumeRendererTask("task-a")).resolves.toBe(true);
    expect(registerWorkspace).toHaveBeenCalledTimes(2);
    expect(resynchronize).toHaveBeenCalledOnce();
  });

  it("skips projection resync after the Agent Host identity changes", async () => {
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue({
      appInstanceId: "app",
      hostInstanceId: "replacement-host",
      hostEpoch: 10,
      sdkVersion: "fixture",
      eventSequence: 0
    });
    openWorkspace.mockResolvedValue(true);

    await expect(resumeRendererTask("task-a")).resolves.toBe(true);

    expect(resynchronize).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalledWith(
      "task.close",
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(openWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: "workspace-a" }),
      "/sessions/a.jsonl",
      "session-file-a"
    );
  });

  it("opens a known Session after Host replacement without consulting Catalog", async () => {
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue({
      appInstanceId: "app",
      hostInstanceId: "replacement-host",
      hostEpoch: 10,
      sdkVersion: "fixture",
      eventSequence: 0
    });
    openWorkspace.mockResolvedValue(true);
    const request = vi.spyOn(agentConnectionController, "request");

    await expect(resumeRendererTask("task-a")).resolves.toBe(true);

    expect(openWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: "workspace-a" }),
      "/sessions/a.jsonl",
      "session-file-a"
    );
    expect(request).not.toHaveBeenCalledWith(
      "session.catalog.query",
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it("rotates stale Task authority before initializing the saved Session", async () => {
    resynchronize.mockResolvedValue("runtime-not-ready");
    openWorkspace.mockImplementation(async () => {
      expect(rendererWorkbenchStore.getState().tasks["task-a"]).toBeUndefined();
      expect(rendererWorkbenchStore.getState().selectedSurface).toEqual({
        kind: "conversation",
        conversation: {
          kind: "session",
          workspaceId: "workspace-a",
          sessionFileIdentity: "session-file-a",
          sessionPath: "/sessions/a.jsonl"
        }
      });
      return true;
    });

    await expect(resumeRendererTask("task-a")).resolves.toBe(true);

    expect(openWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: "workspace-a" }),
      "/sessions/a.jsonl",
      "session-file-a"
    );
  });

  it("keeps the old Task authority when Host retirement fails", async () => {
    resynchronize.mockResolvedValue("runtime-not-ready");
    request.mockRejectedValueOnce(new Error("Host close failed"));

    await expect(resumeRendererTask("task-a")).resolves.toBe(false);

    expect(openWorkspace).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().tasks["task-a"]).toMatchObject({
      id: "task-a",
      lifecycle: "lost",
      runtime: { phase: "failed", detail: "Host close failed", recoverable: true }
    });
  });

  it("does not replace newer Task authority after an old Host retirement finishes", async () => {
    resynchronize.mockResolvedValue("runtime-not-ready");
    const retirement = deferred<{ closed: true; stopped: false }>();
    request.mockReturnValueOnce(retirement.promise as never);

    const recovery = resumeRendererTask("task-a");
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    rendererWorkbenchStore.getState().updateTask("task-a", {
      taskGeneration: 4,
      lifecycle: "idle",
      runtime: { phase: "ready", detail: "Newer Task authority", recoverable: true }
    });
    retirement.resolve({ closed: true, stopped: false });

    await expect(recovery).resolves.toBe(false);
    expect(openWorkspace).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().tasks["task-a"]).toMatchObject({
      taskGeneration: 4,
      lifecycle: "idle",
      runtime: { phase: "ready", detail: "Newer Task authority" }
    });
  });

  it("reports failure when the saved Session cannot be initialized", async () => {
    resynchronize.mockResolvedValue("runtime-not-ready");
    openWorkspace.mockResolvedValue(false);

    await expect(resumeRendererTask("task-a")).resolves.toBe(false);
  });

  it("waits for Workspace registration before resynchronizing a restored Task", async () => {
    const registration = deferred<boolean>();
    registerWorkspace.mockReturnValue(registration.promise);
    resynchronize.mockResolvedValue("committed");

    const recovery = resumeRendererTask("task-a");
    await vi.waitFor(() => expect(registerWorkspace).toHaveBeenCalledOnce());
    expect(resynchronize).not.toHaveBeenCalled();

    registration.resolve(true);
    await expect(recovery).resolves.toBe(true);
    expect(registerWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      resynchronize.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
  });

  it("marks the restored Task lost when Workspace registration fails", async () => {
    registerWorkspace.mockRejectedValue(new Error("Workspace registration failed"));

    await expect(resumeRendererTask("task-a")).resolves.toBe(false);

    expect(resynchronize).not.toHaveBeenCalled();
    expect(openWorkspace).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().tasks["task-a"]).toMatchObject({
      lifecycle: "lost",
      runtime: {
        phase: "failed",
        detail: "Workspace registration failed",
        recoverable: true
      }
    });
  });

  it.each<ProjectionRecoveryDisposition>(["failed", "stale"])(
    "does not initialize after a %s projection recovery",
    async (disposition) => {
      resynchronize.mockResolvedValue(disposition);
      const request = vi.spyOn(agentConnectionController, "request");

      await expect(resumeRendererTask("task-a")).resolves.toBe(false);

      expect(request).not.toHaveBeenCalled();
      expect(openWorkspace).not.toHaveBeenCalled();
      expect(rendererWorkbenchStore.getState().tasks["task-a"]?.taskGeneration).toBe(3);
    }
  );
});

function markTaskActive(): void {
  rendererWorkbenchStore.getState().updateTask("task-a", {
    lifecycle: "idle",
    runtime: { phase: "ready", detail: "Pi SDK 已就绪", recoverable: true },
    sessionGeneration: 4
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
