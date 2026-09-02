import {
  MAX_RUNNING_TASKS,
  type RuntimeStatus,
  type TaskLifecycle,
  type WorkbenchStateV5,
  type WorkspaceDescriptor
} from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  createRendererWorkbenchStore,
  type RendererWorkbenchTask
} from "./workbench-store.js";

describe("renderer workbench store", () => {
  it("keeps a cross-workspace Runtime registry and selects conversations", () => {
    const store = createRendererWorkbenchStore();
    store.getState().registerWorkspace(workspace("a", "/work/a"));
    store.getState().registerWorkspace(workspace("b", "/work/b"));

    expect(store.getState().openTask(task("task-a", "a", "idle"))).toBe("opened");
    expect(store.getState().openTask(task("task-b", "b", "running"))).toBe("opened");
    expect(store.getState().runtimeTaskOrder).toEqual(["task-a", "task-b"]);
    expect(store.getState().selectTask("task-a")).toBe(true);
    expect(store.getState().selectedSurface).toEqual({
      kind: "conversation",
      conversation: sessionConversation("task-a", "a")
    });
  });

  it("enforces the shared active or interactive-wait runtime limit across all workspaces", () => {
    const store = createRendererWorkbenchStore();
    store.getState().registerWorkspace(workspace("a", "/work/a"));
    store.getState().registerWorkspace(workspace("b", "/work/b"));
    const lifecycles: TaskLifecycle[] = [
      "accepted",
      "running",
      "waiting-approval",
      "waiting-extension-input"
    ];
    Array.from({ length: MAX_RUNNING_TASKS }, (_, index) => lifecycles[index % lifecycles.length]!)
      .forEach((lifecycle, index) => {
        store.getState().openTask(task(`active-${index}`, index % 2 === 0 ? "a" : "b", lifecycle));
      });
    store.getState().openTask(task("idle", "a", "idle"));

    expect(store.getState().canStartTask("idle")).toBe("run-limit");
    store.getState().updateTask("active-0", { lifecycle: "completed" });
    expect(store.getState().canStartTask("idle")).toBe("allowed");
  });

  it("removes a stopped Runtime record without closing its authoritative conversation", () => {
    const store = createRendererWorkbenchStore();
    store.getState().registerWorkspace(workspace("a", "/work/a"));
    store.getState().openTask(task("task-a", "a", "stopped"));

    expect(store.getState().removeRuntimeTask("task-a")).toBe(true);
    expect(store.getState().tasks["task-a"]).toBeUndefined();
    expect(store.getState().runtimeTaskOrder).toEqual([]);
    expect(store.getState().selectedSurface).toEqual({
      kind: "conversation",
      conversation: sessionConversation("task-a", "a")
    });
  });

  it("selects the newest remaining provisional draft in the same Workspace after discarding one", () => {
    const store = createRendererWorkbenchStore();
    store.getState().registerWorkspace(workspace("a", "/work/a"));
    store.getState().openTask(provisionalTask("draft-a", "a"));
    store.getState().openTask(provisionalTask("draft-b", "a"));

    expect(store.getState().removeRuntimeTask("draft-b")).toBe(true);
    expect(store.getState().selectedSurface).toEqual({
      kind: "conversation",
      conversation: {
        kind: "provisional",
        workspaceId: "a",
        draftId: "draft-a"
      }
    });

    expect(store.getState().removeRuntimeTask("draft-a")).toBe(true);
    expect(store.getState().selectedSurface).toEqual({ kind: "workspace", workspaceId: "a" });
  });

  it("uses one Settings surface and follows project scope to the current Workspace", () => {
    const store = createRendererWorkbenchStore();
    store.getState().registerWorkspace(workspace("a", "/work/a"));
    store.getState().registerWorkspace(workspace("b", "/work/b"));
    store.getState().openTask(task("task-a", "a", "idle"));
    store.getState().setSettingsScope("project");
    store.getState().openSettings("extensions");

    expect(store.getState()).toMatchObject({
      selectedSurface: { kind: "settings" },
      settingsReturnSurface: {
        kind: "conversation",
        conversation: sessionConversation("task-a", "a")
      },
      settingsSection: "extensions",
      settingsWorkspaceId: "a"
    });
    store.getState().closeSettings();
    expect(store.getState()).toMatchObject({
      selectedSurface: {
        kind: "conversation",
        conversation: sessionConversation("task-a", "a")
      },
      settingsReturnSurface: undefined
    });
    store.getState().selectWorkspace("b");
    store.getState().openSettings();
    expect(store.getState().settingsWorkspaceId).toBe("b");
  });

  it("keeps Settings selected while a Workspace transition updates its return surface", () => {
    const store = createRendererWorkbenchStore();
    store.getState().registerWorkspace(workspace("a", "/work/a"));
    store.getState().openSettings();

    expect(store.getState().selectWorkspace("a")).toBe(true);
    expect(store.getState().selectedSurface).toEqual({ kind: "settings" });
    expect(store.getState().settingsReturnSurface).toEqual({
      kind: "workspace",
      workspaceId: "a"
    });

    expect(store.getState().openTask(task("task-a", "a", "idle"))).toBe("opened");
    expect(store.getState()).toMatchObject({
      selectedSurface: { kind: "settings" },
      settingsReturnSurface: {
        kind: "conversation",
        conversation: sessionConversation("task-a", "a")
      }
    });

    store.getState().closeSettings();
    expect(store.getState()).toMatchObject({
      selectedSurface: {
        kind: "conversation",
        conversation: sessionConversation("task-a", "a")
      },
      settingsReturnSurface: undefined
    });
  });

  it("blocks Workspace removal for active Runtime state but drops stopped records", () => {
    const store = createRendererWorkbenchStore();
    store.getState().registerWorkspace(workspace("a", "/work/a"));
    store.getState().registerWorkspace(workspace("b", "/work/b"));
    store.getState().openTask(task("task-a", "a", "running"));

    expect(store.getState().unregisterWorkspace("a")).toBe(false);
    store.getState().updateTask("task-a", {
      lifecycle: "stopped",
      runtime: { phase: "stopped", detail: "stopped", recoverable: true }
    });
    expect(store.getState().unregisterWorkspace("a")).toBe(true);
    expect(store.getState().runtimeTaskOrder).toEqual([]);
    expect(store.getState().workspaceOrder).toEqual(["b"]);
  });

  it("atomically transfers a provisional Task and its conversation identity to a created Workspace", () => {
    const store = createRendererWorkbenchStore();
    store.getState().registerWorkspace(workspace("source", "/work/source"));
    store.getState().openTask({
      id: "task-draft",
      conversation: {
        kind: "provisional",
        workspaceId: "source",
        draftId: "task-draft"
      },
      workspaceId: "source",
      sessionId: "pending:task-draft",
      taskGeneration: 1,
      lifecycle: "draft",
      runtime: { phase: "stopped", detail: "draft", recoverable: true },
      title: "Draft",
      hasDraft: true,
      toolMode: "auto",
      attachmentCount: 1,
      environmentIntent: "worktree"
    });

    expect(store.getState().transferProvisionalTaskToWorkspace(
      "task-draft",
      workspace("created", "/work/created")
    )).toBe(true);

    expect(store.getState()).toMatchObject({
      currentWorkspaceId: "created",
      workspaceOrder: ["source", "created"],
      selectedSurface: {
        kind: "conversation",
        conversation: {
          kind: "provisional",
          workspaceId: "created",
          draftId: "task-draft"
        }
      },
      tasks: {
        "task-draft": {
          workspaceId: "created",
          conversation: {
            kind: "provisional",
            workspaceId: "created",
            draftId: "task-draft"
          },
          hasDraft: true,
          attachmentCount: 1,
          environmentIntent: "worktree"
        }
      }
    });
  });

  it("normalizes a previously persisted Settings surface to its recoverable task", () => {
    const store = createRendererWorkbenchStore();
    const conversation = sessionConversation("task-a", "a");
    const persisted: WorkbenchStateV5 = {
      version: 5,
      workspaces: [workspace("a", "/work/a")],
      workspaceOrder: ["a"],
      expandedWorkspaceIds: ["a"],
      currentWorkspaceId: "a",
      selectedSurface: { kind: "settings" },
      runtimeRecovery: [{
        taskId: "task-a",
        conversation,
        sessionId: "session-task-a",
        taskGeneration: 1,
        sessionGeneration: 2,
        hostInstanceId: "host-1",
        hostEpoch: 1,
        lastKnownLifecycle: "running"
      }],
      sessionCreationRecovery: [],
      workspaceEnvironments: [{ workspaceId: "a", kind: "plain", ownership: "user" }],
      environmentMutations: [],
      settings: { section: "runtime", scope: "global" },
      cleanExit: false
    };

    store.getState().hydrate(persisted);

    expect(store.getState()).toMatchObject({
      selectedSurface: { kind: "conversation", conversation },
      settingsReturnSurface: undefined,
      settingsSection: "runtime"
    });
  });
});

