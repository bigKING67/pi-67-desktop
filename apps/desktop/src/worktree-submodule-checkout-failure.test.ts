import { GitInspectionError } from "./worktree-git-contract.js";
import { RepositoryMutationScheduler } from "./repository-mutation-scheduler.js";
import { WorktreeStartupReconcileService } from "./worktree-startup-reconcile-service.js";
import { RepositoryWorktreeActionService } from "./repository-worktree-action-service.js";
import { RepositoryActionFenceStore } from "./repository-action-fence-store.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it, vi } from "vitest";
import { cleanupCreationFixtures, creationFixture, runSystemGit } from "./worktree-creation-test-fixture.js";

it.each(["local-only", "network-explicit", "cancelled"] as const)("handles failed initial checkout in %s", async (mode) => {
  const fixture = await creationFixture();
  try {
    const root = dirname(fixture.repository);
    const module = join(root, "module");
    const template = join(root, "template");
    const config = join(root, "fixture.gitconfig");
    await mkdir(module);
    await mkdir(template);
    await runSystemGit(module, ["init"]);
    await writeFile(join(module, "payload.txt"), "expected content");
    await runSystemGit(module, ["add", "."]);
    await runSystemGit(module, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "module"]);
    await runSystemGit(fixture.repository, ["-c", "protocol.file.allow=always", "submodule", "add", module, "child"]);
    await runSystemGit(fixture.repository, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-am", "parent"]);
    await writeFile(join(template, "index.lock"), "fixture checkout lock");
    await runSystemGit(fixture.repository, ["config", "--file", config, "init.templateDir", template]);
    vi.stubEnv("GIT_CONFIG_GLOBAL", config);
    if (mode !== "network-explicit") {
      if (mode === "cancelled") {
        vi.spyOn(fixture.runner, "initializeSubmodules").mockRejectedValueOnce(
          new GitInspectionError("submodule-update", "cancelled", {
            cleanupConfirmed: true, repositoryStateConfirmed: false
          })
        );
      }
      const result = await fixture.service.create({ requestId: "request-failure", creationId: "creation-failure", sourceWorkspaceId: fixture.source.id });
      expect(result).toMatchObject({ status: "rejected", error: { code: mode === "cancelled" ? "cancelled" : "rollback-protected" } });
      if (mode === "cancelled") expect(await fixture.runner.listWorktrees(fixture.repository)).toHaveLength(1);
    } else {
      await runSystemGit(fixture.repository, ["submodule", "deinit", "-f", "--", "child"]);
      await writeFile(join(fixture.repository, ".git/modules/child/index.lock"), "fixture checkout lock");
      const userData = join(root, "user-data");
      const actions = new RepositoryWorktreeActionService({ ...fixture, userData });
      const snapshot = await fixture.inspection.inspect({ workspaceId: fixture.source.id });
      const repositoryId = snapshot.repository!.repositoryGroupId;
      const result = await actions.initializeSubmodules({ workspaceId: fixture.source.id, mode });
      const payloadExists = await readFile(join(fixture.repository, "child/payload.txt")).then(() => true, () => false);
      const fences = await new RepositoryActionFenceStore(userData).load();
      expect(result).toMatchObject({ status: "rejected", error: "git-failed" });
      expect(fences).toEqual([repositoryId]);
      expect(fixture.scheduler.isFenced(repositoryId)).toBe(true);
      await expect(actions.initializeSubmodules({ workspaceId: fixture.source.id, mode })).resolves.toMatchObject({ status: "rejected", error: "repository-stale" });
      const restarted = new RepositoryMutationScheduler();
      await new WorktreeStartupReconcileService({ ...fixture, userData, scheduler: restarted }).reconcile();
      expect(restarted.isFenced(repositoryId)).toBe(true);
      await expect(restarted.run(repositoryId, async () => undefined)).rejects.toMatchObject({ code: "repository-indeterminate" });
      expect(payloadExists).toBe(false);
    }

  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await cleanupCreationFixtures();
  }
}, 60_000);
