import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupCreationFixtures, creationFixture, runSystemGit } from "./worktree-creation-test-fixture.js";
import { parseConfiguredFilters } from "./worktree-git-runner.js";

afterEach(cleanupCreationFixtures);

it.each(["smudge", "clean", "process"])("rejects a custom command named lfs.%s before creation", async (property) => {
  const fixture = await creationFixture();
  const marker = join(fixture.repository, ".git", "filter-marker");
  await writeFile(join(fixture.repository, ".gitattributes"), "payload.bin filter=lfs\n");
  await writeFile(join(fixture.repository, "payload.bin"), "fixture payload\n");
  await runSystemGit(fixture.repository, ["add", "--", ".gitattributes", "payload.bin"]);
  await runSystemGit(fixture.repository, ["-c", "user.name=Pi-67", "-c", "user.email=pi67@example.invalid", "commit", "-m", "fixture"]);
  await runSystemGit(fixture.repository, ["config", `filter.lfs.${property}`, `printf controlled > '${marker}'; cat`]);
  const add = vi.spyOn(fixture.runner, "addWorktree");
  await expect(fixture.service.create({
    requestId: "request-lfs", creationId: "creation-lfs", sourceWorkspaceId: fixture.source.id
  })).resolves.toMatchObject({ status: "rejected", error: { code: "custom-filter" } });
  expect(add).not.toHaveBeenCalled();
  expect((await fixture.workbenchState.load()).state.environmentMutations).toHaveLength(0);
  await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
}, 15_000);

it.each([false, true])("accepts standard Git LFS commands with skip=%s", (skip) => {
  expect(parseConfiguredFilters([
    "filter.lfs.clean\ngit-lfs clean -- %f",
    `filter.lfs.smudge\ngit-lfs smudge ${skip ? "--skip " : ""}-- %f`,
    `filter.lfs.process\ngit-lfs filter-process${skip ? " --skip" : ""}`,
    "filter.lfs.required\ntrue"
  ].join("\0"))).toEqual({ lfsConfigured: true, unknownFilterNames: [] });
});

it.each([
  "git-lfs filter-process; echo extra",
  "git-lfs filter-process\nfilter.lfs.required true",
  "wrapper git-lfs filter-process",
  "git-lfs filter-process\r"
])("does not admit shell extensions to an LFS command: %s", (command) => {
  expect(parseConfiguredFilters(`filter.lfs.process\n${command}\0`)).toEqual({
    lfsConfigured: true, unknownFilterNames: ["lfs"]
  });
});
