import type { WorkbenchStateV5, WorkspaceDescriptor } from "@pi67/domain";
import type {
  WorktreeCreationAdvanceRequest,
  WorktreeCreationProgressState,
  WorktreeCreationResult
} from "@pi67/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../app/app-store.js";
import { workbenchLayout } from "../workbench/workbench-controller.js";
import {
  rendererWorkbenchStore,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import {
  cancelWorktreeSessionEnvironment,
  commitWorktreeSessionEnvironment,
  prepareWorktreeSessionEnvironment,
  type WorktreeSessionEnvironmentDependencies
} from "./worktree-session-environment-controller.js";

describe("Worktree Session environment controller", () => {
  beforeEach(() => {
    rendererWorkbenchStore.getState().reset();
    rendererWorkbenchStore.getState().registerWorkspace(sourceWorkspace());
    rendererWorkbenchStore.getState().openTask(worktreeIntentTask());
    useAppStore.setState({
      workspace: sourceWorkspace().identity.canonicalPath,
      trust: "trusted",
      trustUpdating: false,
      sessionTransitionPending: false,
      sessionBootstrapTransitionPending: false,
      workspaceOpenPending: false,
      runtime: { phase: "stopped", detail: "draft", recoverable: true }
    });
  });

  it("moves the provisional Task, checkpoints Session recovery, and advances to materialization", async () => {
    const fixture = dependencies();

    await expect(prepareWorktreeSessionEnvironment("task-intent", fixture.value)).resolves.toMatchObject({
      status: "prepared",
      creationId: "environment-creation-1",
      task: {
        workspaceId: "workspace-created",
        creationId: "environment-creation-1",
        creationStatus: "pending",
        environmentCreationState: "session-materializing"
      }
    });

    expect(fixture.persistCheckpoint).toHaveBeenCalledOnce();
    expect(fixture.registerWorkspace).toHaveBeenCalledWith(createdWorkspace());
    expect(fixture.advance.mock.calls.map(([request]) => request.targetState)).toEqual([
      "host-registering",
      "host-registered",
      "session-materializing"
    ]);
    expect(rendererWorkbenchStore.getState()).toMatchObject({
      currentWorkspaceId: "workspace-created",
      selectedSurface: {
        kind: "conversation",
        conversation: {
          kind: "provisional",
          workspaceId: "workspace-created",
          draftId: "task-intent"
        }
      }
    });
    expect(workbenchLayout(rendererWorkbenchStore.getState()).sessionCreationRecovery).toEqual([{
      taskId: "task-intent",
      workspaceId: "workspace-created",
      creationId: "environment-creation-1",
      taskGeneration: 3
    }]);
    expect(useAppStore.getState()).toMatchObject({
      workspace: createdWorkspace().identity.canonicalPath,
      trust: "trusted"
    });
  });

  it("recovers an acknowledged Main creation after the create IPC outcome is lost", async () => {
    const fixture = dependencies({
      create: vi.fn().mockRejectedValue(new Error("IPC closed")),
      loadWorkbenchState: vi.fn().mockResolvedValue(recoveryState("workspace-registered"))
    });

    await expect(prepareWorktreeSessionEnvironment("task-intent", fixture.value)).resolves.toMatchObject({
      status: "prepared",
      task: { workspaceId: "workspace-created" }
    });

    expect(fixture.loadWorkbenchState).toHaveBeenCalledOnce();
    expect(fixture.registerWorkspace).toHaveBeenCalledOnce();
  });

  it("projects checkout progress and keeps the draft after authoritative cancellation rollback", async () => {
    let resolveCreate: ((result: WorktreeCreationResult) => void) | undefined;
    const fixture = dependencies({
      create: vi.fn(() => new Promise<WorktreeCreationResult>((resolve) => {
        resolveCreate = resolve;
      })),
      activity: vi.fn(async () => ({
        status: "active" as const,
        activity: {
          creationId: "environment-creation-1",
          stage: "checkout" as const,
          startedAt: 10,
          updatedAt: 10,
          budgetMs: 300_000,
          cancellable: true as const
        }
      })),
      cancel: vi.fn(async () => ({ status: "cancel-requested" as const }))
    });

    const preparing = prepareWorktreeSessionEnvironment("task-intent", fixture.value);
    await vi.waitFor(() => {
      expect(fixture.activity).toHaveBeenCalledWith("environment-creation-1");
      expect(rendererWorkbenchStore.getState().tasks["task-intent"]?.runtime.detail).toContain("checkout");
    });
    await expect(cancelWorktreeSessionEnvironment("task-intent", fixture.value)).resolves.toBe(true);
    expect(fixture.cancel).toHaveBeenCalledWith("environment-creation-1");
    resolveCreate?.({
      status: "rejected",
      error: { stage: "git", code: "cancelled", recoverable: true }
    });

    await expect(preparing).resolves.toMatchObject({ status: "failed", error: expect.stringContaining("已取消") });
    expect(rendererWorkbenchStore.getState().tasks["task-intent"]).toMatchObject({
      lifecycle: "draft",
      hasDraft: true,
      environmentCreationId: undefined,
      environmentCreationState: undefined,
      runtime: { phase: "stopped" }
    });
  });

  it("stops before Host side effects when the immediate Workbench checkpoint fails", async () => {
    const fixture = dependencies({
      persistCheckpoint: vi.fn().mockRejectedValue(new Error("disk unavailable"))
    });

    await expect(prepareWorktreeSessionEnvironment("task-intent", fixture.value)).resolves.toEqual({
      status: "unconfirmed",
      error: expect.stringContaining("恢复确认")
    });

    expect(fixture.advance).not.toHaveBeenCalled();
    expect(fixture.registerWorkspace).not.toHaveBeenCalled();
    expect(rendererWorkbenchStore.getState().tasks["task-intent"]).toMatchObject({
      workspaceId: "workspace-created",
      creationId: "environment-creation-1",
      environmentCreationState: "recovery-required",
      runtime: { phase: "failed", recoverable: true }
    });
  });

  it("binds the exact Pi Session identity before committing the environment", async () => {
    const fixture = dependencies();
    await prepareWorktreeSessionEnvironment("task-intent", fixture.value);
    rendererWorkbenchStore.getState().updateTask("task-intent", {
      conversation: {
        kind: "session",
        workspaceId: "workspace-created",
        sessionFileIdentity: "session-file-created",
        sessionPath: "/sessions/created.jsonl"
      },
      sessionId: "session-created",
      sessionFileIdentity: "session-file-created",
      sessionPath: "/sessions/created.jsonl",
      sessionGeneration: 1,
      lifecycle: "idle",
      creationId: undefined,
      creationStatus: undefined
    });
    fixture.advance.mockClear();
    fixture.persistCheckpoint.mockClear();

    await expect(commitWorktreeSessionEnvironment(
      "task-intent",
      "environment-creation-1",
      fixture.value
    )).resolves.toEqual({ status: "committed" });

    expect(fixture.advance.mock.calls.map(([request]) => request)).toEqual([
      {
        creationId: "environment-creation-1",
        targetState: "session-bound",
        sessionFileIdentity: "session-file-created"
      },
      {
        creationId: "environment-creation-1",
        targetState: "committed"
      }
    ]);
    expect(fixture.persistCheckpoint).toHaveBeenCalledOnce();
    expect(rendererWorkbenchStore.getState().tasks["task-intent"]?.environmentCreationState).toBe("committed");
  });
});

function dependencies(overrides: Partial<WorktreeSessionEnvironmentDependencies> = {}) {
  let state: WorktreeCreationProgressState = "workspace-registered";
  const create = vi.fn(overrides.create ?? (async () => ({
    status: "created" as const,
    receipt: {
      requestId: "task-intent",
      creationId: "environment-creation-1",
      sourceWorkspaceId: "workspace-source",
      repositoryGroupId: "repo_0123456789abcdef0123456789abcdef",
      state: "workspace-registered" as const,
      workspace: createdWorkspace()
    }
  })));
  const advance = vi.fn(overrides.advance ?? (async (request: WorktreeCreationAdvanceRequest) => {
    state = request.targetState;
    return {
      status: "advanced" as const,
      receipt: {
        creationId: request.creationId,
        state,
        workspaceId: "workspace-created",
        ...(request.targetState === "session-bound"
          ? { sessionFileIdentity: request.sessionFileIdentity }
          : {})
      }
    };
  }));
  const loadWorkbenchState = vi.fn(overrides.loadWorkbenchState
    ?? (async () => recoveryState("workspace-registered")));
  const persistCheckpoint = vi.fn(overrides.persistCheckpoint ?? (async () => undefined));
  const registerWorkspace = vi.fn(overrides.registerWorkspace ?? (async () => true));
  const activity = vi.fn(overrides.activity ?? (async () => ({ status: "inactive" as const })));
  const cancel = vi.fn(overrides.cancel ?? (async () => ({ status: "inactive" as const })));
  return {
    create,
    advance,
    loadWorkbenchState,
    persistCheckpoint,
    registerWorkspace,
    activity,
    cancel,
    value: {
      createId: overrides.createId ?? (() => "environment-creation-1"),
      create,
      advance,
      loadWorkbenchState,
      persistCheckpoint,
      registerWorkspace,
      ...(overrides.activity ? { activity } : {}),
      ...(overrides.cancel ? { cancel } : {})
    } satisfies WorktreeSessionEnvironmentDependencies
  };
}

function recoveryState(state: WorktreeCreationProgressState): WorkbenchStateV5 {
  return {
    version: 5,
    workspaces: [sourceWorkspace(), createdWorkspace()],
    workspaceOrder: ["workspace-source", "workspace-created"],
    expandedWorkspaceIds: ["workspace-source"],
    currentWorkspaceId: "workspace-source",
    runtimeRecovery: [],
    sessionCreationRecovery: [],
    workspaceEnvironments: [
      {
        workspaceId: "workspace-source",
        kind: "repository-primary",
        ownership: "user",
        repositoryGroupId: "repo_0123456789abcdef0123456789abcdef"
      },
      {
        workspaceId: "workspace-created",
        kind: "repository-worktree",
        ownership: "app",
        repositoryGroupId: "repo_0123456789abcdef0123456789abcdef",
        creationId: "environment-creation-1"
      }
    ],
    environmentMutations: [{
      kind: "worktree-creation",
      requestId: "task-intent",
      creationId: "environment-creation-1",
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
      ...(state === "session-bound" || state === "committed"
        ? { sessionFileIdentity: "session-file-created" }
        : {})
    }],
    settings: { section: "general", scope: "global" },
    cleanExit: false
  };
}

function worktreeIntentTask(): RendererWorkbenchTask {
  return {
    id: "task-intent",
    conversation: {
      kind: "provisional",
      workspaceId: "workspace-source",
      draftId: "task-intent"
    },
    workspaceId: "workspace-source",
    sessionId: "pending:task-intent",
    taskGeneration: 3,
    lifecycle: "draft",
    runtime: { phase: "stopped", detail: "draft", recoverable: true },
    title: "Draft",
    hasDraft: true,
    attachmentCount: 2,
    toolMode: "auto",
    environmentIntent: "worktree"
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
    identity: {
      canonicalPath: path,
      assurance: "filesystem",
      device: "1",
      inode
    },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}
