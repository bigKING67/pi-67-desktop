import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { captureGitProcess, type GitChild } from "./bounded-git-process.js";
import { cleanupCreationFixtures, creationFixture } from "./worktree-creation-test-fixture.js";

afterEach(cleanupCreationFixtures);

it("fences creation when Windows cancellation races root close without tree confirmation", async () => {
  const fixture = await creationFixture();
  vi.spyOn(fixture.runner, "addWorktree").mockImplementationOnce(async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 1234,
      stdout: new PassThrough(),
      stderr: new PassThrough()
    });
    const controller = new AbortController();
    const pending = captureGitProcess({
      child: child as unknown as GitChild,
      stage: "worktree-add",
      platform: "win32",
      timeoutMs: 1000,
      outputLimitBytes: 1024,
      signal: controller.signal
    });
    controller.abort();
    child.emit("close", 0, null);
    await pending;
  });
  const remove = vi.spyOn(fixture.runner, "removeWorktree");
  const deleteBranch = vi.spyOn(fixture.runner, "deleteBranch");
  await expect(fixture.service.create({
    requestId: "request-cancel-close", creationId: "creation-cancel-close", sourceWorkspaceId: fixture.source.id
  })).resolves.toMatchObject({ status: "rejected", error: { code: "repository-indeterminate" } });
  const record = (await fixture.workbenchState.load()).state.environmentMutations[0]!;
  expect(record.state).toBe("indeterminate");
  expect(fixture.scheduler.isFenced(record.repositoryGroupId)).toBe(true);
  expect(remove).not.toHaveBeenCalled();
  expect(deleteBranch).not.toHaveBeenCalled();
}, 15_000);
