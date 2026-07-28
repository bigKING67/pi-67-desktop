import type { WorkspaceDescriptor } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { createRendererWorkbenchStore } from "./workbench-store.js";
import { workbenchLayout } from "./workbench-controller.js";

describe("renderer workbench persistence boundary", () => {
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
      attachmentCount: 2
    });

    const serialized = JSON.stringify(workbenchLayout(store.getState()));

    expect(serialized).toContain("session-1");
    expect(serialized).not.toContain("Private title");
    expect(serialized).not.toContain("Private latest user prompt");
    expect(serialized).not.toContain("private runtime detail");
    expect(serialized).not.toContain("hasDraft");
    expect(serialized).not.toContain("attachmentCount");
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
