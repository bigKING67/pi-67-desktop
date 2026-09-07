import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { RepositoryActionFenceStore } from "./repository-action-fence-store.js";
import { RepositoryMutationScheduler } from "./repository-mutation-scheduler.js";
import { WorktreeStartupReconcileService } from "./worktree-startup-reconcile-service.js";
import { cleanupCreationFixtures, creationFixture } from "./worktree-creation-test-fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await cleanupCreationFixtures();
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive:true,force:true})));
});

it("retains interrupted operations and refuses to overwrite their marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi67-action-fence-")); roots.push(root);
  const store = new RepositoryActionFenceStore(root);
  const id = `repo_${"a".repeat(32)}`;
  expect(await store.load()).toEqual([]);
  await store.begin(id);
  await expect(store.begin(id)).rejects.toMatchObject({code:"EEXIST"});
  expect(await new RepositoryActionFenceStore(root).load()).toEqual([id]);
  await store.complete(id);
  expect(await store.load()).toEqual([]);
});

it("disables mutation admission when the startup marker inventory cannot be read", async () => {
  const fixture = await creationFixture();
  const userData = await mkdtemp(join(tmpdir(), "pi67-action-fence-invalid-")); roots.push(userData);
  await writeFile(join(userData,"repository-action-fences"), "invalid-directory");
  const scheduler = new RepositoryMutationScheduler();
  await expect(new WorktreeStartupReconcileService({userData,runner:fixture.runner,scheduler,workbenchState:fixture.workbenchState}).reconcile()).rejects.toThrow();
  await expect(scheduler.run(`repo_${"b".repeat(32)}`,async () => undefined)).rejects.toMatchObject({code:"disposed"});
});
