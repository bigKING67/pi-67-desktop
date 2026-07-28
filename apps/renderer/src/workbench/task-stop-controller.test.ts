import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useTaskDraftStore } from "./task-draft-store.js";
import { rendererWorkbenchStore } from "./workbench-store.js";
import { stopRendererTask } from "./task-stop-controller.js";

describe("task stop controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    rendererWorkbenchStore.getState().reset();
    useTaskDraftStore.getState().dispose();
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
      sessionGeneration: 3,
      taskGeneration: 2,
      lifecycle: "running",
      runtime: { phase: "busy", detail: "running", recoverable: true },
      title: "Task A",
      sessionPath: "/sessions/a.jsonl",
      hasDraft: true,
      attachmentCount: 0
    });
    useTaskDraftStore.getState().setText("task-a", "keep this draft");
  });

  it("stops exact Task authority before removing its Runtime record", async () => {
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue({
      appInstanceId: "app",
      hostInstanceId: "host",
      hostEpoch: 9,
      sdkVersion: "fixture",
      eventSequence: 0
    });
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      closed: true,
      stopped: true
    } as never);

    await expect(stopRendererTask("task-a")).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith(
      "task.close",
      { mode: "stop" },
      [],
      { context: {
        scope: "task",
        workspaceId: "workspace-a",
        taskId: "task-a",
        taskGeneration: 2,
        sessionId: "session-a",
        sessionGeneration: 3
      } }
    );
    expect(rendererWorkbenchStore.getState().tasks["task-a"]).toBeUndefined();
    expect(rendererWorkbenchStore.getState().selectedSurface).toEqual({
      kind: "conversation",
      conversation: {
        kind: "session",
        workspaceId: "workspace-a",
        sessionPath: "/sessions/a.jsonl"
      }
    });
  });

  it("keeps Runtime and draft when Host stop fails", async () => {
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue({
      appInstanceId: "app",
      hostInstanceId: "host",
      hostEpoch: 9,
      sdkVersion: "fixture",
      eventSequence: 0
    });
    vi.spyOn(agentConnectionController, "request").mockRejectedValue(new Error("busy"));

    await expect(stopRendererTask("task-a")).resolves.toBe(false);
    expect(rendererWorkbenchStore.getState().tasks["task-a"]).toBeDefined();
    expect(useTaskDraftStore.getState().drafts["task-a"]?.text).toBe("keep this draft");
  });

  it("fails closed while the Host is disconnected", async () => {
    vi.spyOn(agentConnectionController, "identity", "get").mockReturnValue(undefined);
    const request = vi.spyOn(agentConnectionController, "request");

    await expect(stopRendererTask("task-a")).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().tasks["task-a"]).toBeDefined();
  });
});
