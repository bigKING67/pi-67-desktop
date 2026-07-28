import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectionRecoveryDisposition } from "../connection/projection-recovery-controller.js";
import { useAppStore } from "../app/app-store.js";
import { runSessionBootstrapTransition } from "../app/session-transition.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { resynchronizeRendererProjection } from "../connection/projection-recovery-controller.js";
import { rendererWorkbenchStore } from "./workbench-store.js";
import { resumeRendererTask } from "./task-activation-controller.js";

vi.mock("../app/session-transition.js", () => ({
  runSessionBootstrapTransition: vi.fn()
}));

vi.mock("../connection/projection-recovery-controller.js", () => ({
  resynchronizeRendererProjection: vi.fn()
}));

const resynchronize = vi.mocked(resynchronizeRendererProjection);
const bootstrap = vi.mocked(runSessionBootstrapTransition);

describe("task activation controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resynchronize.mockReset();
    bootstrap.mockReset();
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
    expect(bootstrap).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().tasks["task-a"]?.taskGeneration).toBe(3);
  });

  it("initializes the saved Session with the same generation when the Host has no Runtime", async () => {
    resynchronize.mockResolvedValue("runtime-not-ready");
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      accepted: true,
      hostEpoch: 9,
      sessionId: "session-a",
      sessionGeneration: 4,
      eventSequence: 1
    } as never);
    bootstrap.mockImplementation(async (_get, _set, options) => {
      await options.request();
    });

    await expect(resumeRendererTask("task-a")).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith(
      "runtime.initialize",
      {
        cwd: "/work/a",
        sessionPath: "/sessions/a.jsonl",
        trust: "trusted",
        approvalMode: "guided"
      },
      [],
      { context: {
        scope: "task",
        workspaceId: "workspace-a",
        taskId: "task-a",
        taskGeneration: 3
      } }
    );
    expect(rendererWorkbenchStore.getState().tasks["task-a"]?.taskGeneration).toBe(3);
  });

  it.each<ProjectionRecoveryDisposition>(["failed", "stale"])(
    "does not initialize after a %s projection recovery",
    async (disposition) => {
      resynchronize.mockResolvedValue(disposition);
      const request = vi.spyOn(agentConnectionController, "request");

      await expect(resumeRendererTask("task-a")).resolves.toBe(false);

      expect(request).not.toHaveBeenCalled();
      expect(bootstrap).not.toHaveBeenCalled();
      expect(rendererWorkbenchStore.getState().tasks["task-a"]?.taskGeneration).toBe(3);
    }
  );
});
