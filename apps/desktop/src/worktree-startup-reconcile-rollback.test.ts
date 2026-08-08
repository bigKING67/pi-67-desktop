import { afterEach, describe, expect, it, vi } from "vitest";
import { advanceEnvironmentMutation } from "./workbench-state-mutations.js";
import {
  addRepository,
  cleanupStartupFixtures,
  createRegisteredRecord,
  materializeRecord,
  recordState,
  reserveRecord,
  startupFixture,
  startupRecovery,
  transitionRecord
} from "./worktree-startup-reconcile-test-fixture.js";

const REAL_GIT_TEST_TIMEOUT_MS = 15_000;

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupStartupFixtures();
});

describe("WorktreeStartupReconcileService rollback recovery", () => {
  it("finalizes absent rollback and protects remaining artifacts without deleting either path or branch", async () => {
    const fixture = await startupFixture();
    const repository = await addRepository(fixture, "repository-g", "workspace-source-g");
    await reserveRecord(fixture, repository, {
      creationId: "creation-rollback-absent",
      worktreeToken: "i1i2i3i4i5i6i7i8"
    });
    await transitionRecord(fixture, "creation-rollback-absent", "git-materializing");
    await transitionRecord(fixture, "creation-rollback-absent", "rollback-pending");
    await materializeRecord(fixture, repository, {
      creationId: "creation-rollback-present",
      worktreeToken: "j1j2j3j4j5j6j7j8",
      state: "git-materialized"
    });
    await transitionRecord(fixture, "creation-rollback-present", "rollback-pending");
    const removeWorktree = vi.spyOn(fixture.runner, "removeWorktree");
    const deleteBranch = vi.spyOn(fixture.runner, "deleteBranch");

    const recovery = startupRecovery(fixture);
    await expect(recovery.service.reconcile()).resolves.toMatchObject({
      inspected: 2,
      rolledBack: 1,
      protected: 1
    });
    expect(await recordState(fixture, "creation-rollback-absent")).toBe("rolled-back");
    expect(await recordState(fixture, "creation-rollback-present")).toBe("rollback-protected");
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(deleteBranch).not.toHaveBeenCalled();
    expect(recovery.scheduler.isFenced(repository.repositoryGroupId)).toBe(true);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("finalizes a crash-interrupted pre-Host rollback only when its durable safety marker is present", async () => {
    const fixture = await startupFixture();
    const repository = await addRepository(fixture, "repository-rollback-safe", "workspace-source-rollback-safe");
    const created = await createRegisteredRecord(fixture, repository, {
      creationId: "creation-rollback-safe",
      worktreeToken: "q1q2q3q4q5q6q7q8",
      workspaceId: "workspace-rollback-safe"
    });
    await fixture.workbenchState.update((state) => advanceEnvironmentMutation(
      state,
      "creation-rollback-safe",
      "rollback-pending",
      201,
      { rollbackSafety: "pre-host-confirmed" }
    ));
    await fixture.runner.removeWorktree(repository.repository, created.targetPath);
    await fixture.runner.deleteBranch(repository.repository, "pi67/task-q1q2q3q4q5q6q7q8");

    const recovery = startupRecovery(fixture);
    await expect(recovery.service.reconcile()).resolves.toMatchObject({ rolledBack: 1, indeterminate: 0 });
    const state = (await fixture.workbenchState.load()).state;
    expect(state.environmentMutations).toMatchObject([{
      creationId: "creation-rollback-safe",
      state: "rolled-back",
      rollbackSafety: "pre-host-confirmed"
    }]);
    expect(state.environmentMutations[0]?.workspaceId).toBeUndefined();
    expect(state.workspaces.some((workspace) => workspace.id === "workspace-rollback-safe")).toBe(false);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("does not infer pre-Host authority from an unmarked rollback-pending record", async () => {
    const fixture = await startupFixture();
    const repository = await addRepository(fixture, "repository-rollback-unknown", "workspace-source-rollback-unknown");
    const created = await createRegisteredRecord(fixture, repository, {
      creationId: "creation-rollback-unknown",
      worktreeToken: "r1r2r3r4r5r6r7r8",
      workspaceId: "workspace-rollback-unknown"
    });
    await transitionRecord(fixture, "creation-rollback-unknown", "rollback-pending");
    await fixture.runner.removeWorktree(repository.repository, created.targetPath);
    await fixture.runner.deleteBranch(repository.repository, "pi67/task-r1r2r3r4r5r6r7r8");

    const recovery = startupRecovery(fixture);
    await expect(recovery.service.reconcile()).resolves.toMatchObject({ rolledBack: 0, indeterminate: 1 });
    const state = (await fixture.workbenchState.load()).state;
    expect(state.environmentMutations).toMatchObject([{
      creationId: "creation-rollback-unknown",
      state: "indeterminate"
    }]);
    expect(state.workspaces.some((workspace) => workspace.id === "workspace-rollback-unknown")).toBe(true);
    expect(recovery.scheduler.isFenced(repository.repositoryGroupId)).toBe(true);
  }, REAL_GIT_TEST_TIMEOUT_MS);
});
