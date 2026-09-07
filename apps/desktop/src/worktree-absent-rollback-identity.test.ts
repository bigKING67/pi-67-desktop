import { cp, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import { advanceEnvironmentMutation } from "./workbench-state-mutations.js";
import { WorktreeStartupReconcileService } from "./worktree-startup-reconcile-service.js";
import { creationFixture, cleanupCreationFixtures } from "./worktree-creation-test-fixture.js";

it.each(["explicit", "startup"] as const)("protects absent target rollback after source identity replacement: %s", async (mode) => {
  const fixture = await creationFixture();
  try {
    const request = { requestId: "request-identity", creationId: "creation-identity", sourceWorkspaceId: fixture.source.id };
    const created = await fixture.service.create(request);
    if (created.status !== "created") throw new Error("Expected created fixture");
    const record = (await fixture.workbenchState.load()).state.environmentMutations[0]!;
    await fixture.runner.removeWorktree(fixture.repository, created.receipt.workspace.identity.canonicalPath);
    if (mode === "startup") {
      await fixture.runner.deleteBranch(fixture.repository, record.branchName);
      await fixture.workbenchState.update((state) => advanceEnvironmentMutation(state, record.creationId, "rollback-pending", record.updatedAt + 1, { rollbackSafety: "pre-host-confirmed" }));
    }
    const original = join(dirname(fixture.repository), "original-git");
    await rename(join(fixture.repository, ".git"), original);
    await cp(original, join(fixture.repository, ".git"), { recursive: true });
    const remove = vi.spyOn(fixture.runner, "removeWorktree");
    const deleteBranch = vi.spyOn(fixture.runner, "deleteBranch");
    if (mode === "explicit") {
      await expect(fixture.service.rollback(request)).resolves.toMatchObject({ status: "rejected", error: { code: "rollback-protected" } });
      await expect(fixture.runner.resolveBranchHead(fixture.repository, record.branchName)).resolves.toBe(record.headSha);
    } else {
      const recovery = new WorktreeStartupReconcileService({ ...fixture, userData: join(dirname(fixture.repository), "user-data") });
      await expect(recovery.reconcile()).resolves.toMatchObject({ protected: 1, rolledBack: 0 });
    }
    expect(remove).not.toHaveBeenCalled();
    expect(deleteBranch).not.toHaveBeenCalled();
    expect(fixture.scheduler.isFenced(record.repositoryGroupId)).toBe(true);
  } finally {
    vi.restoreAllMocks();
    await cleanupCreationFixtures();
  }
}, 30_000);
