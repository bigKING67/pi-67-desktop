import { cp, rename } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupCreationFixtures, creationFixture } from "./worktree-creation-test-fixture.js";
const REAL_GIT_TEST_TIMEOUT_MS = 15_000;
afterEach(cleanupCreationFixtures);
describe("Worktree creation rollback identity", () => {
  it("protects failed creation when its Git common directory was replaced", async () => {
    const fixture = await creationFixture();
    const addWorktree = fixture.runner.addWorktree.bind(fixture.runner);
    vi.spyOn(fixture.runner, "addWorktree").mockImplementationOnce(async (input, signal) => {
      await addWorktree(input, signal);
      const original = join(fixture.repository, ".git-original");
      await rename(join(fixture.repository, ".git"), original);
      await cp(original, join(fixture.repository, ".git"), { recursive: true });
    });
    const remove = vi.spyOn(fixture.runner, "removeWorktree");
    const deleteBranch = vi.spyOn(fixture.runner, "deleteBranch");
    const result = await fixture.service.create({
      requestId: "request-common-drift", creationId: "creation-common-drift", sourceWorkspaceId: fixture.source.id
    });
    expect.soft(result).toMatchObject({ status: "rejected", error: { code: "rollback-protected" } });
    expect.soft(remove).not.toHaveBeenCalled();
    expect.soft(deleteBranch).not.toHaveBeenCalled();
    expect.soft(await fixture.runner.listWorktrees(fixture.repository)).toHaveLength(2);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it.each(["mismatch", "unreadable"] as const)("preserves artifacts on target-only common-directory %s", async (fault) => {
    const fixture = await creationFixture();
    const add = fixture.runner.addWorktree.bind(fixture.runner);
    const resolveCommon = fixture.runner.resolveCommonDirectory.bind(fixture.runner);
    let target: string | undefined;
    vi.spyOn(fixture.runner, "addWorktree").mockImplementationOnce(async (input, signal) => {
      await add(input, signal);
      target = input.targetPath;
    });
    vi.spyOn(fixture.runner, "resolveCommonDirectory").mockImplementation(async (path, signal) => {
      if (path !== target) return resolveCommon(path, signal);
      if (fault === "unreadable") throw new Error("controlled identity read failure");
      return fixture.repository;
    });
    const remove = vi.spyOn(fixture.runner, "removeWorktree");
    const deleteBranch = vi.spyOn(fixture.runner, "deleteBranch");
    await expect(fixture.service.create({
      requestId: "request-target-drift", creationId: "creation-target-drift", sourceWorkspaceId: fixture.source.id
    })).resolves.toMatchObject({ status: "rejected", error: {
      code: fault === "mismatch" ? "rollback-protected" : "repository-indeterminate"
    } });
    expect(remove).not.toHaveBeenCalled();
    expect(deleteBranch).not.toHaveBeenCalled();
    expect(await fixture.runner.listWorktrees(fixture.repository)).toHaveLength(2);
    const record = (await fixture.workbenchState.load()).state.environmentMutations[0]!;
    expect(record.state).toBe(fault === "mismatch" ? "rollback-protected" : "indeterminate");
    expect(fixture.scheduler.isFenced(record.repositoryGroupId)).toBe(true);
  }, REAL_GIT_TEST_TIMEOUT_MS);
});
