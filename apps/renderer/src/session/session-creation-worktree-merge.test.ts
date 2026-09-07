import { reconcileRendererWorktreeCreations, type RendererWorktreeRecoveryDependencies } from "../worktree/worktree-creation-recovery-controller.js";
import { beforeEach, expect, it, vi } from "vitest";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { recheckUnconfirmedRendererSession, reconcileUnconfirmedRendererSessions } from "./session-creation-recovery-controller.js";
import { openUnconfirmedTask, catalogSession, mockMaterializedResolution, openExistingOwner, workspace } from "./session-creation-recovery-test-fixture.js";

beforeEach(() => {
  vi.restoreAllMocks();
  useTaskDraftStore.getState().dispose();
  rendererWorkbenchStore.getState().reset();
  rendererWorkbenchStore.getState().registerWorkspace(workspace());
});

  it.each([false, true])("preserves Worktree identity and owner progress (already bound: %s)", async (alreadyBound) => {
    const environment = {
      environmentIntent: "worktree" as const,
      environmentCreationId: "session-creation-unconfirmed",
      environmentSourceWorkspaceId: "workspace-source",
      environmentCreationState: "session-materializing" as const
    };
    openUnconfirmedTask(environment);
    openExistingOwner(catalogSession("session-created", 10_100), alreadyBound
      ? { ...environment, environmentCreationState: "committed" } : {});
    mockMaterializedResolution();
    await expect(recheckUnconfirmedRendererSession("task-unconfirmed", { notify: false }))
      .resolves.toBe("materialized");
    expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]).toBeUndefined();
    expect(rendererWorkbenchStore.getState().tasks["task-existing-owner"]).toMatchObject({
      ...environment, environmentCreationState: alreadyBound ? "committed" : "session-materializing"
    });
  });

  it("keeps both Tasks and drafts when their Worktree creation identities conflict", async () => {
    openUnconfirmedTask({ environmentIntent: "worktree", environmentCreationId: "session-creation-unconfirmed", hasDraft: true });
    useTaskDraftStore.getState().setText("task-unconfirmed", "retained draft");
    openExistingOwner(catalogSession("session-created", 10_100), {
      environmentIntent: "worktree", environmentCreationId: "another-environment"
    });
    mockMaterializedResolution();
    await expect(recheckUnconfirmedRendererSession("task-unconfirmed", { notify: false }))
      .resolves.toBe("still-unconfirmed");
    expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]).toBeDefined();
    expect(useTaskDraftStore.getState().drafts["task-unconfirmed"]?.text).toBe("retained draft");
    expect(useTaskDraftStore.getState().drafts["task-existing-owner"]).toBeUndefined();
    expect(rendererWorkbenchStore.getState().tasks["task-existing-owner"]?.environmentCreationId).toBe("another-environment");
  });

it.each(["advance-start", "register", "register-throw", "advance-end"] as const)("reports %s recovery failure on the merged owner without committing it", async (fault) => {
  const creationId = "session-creation-unconfirmed";
  openUnconfirmedTask({ environmentIntent: "worktree", environmentCreationId: creationId,
    environmentSourceWorkspaceId: "workspace-source", environmentCreationState: "session-materializing" });
  openExistingOwner(catalogSession("session-created", 10_100));
  mockMaterializedResolution();
  const commitSession = vi.fn(async () => ({ status: "committed" as const }));
  const dependencies: RendererWorktreeRecoveryDependencies = {
    loadWorkbenchState: async () => ({
      version: 5, workspaces: [workspace()], workspaceOrder: ["workspace-a"], expandedWorkspaceIds: [],
      runtimeRecovery: [], sessionCreationRecovery: [], workspaceEnvironments: [],
      settings: { section: "general", scope: "global" }, cleanExit: false,
      environmentMutations: [{ kind: "worktree-creation", creationId, requestId: "task-unconfirmed",
        requestFingerprint: "a".repeat(64), sourceWorkspaceId: "workspace-source",
        repositoryGroupId: `repo_${"a".repeat(32)}`, worktreeToken: "0123456789abcdef",
        branchName: "pi67/task-0123456789abcdef", headSha: "b".repeat(40),
        state: "session-materializing", workspaceId: "workspace-a", createdAt: 1, updatedAt: 2 }]
    }),
    advance: async () => ({ status: "advanced", receipt: {
      creationId, workspaceId: "workspace-a", state: "session-materializing"
    } }),
    registerWorkspace: async () => true,
    reconcileSessions: reconcileUnconfirmedRendererSessions,
    commitSession
  };
  await reconcileRendererWorktreeCreations(dependencies);
  expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]).toBeUndefined();
  expect(commitSession).toHaveBeenCalledExactlyOnceWith("task-existing-owner", creationId);
  commitSession.mockClear();
  await reconcileRendererWorktreeCreations({
    ...dependencies,
    advance: async (id, targetState) => {
      if ((fault === "advance-start" && targetState === "host-registering")
        || (fault === "advance-end" && targetState === "host-registered")) throw new Error("advance unavailable");
      return dependencies.advance(id, targetState);
    },
    registerWorkspace: async () => {
      if (fault === "register-throw") throw new Error("Host unavailable");
      return fault !== "register";
    }
  });
  expect(commitSession).not.toHaveBeenCalled();
  expect(rendererWorkbenchStore.getState().tasks["task-existing-owner"]).toMatchObject({
    environmentCreationState: "recovery-required", runtime: { phase: "failed", recoverable: true }
  });
  await reconcileRendererWorktreeCreations(dependencies);
  expect(commitSession).toHaveBeenCalledExactlyOnceWith("task-existing-owner", creationId);
  expect(rendererWorkbenchStore.getState().tasks["task-existing-owner"]).toMatchObject({
    lifecycle: "stopped", runtime: { phase: "stopped" }
  });
  // A fresh placeholder can merge during the same failed recovery pass.
  openUnconfirmedTask({ environmentIntent: "worktree", environmentCreationId: creationId,
    environmentSourceWorkspaceId: "workspace-source", environmentCreationState: "session-materializing" });
  commitSession.mockClear();
  await reconcileRendererWorktreeCreations({ ...dependencies, registerWorkspace: async () => false });
  expect(rendererWorkbenchStore.getState().tasks["task-unconfirmed"]).toBeUndefined();
  expect(commitSession).not.toHaveBeenCalled();
  expect(rendererWorkbenchStore.getState().tasks["task-existing-owner"]?.runtime.phase).toBe("failed");
  commitSession.mockImplementationOnce(async () => {
    rendererWorkbenchStore.getState().updateTask("task-existing-owner", {
      runtime: { phase: "stopped", detail: "new Session projection", recoverable: false }
    });
    return { status: "committed" };
  });
  await reconcileRendererWorktreeCreations(dependencies);
  expect(rendererWorkbenchStore.getState().tasks["task-existing-owner"]?.runtime).toEqual({
    phase: "stopped", detail: "new Session projection", recoverable: false
  });
});
