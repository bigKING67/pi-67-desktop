import type {
  EnvironmentCreationState,
  WorkbenchStateV5,
  WorkspaceDescriptor
} from "@pi67/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { installRendererWorktreeRecoveryTasks } from "./worktree-recovery-task-installation.js";

describe("Worktree recovery Task installation", () => {
  beforeEach(() => rendererWorkbenchStore.getState().reset());

  it("restores a resumable pre-Session Worktree Task and its persisted selection", () => {
    const state = recoveryState("host-registered", false);
    rendererWorkbenchStore.getState().hydrate(state);

    installRendererWorktreeRecoveryTasks(state);

    expect(rendererWorkbenchStore.getState()).toMatchObject({
      currentWorkspaceId: "workspace-created",
      selectedSurface: {
        kind: "conversation",
        conversation: {
          kind: "provisional",
          workspaceId: "workspace-created",
          draftId: "task-recovery"
        }
      },
      tasks: {
        "task-recovery": {
          workspaceId: "workspace-created",
          environmentIntent: "worktree",
          environmentCreationId: "environment-recovery",
          environmentSourceWorkspaceId: "workspace-source",
          environmentCreationState: "host-registered"
        }
      }
    });
    expect(rendererWorkbenchStore.getState().tasks["task-recovery"]?.creationId).toBeUndefined();
    expect(rendererWorkbenchStore.getState().tasks["task-recovery"]?.creationStatus).toBeUndefined();
  });

  it("keeps exact Session resolution authority for a materializing Worktree", () => {
    const state = recoveryState("session-materializing", true);
    rendererWorkbenchStore.getState().hydrate(state);

    installRendererWorktreeRecoveryTasks(state);

    expect(rendererWorkbenchStore.getState().tasks["task-recovery"]).toMatchObject({
      workspaceId: "workspace-created",
      taskGeneration: 4,
      creationId: "environment-recovery",
      creationStatus: "unconfirmed",
      environmentIntent: "worktree",
      environmentCreationState: "session-materializing",
      runtime: { phase: "failed", recoverable: true }
    });
  });
});

function recoveryState(
  state: Extract<EnvironmentCreationState, "host-registered" | "session-materializing">,
  includeSessionRecovery: boolean
): WorkbenchStateV5 {
  return {
    version: 5,
    workspaces: [sourceWorkspace(), createdWorkspace()],
    workspaceOrder: ["workspace-source", "workspace-created"],
    expandedWorkspaceIds: ["workspace-created"],
    currentWorkspaceId: "workspace-created",
    selectedSurface: {
      kind: "conversation",
      conversation: {
        kind: "provisional",
        workspaceId: "workspace-created",
        draftId: "task-recovery"
      }
    },
    runtimeRecovery: [],
    sessionCreationRecovery: includeSessionRecovery
      ? [{
          taskId: "task-recovery",
          workspaceId: "workspace-created",
          creationId: "environment-recovery",
          taskGeneration: 4
        }]
      : [],
    workspaceEnvironments: [{
      workspaceId: "workspace-created",
      kind: "repository-worktree",
      ownership: "app",
      repositoryGroupId: "repo_0123456789abcdef0123456789abcdef",
      creationId: "environment-recovery"
    }],
    environmentMutations: [{
      kind: "worktree-creation",
      requestId: "task-recovery",
      creationId: "environment-recovery",
      requestFingerprint: "a".repeat(64),
      sourceWorkspaceId: "workspace-source",
      repositoryGroupId: "repo_0123456789abcdef0123456789abcdef",
      worktreeToken: "0123456789abcdef",
      branchName: "pi67/task-0123456789abcdef",
      headSha: "b".repeat(40),
      state,
      createdAt: 1,
      updatedAt: 2,
      workspaceId: "workspace-created"
    }],
    settings: { section: "general", scope: "global" },
    cleanExit: false
  };
}

function sourceWorkspace(): WorkspaceDescriptor {
  return workspace("workspace-source", "/work/source", "1");
}

function createdWorkspace(): WorkspaceDescriptor {
  return workspace("workspace-created", "/work/created", "2");
}

function workspace(id: string, path: string, inode: string): WorkspaceDescriptor {
  return {
    id,
    displayName: id,
    identity: { canonicalPath: path, assurance: "filesystem", device: "1", inode },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}
