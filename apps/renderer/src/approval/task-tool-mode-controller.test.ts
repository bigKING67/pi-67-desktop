import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useNotificationStore } from "../notifications/notification-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { setTaskToolMode } from "./task-tool-mode-controller.js";

describe("task Tool mode controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    rendererWorkbenchStore.getState().reset();
    useNotificationStore.setState(useNotificationStore.getInitialState(), true);
    const workbench = rendererWorkbenchStore.getState();
    workbench.registerWorkspace({
      id: "workspace-a",
      displayName: "A",
      identity: { canonicalPath: "/work/a", assurance: "filesystem" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
    workbench.openTask(task("task-a", "auto"));
    workbench.openTask(task("task-b", "ask"));
  });

  it("updates only the addressed Task after the authoritative Host acknowledgement", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue({
      mode: "yolo"
    } as never);

    await expect(setTaskToolMode("task-a", "yolo")).resolves.toBe(true);

    expect(request).toHaveBeenCalledWith(
      "task.toolMode.set",
      { mode: "yolo" },
      [],
      { context: {
        scope: "task",
        workspaceId: "workspace-a",
        taskId: "task-a",
        taskGeneration: 1,
        sessionId: "session-task-a",
        sessionGeneration: 3
      } }
    );
    expect(rendererWorkbenchStore.getState().tasks["task-a"]?.toolMode).toBe("yolo");
    expect(rendererWorkbenchStore.getState().tasks["task-b"]?.toolMode).toBe("ask");
  });

  it("drops a delayed acknowledgement after Task authority changes", async () => {
    const response = deferred<{ mode: "ask" }>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(response.promise as never);

    const pending = setTaskToolMode("task-a", "ask");
    rendererWorkbenchStore.getState().updateTask("task-a", {
      taskGeneration: 2,
      sessionGeneration: 4
    });
    response.resolve({ mode: "ask" });

    await expect(pending).resolves.toBe(false);
    expect(rendererWorkbenchStore.getState().tasks["task-a"]?.toolMode).toBe("auto");
  });

  it("deduplicates the same in-flight mode change and rejects a competing mode", async () => {
    const response = deferred<{ mode: "yolo" }>();
    const request = vi.spyOn(agentConnectionController, "request").mockReturnValue(response.promise as never);

    const first = setTaskToolMode("task-a", "yolo");
    const duplicate = setTaskToolMode("task-a", "yolo");
    await expect(setTaskToolMode("task-a", "ask")).resolves.toBe(false);
    response.resolve({ mode: "yolo" });

    await expect(Promise.all([first, duplicate])).resolves.toEqual([true, true]);
    expect(request).toHaveBeenCalledOnce();
  });
});

function task(id: string, toolMode: "ask" | "auto" | "yolo") {
  return {
    id,
    conversation: {
      kind: "session" as const,
      workspaceId: "workspace-a",
      sessionPath: `/sessions/${id}.jsonl`
    },
    workspaceId: "workspace-a",
    sessionId: `session-${id}`,
    sessionGeneration: 3,
    taskGeneration: 1,
    lifecycle: "idle" as const,
    runtime: { phase: "ready" as const, detail: "ready", recoverable: true },
    title: id,
    hasDraft: false,
    toolMode,
    attachmentCount: 0
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
