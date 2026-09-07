import { afterEach, expect, it, vi } from "vitest";
import { cleanupCreationFixtures, creationFixture } from "./worktree-creation-test-fixture.js";
import { GitInspectionError } from "./worktree-git-runner.js";

afterEach(cleanupCreationFixtures);

it.each([false, true, undefined])("respects submodule cleanup confirmation %s during creation", async (cleanupConfirmed) => {
  const fixture = await creationFixture();
  vi.spyOn(fixture.runner, "inspectSubmodules").mockResolvedValue({
    status: "incomplete", total: 1, uninitialized: 1, divergent: 0, conflicted: 0
  });
  const initialize = vi.spyOn(fixture.runner, "initializeSubmodules").mockRejectedValueOnce(
    new GitInspectionError("submodule-update", "process-failed",
      cleanupConfirmed === undefined ? {} : { cleanupConfirmed })
  );
  const remove = vi.spyOn(fixture.runner, "removeWorktree");
  const deleteBranch = vi.spyOn(fixture.runner, "deleteBranch");
  const result = await fixture.service.create({
    requestId: "request-submodule-cleanup", creationId: "creation-submodule-cleanup", sourceWorkspaceId: fixture.source.id
  });
  expect(initialize).toHaveBeenCalledWith(expect.any(String), "local-only", expect.any(AbortSignal));
  const record = (await fixture.workbenchState.load()).state.environmentMutations[0]!;
  if (cleanupConfirmed === false) {
    expect(result).toMatchObject({ status: "rejected", error: { code: "repository-indeterminate" } });
    expect(record.state).toBe("indeterminate");
    expect(fixture.scheduler.isFenced(record.repositoryGroupId)).toBe(true);
  } else {
    expect(result).toMatchObject({ status: "created", receipt: { submodules: { networkActionRequired: true } } });
    expect(record.state).toBe("workspace-registered");
    expect(fixture.scheduler.isFenced(record.repositoryGroupId)).toBe(false);
  }
  expect(remove).not.toHaveBeenCalled();
  expect(deleteBranch).not.toHaveBeenCalled();
  expect(await fixture.runner.listWorktrees(fixture.repository)).toHaveLength(2);
}, 15_000);
