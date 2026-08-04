import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectionRecoveryDisposition } from "../connection/projection-recovery-controller.js";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { resynchronizeRendererProjection } from "../connection/projection-recovery-controller.js";
import { findSessionForRecovery } from "../navigation/session-catalog-controller.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import { rendererWorkbenchStore } from "./workbench-store.js";
import { resumeRendererTask } from "./task-activation-controller.js";
import { registerRendererWorkspaceWithHost } from "./workspace-host-registration-controller.js";

vi.mock("../workspace/workspace-open-controller.js", () => ({
  openRendererWorkspaceDescriptor: vi.fn()
}));

vi.mock("../connection/projection-recovery-controller.js", () => ({
  resynchronizeRendererProjection: vi.fn()
}));

vi.mock("../navigation/session-catalog-controller.js", () => ({
  findSessionForRecovery: vi.fn()
}));

vi.mock("./workspace-host-registration-controller.js", () => ({
  registerRendererWorkspaceWithHost: vi.fn()
}));

const resynchronize = vi.mocked(resynchronizeRendererProjection);
const findSession = vi.mocked(findSessionForRecovery);
const openWorkspace = vi.mocked(openRendererWorkspaceDescriptor);
const registerWorkspace = vi.mocked(registerRendererWorkspaceWithHost);

describe("task activation controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resynchronize.mockReset();
    findSession.mockReset();
    openWorkspace.mockReset();
    registerWorkspace.mockReset();
    registerWorkspace.mockResolvedValue(true);
    findSession.mockResolvedValue({
      status: "found",
      session: {
        id: "session-a",
        path: "/sessions/a.jsonl",
        cwd: "/work/a",
        name: "Task A",
        nameSource: "explicit",
        modifiedAt: 1,
        messageCount: 1
      }
    });
    rendererWorkbenchStore.getState().reset();
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
  });

  it("reattaches a surviving same-Host Runtime without incrementing the Task generation", async () => {
    resynchronize.mockResolvedValue("committed");
    const request = vi.spyOn(agentConnectionController, "request");

    await expect(resumeRendererTask("task-a")).resolves.toBe(true);

    expect(registerWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: "workspace-a" }),
      { queryCatalog: false }
    );
    expect(findSession).toHaveBeenCalledWith("workspace-a", "session-a", "/sessions/a.jsonl");
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
    expect(openWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: "workspace-a" }),
      "/sessions/a.jsonl"
    );
  });

  it("removes stale recovery state only after an authoritative Catalog miss", async () => {
    findSession.mockResolvedValue({ status: "missing" });

    await expect(resumeRendererTask("task-a")).resolves.toBe(false);

    expect(resynchronize).not.toHaveBeenCalled();
    expect(openWorkspace).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().tasks["task-a"]).toBeUndefined();
    expect(rendererWorkbenchStore.getState().selectedSurface).toEqual({
      kind: "workspace",
      workspaceId: "workspace-a"
    });
    expect(useAppStore.getState().runtime.detail).toBe("对话记录已不存在");
  });

  it("preserves recovery state while the Catalog is unavailable", async () => {
    findSession.mockResolvedValue({
      status: "unavailable",
      detail: "对话目录仍在重建，请稍后重试。"
    });

    await expect(resumeRendererTask("task-a")).resolves.toBe(false);

    expect(resynchronize).not.toHaveBeenCalled();
    expect(openWorkspace).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().tasks["task-a"]).toMatchObject({
      lifecycle: "lost",
      runtime: { detail: "对话目录仍在重建，请稍后重试。" }
    });
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
          sessionPath: "/sessions/a.jsonl"
        }
      });
      return true;
    });

    await expect(resumeRendererTask("task-a")).resolves.toBe(true);

    expect(openWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ id: "workspace-a" }),
      "/sessions/a.jsonl"
    );
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
