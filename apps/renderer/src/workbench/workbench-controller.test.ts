import { MAX_RUNNING_TASKS, type WorkspaceDescriptor } from "@pi67/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { createRendererWorkbenchStore } from "./workbench-store.js";
import {
  bindPersistedRendererWorkbenchAuthority,
  workbenchLayout
} from "./workbench-controller.js";

describe("renderer workbench persistence boundary", () => {
  beforeEach(() => {
    useAppStore.setState({
      workspace: undefined,
      trust: "unknown",
      trustUpdating: false,
      sessionTransitionPending: false,
      runtime: { phase: "idle", detail: "等待选择工作区", recoverable: true }
    });
  });

  it("serializes metadata without drafts, attachments, runtime details, or credentials", () => {
    const store = createRendererWorkbenchStore();
    store.getState().registerWorkspace(workspace());
    store.getState().openTask({
      id: "task-1",
      conversation: { kind: "session", workspaceId: "workspace-1", sessionPath: "/sessions/one.jsonl" },
      workspaceId: "workspace-1",
      sessionId: "session-1",
      sessionPath: "/sessions/one.jsonl",
      taskGeneration: 7,
      lifecycle: "running",
      runtime: { phase: "busy", detail: "private runtime detail", recoverable: true },
      title: "Private title",
      recentUserMessagePreview: "Private latest user prompt",
      hasDraft: true,
      toolMode: "yolo",
      attachmentCount: 2
    });

    const serialized = JSON.stringify(workbenchLayout(store.getState()));

    expect(serialized).toContain("session-1");
    expect(serialized).not.toContain("Private title");
    expect(serialized).not.toContain("Private latest user prompt");
    expect(serialized).not.toContain("private runtime detail");
    expect(serialized).not.toContain("hasDraft");
    expect(serialized).not.toContain("attachmentCount");
    expect(serialized).not.toContain("yolo");
  });

  it("persists recovery metadata for every admitted top-level Session Task", () => {
    const store = createRendererWorkbenchStore();
    store.getState().registerWorkspace(workspace());
    for (let index = 0; index < MAX_RUNNING_TASKS; index += 1) {
      store.getState().openTask({
        id: `task-${index}`,
        conversation: {
          kind: "session",
          workspaceId: "workspace-1",
          sessionPath: `/sessions/${index}.jsonl`
        },
        workspaceId: "workspace-1",
        sessionId: `session-${index}`,
        sessionPath: `/sessions/${index}.jsonl`,
        taskGeneration: 1,
        lifecycle: "running",
        runtime: { phase: "busy", detail: "running", recoverable: true },
        title: `Task ${index}`,
        hasDraft: false,
        toolMode: "auto",
        attachmentCount: 0
      });
    }

    expect(workbenchLayout(store.getState()).runtimeRecovery).toHaveLength(MAX_RUNNING_TASKS);
  });

  it("drops an inconsistent selected task surface instead of sending invalid layout", () => {
    const store = createRendererWorkbenchStore();
    store.getState().registerWorkspace(workspace());
    store.getState().registerWorkspace({ ...workspace(), id: "workspace-2", displayName: "Two" });
    store.getState().openTask({
      id: "task-2",
      conversation: { kind: "session", workspaceId: "workspace-2", sessionPath: "/sessions/two.jsonl" },
      workspaceId: "workspace-2",
      sessionId: "session-2",
      taskGeneration: 1,
      lifecycle: "idle",
      runtime: { phase: "stopped", detail: "stopped", recoverable: true },
      title: "Two",
      hasDraft: false,
      toolMode: "auto",
      attachmentCount: 0
    });
    store.setState({ currentWorkspaceId: "workspace-1" });

    expect(workbenchLayout(store.getState()).selectedSurface).toBeUndefined();
  });

  it("persists the Settings origin instead of restoring an app page without return authority", () => {
    const store = createRendererWorkbenchStore();
    store.getState().registerWorkspace(workspace());
    store.getState().openTask({
      id: "task-1",
      conversation: { kind: "session", workspaceId: "workspace-1", sessionPath: "/sessions/one.jsonl" },
      workspaceId: "workspace-1",
      sessionId: "session-1",
      sessionPath: "/sessions/one.jsonl",
      sessionGeneration: 2,
      taskGeneration: 7,
      lifecycle: "running",
      runtime: { phase: "busy", detail: "running", recoverable: true },
      title: "One",
      hasDraft: false,
      toolMode: "auto",
      attachmentCount: 0
    });
    store.getState().openSettings("runtime");

    expect(workbenchLayout(store.getState())).toMatchObject({
      selectedSurface: {
        kind: "conversation",
        conversation: { sessionPath: "/sessions/one.jsonl" }
      },
      settings: { section: "runtime", scope: "global" }
    });
  });

  it("binds a persisted Workspace and Session to the App runtime authority without replaying it", () => {
    const store = createRendererWorkbenchStore();
    store.getState().hydrate({
      version: 2,
      workspaces: [workspace()],
      workspaceOrder: ["workspace-1"],
      expandedWorkspaceIds: ["workspace-1"],
      currentWorkspaceId: "workspace-1",
      selectedSurface: {
        kind: "conversation",
        conversation: {
          kind: "session",
          workspaceId: "workspace-1",
          sessionPath: "/sessions/persisted.jsonl"
        }
      },
      runtimeRecovery: [],
      settings: { section: "general", scope: "global" },
      cleanExit: false
    });

    expect(bindPersistedRendererWorkbenchAuthority(store.getState())).toBe(true);
    expect(useAppStore.getState()).toMatchObject({
      workspace: "/workspace/one",
      trust: "trusted",
      sessionTransitionPending: false,
      runtime: { phase: "stopped", detail: "会话待打开", recoverable: true }
    });
  });

  it("preserves the explicit interrupted-task recovery state on cold start", () => {
    const store = createRendererWorkbenchStore();
    store.getState().hydrate({
      version: 2,
      workspaces: [workspace()],
      workspaceOrder: ["workspace-1"],
      expandedWorkspaceIds: ["workspace-1"],
      currentWorkspaceId: "workspace-1",
      selectedSurface: {
        kind: "conversation",
        conversation: {
          kind: "session",
          workspaceId: "workspace-1",
          sessionPath: "/sessions/interrupted.jsonl"
        }
      },
      runtimeRecovery: [{
        taskId: "task-interrupted",
        conversation: {
          kind: "session",
          workspaceId: "workspace-1",
          sessionPath: "/sessions/interrupted.jsonl"
        },
        sessionId: "session-interrupted",
        taskGeneration: 4,
        lastKnownLifecycle: "running"
      }],
      settings: { section: "general", scope: "global" },
      cleanExit: false
    });

    expect(bindPersistedRendererWorkbenchAuthority(store.getState())).toBe(true);
    expect(useAppStore.getState().runtime).toEqual({
      phase: "failed",
      detail: "上次运行已中断",
      recoverable: true
    });
  });
});

function workspace(): WorkspaceDescriptor {
  return {
    id: "workspace-1",
    displayName: "One",
    identity: { canonicalPath: "/workspace/one", assurance: "filesystem", device: "1", inode: "1" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}
