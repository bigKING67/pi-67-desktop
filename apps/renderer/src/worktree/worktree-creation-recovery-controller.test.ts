import type { WorkbenchStateV5, WorkspaceDescriptor } from "@pi67/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import {
  reconcileRendererWorktreeCreations,
  type RendererWorktreeRecoveryDependencies
} from "./worktree-creation-recovery-controller.js";
import { installRendererWorktreeRecoveryTasks } from "./worktree-recovery-task-installation.js";

describe("Renderer Worktree creation recovery", () => {
  beforeEach(() => rendererWorkbenchStore.getState().reset());

  it("replays Host registration, resolves the exact Session, and commits Main state", async () => {
    const state = recoveryState("session-materializing");
    rendererWorkbenchStore.getState().hydrate(state);
    installRendererWorktreeRecoveryTasks(state);
    const fixture = dependencies(state, "session-file-created");

    await reconcileRendererWorktreeCreations(fixture.value);

    expect(fixture.advance.mock.calls.map(([, targetState]) => targetState)).toEqual([
      "host-registering",
      "host-registered"
    ]);
    expect(fixture.registerWorkspace).toHaveBeenCalledWith(createdWorkspace());
    expect(fixture.reconcileSessions).toHaveBeenCalledOnce();
    expect(fixture.commitSession).toHaveBeenCalledWith(
      "task-recovery",
      "environment-recovery"
    );
  });

  it("refuses to commit when Session resolution disagrees with the durable identity", async () => {
    const state = recoveryState("session-bound", "session-file-expected");
    rendererWorkbenchStore.getState().hydrate(state);
    installRendererWorktreeRecoveryTasks(state);
    const fixture = dependencies(state, "session-file-other");

    await reconcileRendererWorktreeCreations(fixture.value);

    expect(fixture.commitSession).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().tasks["task-recovery"]).toMatchObject({
      environmentCreationState: "recovery-required",
      runtime: { phase: "failed", recoverable: true }
    });
  });
});

function dependencies(state: WorkbenchStateV5, resolvedSessionFileIdentity: string) {
  const advance = vi.fn(async (
    creationId: string,
    _targetState: "host-registering" | "host-registered"
  ) => ({
    status: "advanced" as const,
    receipt: {
      creationId,
      state: state.environmentMutations[0]!.state as "session-materializing" | "session-bound",
      workspaceId: "workspace-created",
      ...(state.environmentMutations[0]!.sessionFileIdentity
        ? { sessionFileIdentity: state.environmentMutations[0]!.sessionFileIdentity }
        : {})
    }
  }));
  const registerWorkspace = vi.fn(async () => true);
  const reconcileSessions = vi.fn(async () => {
    rendererWorkbenchStore.getState().updateTask("task-recovery", {
      conversation: {
        kind: "session",
        workspaceId: "workspace-created",
        sessionFileIdentity: resolvedSessionFileIdentity,
        sessionPath: "/sessions/created.jsonl"
      },
      sessionId: "session-created",
      sessionFileIdentity: resolvedSessionFileIdentity,
      sessionPath: "/sessions/created.jsonl",
      sessionGeneration: 1,
      lifecycle: "idle",
      creationId: undefined,
      creationStatus: undefined
    });
  });
  const commitSession = vi.fn(async () => ({ status: "committed" as const }));
  return {
    advance,
    registerWorkspace,
    reconcileSessions,
    commitSession,
    value: {
      loadWorkbenchState: async () => state,
      advance,
      registerWorkspace,
      reconcileSessions,
      commitSession
    } satisfies RendererWorktreeRecoveryDependencies
  };
}

function recoveryState(
  state: "session-materializing" | "session-bound",
  sessionFileIdentity?: string
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
    sessionCreationRecovery: [{
      taskId: "task-recovery",
      workspaceId: "workspace-created",
      creationId: "environment-recovery",
      taskGeneration: 4
    }],
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
      workspaceId: "workspace-created",
      ...(sessionFileIdentity ? { sessionFileIdentity } : {})
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
