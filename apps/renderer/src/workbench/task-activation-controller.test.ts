import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectionRecoveryDisposition } from "../connection/projection-recovery-controller.js";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { resynchronizeRendererProjection } from "../connection/projection-recovery-controller.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import { rendererWorkbenchStore } from "./workbench-store.js";
import { resumeRendererTask } from "./task-activation-controller.js";

vi.mock("../workspace/workspace-open-controller.js", () => ({
  openRendererWorkspaceDescriptor: vi.fn()
}));

vi.mock("../connection/projection-recovery-controller.js", () => ({
  resynchronizeRendererProjection: vi.fn()
}));

const resynchronize = vi.mocked(resynchronizeRendererProjection);
const openWorkspace = vi.mocked(openRendererWorkspaceDescriptor);

describe("task activation controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resynchronize.mockReset();
    openWorkspace.mockReset();
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
      attachmentCount: 0
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

    expect(resynchronize).toHaveBeenCalledWith(
      useAppStore.getState,
      useAppStore.setState,
      expect.objectContaining({ hostEpoch: 9, deferRuntimeNotReady: true })
    );
    expect(request).not.toHaveBeenCalled();
    expect(openWorkspace).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().tasks["task-a"]?.taskGeneration).toBe(3);
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
