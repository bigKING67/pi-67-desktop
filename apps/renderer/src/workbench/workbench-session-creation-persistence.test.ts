import type { WorkbenchStateV4 } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import { workbenchLayout } from "./workbench-controller.js";
import { createRendererWorkbenchStore } from "./workbench-store.js";

describe("Renderer Session creation persistence", () => {
  it("persists pending creation authority without runtime or draft contents", () => {
    const store = createRendererWorkbenchStore();
    store.getState().registerWorkspace(workspace());
    store.getState().openTask(creationTask("confirming"));

    expect(workbenchLayout(store.getState(), {
      identity: undefined
    })).toEqual({
      expandedWorkspaceIds: ["workspace-a"],
      currentWorkspaceId: "workspace-a",
      selectedSurface: {
        kind: "conversation",
        conversation: {
          kind: "provisional",
          workspaceId: "workspace-a",
          draftId: "task-creation"
        }
      },
      runtimeRecovery: [],
      sessionCreationRecovery: [{
        taskId: "task-creation",
        workspaceId: "workspace-a",
        creationId: "session-creation-persisted",
        taskGeneration: 4
      }],
      settings: { section: "general", scope: "global" }
    });
  });

  it("hydrates a persisted creation as one unconfirmed provisional Task", () => {
    const store = createRendererWorkbenchStore();
    const state: WorkbenchStateV4 = {
      version: 4,
      workspaces: [workspace()],
      workspaceOrder: ["workspace-a"],
      expandedWorkspaceIds: ["workspace-a"],
      currentWorkspaceId: "workspace-a",
      selectedSurface: {
        kind: "conversation",
        conversation: {
          kind: "provisional",
          workspaceId: "workspace-a",
          draftId: "task-creation"
        }
      },
      runtimeRecovery: [],
      sessionCreationRecovery: [{
        taskId: "task-creation",
        workspaceId: "workspace-a",
        creationId: "session-creation-persisted",
        taskGeneration: 4
      }],
      settings: { section: "general", scope: "global" },
      cleanExit: true
    };

    store.getState().hydrate(state);

    expect(store.getState().runtimeTaskOrder).toEqual(["task-creation"]);
    expect(store.getState().tasks["task-creation"]).toMatchObject({
      conversation: state.selectedSurface?.kind === "conversation"
        ? state.selectedSurface.conversation
        : undefined,
      taskGeneration: 4,
      lifecycle: "draft",
      runtime: { phase: "failed", recoverable: true },
      creationId: "session-creation-persisted",
      creationStatus: "unconfirmed"
    });
    expect(store.getState().selectedSurface).toEqual(state.selectedSurface);
  });
});

function creationTask(status: "pending" | "confirming" | "unconfirmed") {
  return {
    id: "task-creation",
    conversation: {
      kind: "provisional" as const,
      workspaceId: "workspace-a",
      draftId: "task-creation"
    },
    workspaceId: "workspace-a",
    sessionId: "pending:task-creation",
    taskGeneration: 4,
    lifecycle: "initializing" as const,
    runtime: { phase: "starting" as const, detail: "creating", recoverable: true },
    title: "Private provisional title",
    hasDraft: true,
    toolMode: "auto" as const,
    attachmentCount: 2,
    creationId: "session-creation-persisted",
    creationStatus: status
  };
}

function workspace() {
  return {
    id: "workspace-a",
    displayName: "A",
    identity: { canonicalPath: "/work/a", assurance: "filesystem" as const },
    trust: "trusted" as const,
    trustProvenance: "native-picker" as const,
    availability: "available" as const
  };
}