function workspace(id: string, path: string): WorkspaceDescriptor {
  return {
    id,
    displayName: id.toUpperCase(),
    identity: { canonicalPath: path, assurance: "filesystem", device: "1", inode: id },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}

function task(id: string, workspaceId: string, lifecycle: TaskLifecycle): RendererWorkbenchTask {
  return {
    id,
    conversation: sessionConversation(id, workspaceId),
    workspaceId,
    sessionId: `session-${id}`,
    taskGeneration: 1,
    lifecycle,
    runtime: runtime(lifecycle),
    title: id,
    sessionPath: `/sessions/${id}.jsonl`,
    hasDraft: false,
    toolMode: "auto",
    attachmentCount: 0
  };
}

function provisionalTask(id: string, workspaceId: string): RendererWorkbenchTask {
  return {
    id,
    conversation: { kind: "provisional", workspaceId, draftId: id },
    workspaceId,
    sessionId: `pending:${id}`,
    taskGeneration: 1,
    lifecycle: "draft",
    runtime: { phase: "stopped", detail: "draft", recoverable: true },
    title: "未命名会话",
    hasDraft: false,
    toolMode: "auto",
    attachmentCount: 0
  };
}

function sessionConversation(id: string, workspaceId: string) {
  return {
    kind: "session" as const,
    workspaceId,
    sessionFileIdentity: `session-file-${id}`,
    sessionPath: `/sessions/${id}.jsonl`
  };
}

function runtime(lifecycle: TaskLifecycle): RuntimeStatus {
  if (lifecycle === "stopped") return { phase: "stopped", detail: lifecycle, recoverable: true };
  return {
    phase: lifecycle === "running" ? "busy" : "ready",
    detail: lifecycle,
    recoverable: true
  };
}
