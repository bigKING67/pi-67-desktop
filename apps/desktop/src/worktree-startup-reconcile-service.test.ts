import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  observePhysicalDirectoryIdentity
} from "./repository-identity.js";
import {
  addRepository,
  advanceCreatedRecord,
  cleanupStartupFixtures,
  createRegisteredRecord,
  materializeRecord,
  recordState,
  reserveRecord,
  runSystemGit,
  startupFixture,
  startupRecovery,
  transitionRecord
} from "./worktree-startup-reconcile-test-fixture.js";

const REAL_GIT_TEST_TIMEOUT_MS = 15_000;

afterEach(async () => {
  await cleanupStartupFixtures();
});

describe("WorktreeStartupReconcileService", () => {
  it("marks a reserved creation failed when no path, Worktree, or branch exists", async () => {
    const fixture = await startupFixture();
    const repository = await addRepository(fixture, "repository-a", "workspace-source-a");
    await reserveRecord(fixture, repository, {
      creationId: "creation-reserved",
      worktreeToken: "a1a2a3a4a5a6a7a8"
    });

    const recovery = startupRecovery(fixture);
    await expect(recovery.service.reconcile()).resolves.toMatchObject({
      inspected: 1,
      failed: 1,
      indeterminate: 0
    });
    expect(await recordState(fixture, "creation-reserved")).toBe("failed");
    expect(recovery.scheduler.isFenced(repository.repositoryGroupId)).toBe(false);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("resumes exact clean git-materializing and git-materialized creations through Workspace registration", async () => {
    const fixture = await startupFixture();
    const repository = await addRepository(fixture, "repository-b", "workspace-source-b");
    await materializeRecord(fixture, repository, {
      creationId: "creation-materializing",
      worktreeToken: "b1b2b3b4b5b6b7b8",
      state: "git-materializing"
    });
    await materializeRecord(fixture, repository, {
      creationId: "creation-materialized",
      worktreeToken: "c1c2c3c4c5c6c7c8",
      state: "git-materialized"
    });
    const workspaceIds = ["workspace-recovered-a", "workspace-recovered-b"];
    const recovery = startupRecovery(fixture, {
      createWorkspaceId: () => workspaceIds.shift() ?? "workspace-unexpected"
    });

    await expect(recovery.service.reconcile()).resolves.toMatchObject({
      inspected: 2,
      resumed: 2,
      indeterminate: 0
    });
    const state = (await fixture.workbenchState.load()).state;
    expect(state.environmentMutations).toMatchObject([
      {
        creationId: "creation-materializing",
        state: "workspace-registered",
        workspaceId: "workspace-recovered-a"
      },
      {
        creationId: "creation-materialized",
        state: "workspace-registered",
        workspaceId: "workspace-recovered-b"
      }
    ]);
    expect(state.workspaceEnvironments.filter((binding) => binding.ownership === "app")).toMatchObject([
      { creationId: "creation-materializing", repositoryGroupId: repository.repositoryGroupId },
      { creationId: "creation-materialized", repositoryGroupId: repository.repositoryGroupId }
    ]);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("keeps an exact registered creation recoverable and commits an exact session-bound creation", async () => {
    const fixture = await startupFixture();
    const repository = await addRepository(fixture, "repository-c", "workspace-source-c");
    await createRegisteredRecord(fixture, repository, {
      creationId: "creation-registered",
      worktreeToken: "d1d2d3d4d5d6d7d8",
      workspaceId: "workspace-registered"
    });
    const bound = await createRegisteredRecord(fixture, repository, {
      creationId: "creation-bound",
      worktreeToken: "e1e2e3e4e5e6e7e8",
      workspaceId: "workspace-bound"
    });
    await advanceCreatedRecord(bound.service, "creation-bound", "host-registering");
    await advanceCreatedRecord(bound.service, "creation-bound", "host-registered");
    await advanceCreatedRecord(bound.service, "creation-bound", "session-materializing");
    const boundResult = await bound.service.advance({
      creationId: "creation-bound",
      targetState: "session-bound",
      sessionFileIdentity: "session-file-bound"
    });
    expect(boundResult).toMatchObject({ status: "advanced", receipt: { state: "session-bound" } });

    const recovery = startupRecovery(fixture);
    await expect(recovery.service.reconcile()).resolves.toMatchObject({
      inspected: 2,
      resumed: 1,
      committed: 1,
      indeterminate: 0
    });
    expect(await recordState(fixture, "creation-registered")).toBe("workspace-registered");
    expect(await recordState(fixture, "creation-bound")).toBe("committed");
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("marks a dirty Worktree indeterminate and fences its Repository", async () => {
    const fixture = await startupFixture();
    const repository = await addRepository(fixture, "repository-d", "workspace-source-d");
    const created = await createRegisteredRecord(fixture, repository, {
      creationId: "creation-dirty",
      worktreeToken: "f1f2f3f4f5f6f7f8",
      workspaceId: "workspace-dirty"
    });
    await writeFile(join(created.targetPath, "dirty.txt"), "dirty");

    const recovery = startupRecovery(fixture);
    await expect(recovery.service.reconcile()).resolves.toMatchObject({
      inspected: 1,
      indeterminate: 1
    });
    expect(await recordState(fixture, "creation-dirty")).toBe("indeterminate");
    expect(recovery.scheduler.isFenced(repository.repositoryGroupId)).toBe(true);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("marks a changed branch HEAD indeterminate", async () => {
    const fixture = await startupFixture();
    const repository = await addRepository(fixture, "repository-e", "workspace-source-e");
    const created = await createRegisteredRecord(fixture, repository, {
      creationId: "creation-head-mismatch",
      worktreeToken: "g1g2g3g4g5g6g7g8",
      workspaceId: "workspace-head-mismatch"
    });
    await runSystemGit(created.targetPath, [
      "-c", "user.name=Pi-67",
      "-c", "user.email=pi67@example.invalid",
      "commit", "--allow-empty", "-m", "advance"
    ]);

    const recovery = startupRecovery(fixture);
    await expect(recovery.service.reconcile()).resolves.toMatchObject({ indeterminate: 1 });
    expect(await recordState(fixture, "creation-head-mismatch")).toBe("indeterminate");
    expect(recovery.scheduler.isFenced(repository.repositoryGroupId)).toBe(true);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("marks a Git common-directory identity mismatch indeterminate", async () => {
    const fixture = await startupFixture();
    const repository = await addRepository(fixture, "repository-f", "workspace-source-f");
    const created = await createRegisteredRecord(fixture, repository, {
      creationId: "creation-common-mismatch",
      worktreeToken: "h1h2h3h4h5h6h7h8",
      workspaceId: "workspace-common-mismatch"
    });
    const other = await addRepository(fixture, "repository-other", "workspace-source-other");
    const expectedCommonDirectory = await fixture.runner.resolveCommonDirectory(created.targetPath);
    const otherCommonDirectory = await fixture.runner.resolveCommonDirectory(other.repository);
    const recovery = startupRecovery(fixture, {
      observeIdentity: (path) => observePhysicalDirectoryIdentity(
        path === expectedCommonDirectory ? otherCommonDirectory : path
      )
    });

    await expect(recovery.service.reconcile()).resolves.toMatchObject({ indeterminate: 1 });
    expect(await recordState(fixture, "creation-common-mismatch")).toBe("indeterminate");
    expect(recovery.scheduler.isFenced(repository.repositoryGroupId)).toBe(true);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("isolates one Repository inspection failure and continues reconciling another Repository", async () => {
    const fixture = await startupFixture();
    const first = await addRepository(fixture, "repository-h", "workspace-source-h");
    const second = await addRepository(fixture, "repository-i", "workspace-source-i");
    await reserveRecord(fixture, first, {
      creationId: "creation-broken-repository",
      worktreeToken: "k1k2k3k4k5k6k7k8"
    });
    await reserveRecord(fixture, second, {
      creationId: "creation-healthy-repository",
      worktreeToken: "m1m2m3m4m5m6m7m8"
    });
    await rm(first.repository, { recursive: true, force: true });

    const recovery = startupRecovery(fixture);
    await expect(recovery.service.reconcile()).resolves.toMatchObject({
      inspected: 2,
      failed: 1,
      indeterminate: 1
    });
    expect(await recordState(fixture, "creation-broken-repository")).toBe("indeterminate");
    expect(await recordState(fixture, "creation-healthy-repository")).toBe("failed");
    expect(recovery.scheduler.isFenced(first.repositoryGroupId)).toBe(true);
    expect(recovery.scheduler.isFenced(second.repositoryGroupId)).toBe(false);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("immediately fences persisted indeterminate and rollback-protected repositories", async () => {
    const fixture = await startupFixture();
    const repository = await addRepository(fixture, "repository-j", "workspace-source-j");
    await reserveRecord(fixture, repository, {
      creationId: "creation-already-indeterminate",
      worktreeToken: "n1n2n3n4n5n6n7n8"
    });
    await transitionRecord(fixture, "creation-already-indeterminate", "indeterminate");
    await reserveRecord(fixture, repository, {
      creationId: "creation-already-protected",
      worktreeToken: "p1p2p3p4p5p6p7p8"
    });
    await transitionRecord(fixture, "creation-already-protected", "git-materializing");
    await transitionRecord(fixture, "creation-already-protected", "rollback-pending");
    await transitionRecord(fixture, "creation-already-protected", "rollback-protected");

    const recovery = startupRecovery(fixture);
    await expect(recovery.service.reconcile()).resolves.toMatchObject({
      inspected: 0,
      indeterminate: 1,
      protected: 1
    });
    expect(recovery.scheduler.isFenced(repository.repositoryGroupId)).toBe(true);
  }, REAL_GIT_TEST_TIMEOUT_MS);
});
