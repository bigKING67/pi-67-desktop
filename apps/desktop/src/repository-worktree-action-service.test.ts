import { WorktreeStartupReconcileService } from "./worktree-startup-reconcile-service.js";
import { RepositoryActionFenceStore } from "./repository-action-fence-store.js";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopToolchain } from "./desktop-toolchain.js";
import { RepositoryMutationScheduler } from "./repository-mutation-scheduler.js";
import { RepositoryWorktreeActionService } from "./repository-worktree-action-service.js";
import {
  addOrRefreshWorkspace,
  replaceWorkspaceRegistrations,
  WorkbenchStateStore
} from "./workbench-state.js";
import { WorktreeCatalogStore } from "./worktree-catalog-store.js";
import { WorktreeCreationService } from "./worktree-creation-service.js";
import { BoundedPrivateGitRunner, GitInspectionError } from "./worktree-git-runner.js";
import { WorktreeInspectionService } from "./worktree-inspection-service.js";
import { createNativeWorkspaceDescriptor } from "./workspace-identity.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const REAL_GIT_TEST_TIMEOUT_MS = 20_000;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("RepositoryWorktreeActionService", () => {
  it("rejects late custom filters before removing the missing Worktree registration", async () => {
    const fixture = await actionFixture();
    await writeFile(join(fixture.repository, ".gitattributes"), "payload.bin filter=lfs\n");
    await writeFile(join(fixture.repository, "payload.bin"), "fixture\n");
    await runSystemGit(fixture.repository, ["add", "--", ".gitattributes", "payload.bin"]);
    await runSystemGit(fixture.repository, ["-c", "user.name=Pi-67", "-c", "user.email=pi67@example.invalid", "commit", "-m", "fixture"]);
    const created = await createCommittedWorktree(fixture);
    if (created.status !== "created") throw new Error("Expected created");
    const target = created.receipt.workspace.identity.canonicalPath;
    await rm(target, {recursive:true,force:true});
    await fixture.workbenchState.update(state => replaceWorkspaceRegistrations(state,
      state.workspaces.map(w => w.id === created.receipt.workspace.id ? {...w,availability:"missing" as const}:w)));
    const marker = join(fixture.repository, ".git", "recovery-marker");
    await runSystemGit(fixture.repository, ["config", "filter.lfs.smudge", `printf controlled > '${marker}'; cat`]);
    const remove = vi.spyOn(fixture.runner, "removeWorktree");
    const restore = vi.spyOn(fixture.runner, "restoreWorktree");
    const result = await fixture.actions.recoverAppOwnedWorktree({workspaceId:created.receipt.workspace.id,confirmation:"recreate-committed-state"});
    expect(result).toMatchObject({status:"rejected",error:"git-failed"});
    expect(remove).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    await expect(access(marker)).rejects.toMatchObject({code:"ENOENT"});
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it.each([false, true])("persists only unconfirmed explicit submodule cleanup: %s", async (cleanupConfirmed) => {
    const fixture = await actionFixture();
    vi.spyOn(fixture.runner, "inspectSubmodules").mockResolvedValue({status:"incomplete",total:1,uninitialized:1,divergent:0,conflicted:0});
    const initialize = vi.spyOn(fixture.runner, "initializeSubmodules").mockRejectedValue(
      new GitInspectionError("submodule-update", "process-failed", {cleanupConfirmed}));
    const snapshot = await fixture.inspection.inspect({workspaceId:fixture.source.id});
    const repositoryId = snapshot.repository!.repositoryGroupId;
    const result = await fixture.actions.initializeSubmodules({workspaceId:fixture.source.id,mode:"network-explicit"});
    expect(result.status).toBe(cleanupConfirmed ? "incomplete" : "rejected");
    expect(fixture.scheduler.isFenced(repositoryId)).toBe(!cleanupConfirmed);
    expect(await new RepositoryActionFenceStore(fixture.userData).load()).toEqual(cleanupConfirmed ? [] : [repositoryId]);
    const restarted = new RepositoryMutationScheduler();
    await new WorktreeStartupReconcileService({userData:fixture.userData,runner:fixture.runner,scheduler:restarted,workbenchState:fixture.workbenchState}).reconcile();
    expect(restarted.isFenced(repositoryId)).toBe(!cleanupConfirmed);
    if (!cleanupConfirmed) {
      await expect(restarted.run(repositoryId, async () => undefined)).rejects.toMatchObject({code:"repository-indeterminate"});
      await fixture.actions.initializeSubmodules({workspaceId:fixture.source.id,mode:"network-explicit"});
      expect(initialize).toHaveBeenCalledTimes(1);
    }
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it.each(["begin", "complete"] as const)("fails closed when the action marker cannot %s", async (stage) => {
    const fixture = await actionFixture();
    vi.spyOn(fixture.runner, "inspectSubmodules").mockResolvedValue({
      status: "incomplete", total: 1, uninitialized: 1, divergent: 0, conflicted: 0
    });
    const initialize = vi.spyOn(fixture.runner, "initializeSubmodules").mockResolvedValue(undefined);
    const snapshot = await fixture.inspection.inspect({ workspaceId: fixture.source.id });
    const repositoryId = snapshot.repository!.repositoryGroupId;
    if (stage === "begin") {
      await writeFile(join(fixture.userData, "repository-action-fences"), "unavailable-directory");
    }
    const complete = stage === "complete"
      ? vi.spyOn(RepositoryActionFenceStore.prototype, "complete").mockRejectedValueOnce(
          Object.assign(new Error("Controlled marker removal failure"), { code: "EACCES" }))
      : undefined;
    try {
      await expect(fixture.actions.initializeSubmodules({
        workspaceId: fixture.source.id, mode: "network-explicit"
      })).resolves.toMatchObject({ status: "rejected", error: "internal" });
      expect(initialize).toHaveBeenCalledTimes(stage === "begin" ? 0 : 1);
      expect(fixture.scheduler.isFenced(repositoryId)).toBe(true);
      await fixture.actions.initializeSubmodules({ workspaceId: fixture.source.id, mode: "network-explicit" });
      expect(initialize).toHaveBeenCalledTimes(stage === "begin" ? 0 : 1);
      if (stage === "complete") {
        expect(await new RepositoryActionFenceStore(fixture.userData).load()).toEqual([repositoryId]);
        const restarted = new RepositoryMutationScheduler();
        await new WorktreeStartupReconcileService({
          userData: fixture.userData, runner: fixture.runner, scheduler: restarted, workbenchState: fixture.workbenchState
        }).reconcile();
        await expect(restarted.run(repositoryId, async () => undefined))
          .rejects.toMatchObject({ code: "repository-indeterminate" });
      }
    } finally {
      complete?.mockRestore();
    }
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it.each(["removeWorktree", "restoreWorktree"] as const)("retains a persistent fence after unconfirmed recovery %s", async (method) => {
    const fixture = await actionFixture();
    const created = await createCommittedWorktree(fixture);
    if (created.status !== "created") throw new Error("Expected created");
    const target = created.receipt.workspace.identity.canonicalPath;
    await rm(target, { recursive: true, force: true });
    await fixture.workbenchState.update((state) => replaceWorkspaceRegistrations(state,
      state.workspaces.map((workspace) => workspace.id === created.receipt.workspace.id
        ? { ...workspace, availability: "missing" as const } : workspace)));
    const repositoryId = (await fixture.workbenchState.load()).state.environmentMutations[0]!.repositoryGroupId;
    const failing = vi.spyOn(fixture.runner, method).mockRejectedValueOnce(new GitInspectionError(
      method === "removeWorktree" ? "worktree-remove" : "worktree-add", "timeout", { cleanupConfirmed: false }));
    const request = { workspaceId: created.receipt.workspace.id, confirmation: "recreate-committed-state" as const };
    await expect(fixture.actions.recoverAppOwnedWorktree(request)).resolves.toMatchObject({ status: "rejected", error: "git-failed" });
    expect(fixture.scheduler.isFenced(repositoryId)).toBe(true);
    expect(await new RepositoryActionFenceStore(fixture.userData).load()).toEqual([repositoryId]);
    await expect(fixture.actions.recoverAppOwnedWorktree(request)).resolves.toMatchObject({ status: "rejected" });
    expect(failing).toHaveBeenCalledTimes(1);
    const restarted = new RepositoryMutationScheduler();
    await new WorktreeStartupReconcileService({
      userData: fixture.userData, runner: fixture.runner, scheduler: restarted, workbenchState: fixture.workbenchState
    }).reconcile();
    await expect(restarted.run(repositoryId, async () => undefined)).rejects.toMatchObject({ code: "repository-indeterminate" });
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("explicitly recreates only a committed app-owned missing Worktree and preserves its branch", async () => {
    const fixture = await actionFixture();
    const created = await createCommittedWorktree(fixture);
    if (created.status !== "created") throw new Error("Expected a created Worktree.");
    const targetPath = created.receipt.workspace.identity.canonicalPath;
    const branchName = (await fixture.workbenchState.load()).state.environmentMutations[0]!.branchName;
    const branchHead = await fixture.runner.resolveBranchHead(fixture.repository, branchName);
    await rm(targetPath, { recursive: true, force: true });
    await fixture.workbenchState.update((state) => replaceWorkspaceRegistrations(
      state,
      state.workspaces.map((workspace) => workspace.id === created.receipt.workspace.id
        ? { ...workspace, availability: "missing" as const }
        : workspace)
    ));

    await expect(fixture.inspection.inspect({ workspaceId: created.receipt.workspace.id })).resolves.toMatchObject({
      status: "missing",
      recovery: {
        kind: "app-owned-worktree",
        action: "recreate-committed-state",
        unrecoverableData: "uncommitted-and-untracked"
      }
    });
    const removeRegistration = vi.spyOn(fixture.runner, "removeWorktree");
    await expect(fixture.actions.recoverAppOwnedWorktree({
      workspaceId: created.receipt.workspace.id,
      confirmation: "recreate-committed-state"
    })).resolves.toMatchObject({
      status: "recovered",
      workspace: { id: created.receipt.workspace.id, availability: "available", trust: "trusted" }
    });

    expect(removeRegistration).toHaveBeenCalledOnce();
    expect(removeRegistration).toHaveBeenCalledWith(fixture.repository, targetPath);
    await expect(fixture.runner.resolveBranchHead(fixture.repository, branchName)).resolves.toBe(branchHead);
    await expect(fixture.runner.statusPorcelain(targetPath)).resolves.toBe("");
    expect((await fixture.workbenchState.load()).state.workspaces.find((workspace) => (
      workspace.id === created.receipt.workspace.id
    ))).toMatchObject({ availability: "available", trustProvenance: "indirect" });
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("fails closed instead of replacing a foreign directory at the app-owned target", async () => {
    const fixture = await actionFixture();
    const created = await createCommittedWorktree(fixture);
    if (created.status !== "created") throw new Error("Expected a created Worktree.");
    const targetPath = created.receipt.workspace.identity.canonicalPath;
    await rm(targetPath, { recursive: true, force: true });
    await mkdir(targetPath, { recursive: true });
    await fixture.workbenchState.update((state) => replaceWorkspaceRegistrations(
      state,
      state.workspaces.map((workspace) => workspace.id === created.receipt.workspace.id
        ? { ...workspace, availability: "missing" as const }
        : workspace)
    ));

    await expect(fixture.actions.recoverAppOwnedWorktree({
      workspaceId: created.receipt.workspace.id,
      confirmation: "recreate-committed-state"
    })).resolves.toEqual({ status: "rejected", error: "identity-changed", recoverable: false });
    expect(await fixture.runner.listWorktrees(fixture.repository)).toHaveLength(2);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("reconciles an exact restored Worktree when the prior state write failed", async () => {
    const fixture = await actionFixture();
    const created = await createCommittedWorktree(fixture);
    if (created.status !== "created") throw new Error("Expected a created Worktree.");
    const targetPath = created.receipt.workspace.identity.canonicalPath;
    await rm(targetPath, { recursive: true, force: true });
    await fixture.workbenchState.update((state) => replaceWorkspaceRegistrations(
      state,
      state.workspaces.map((workspace) => workspace.id === created.receipt.workspace.id
        ? { ...workspace, availability: "missing" as const }
        : workspace)
    ));
    let rejectNextUpdate = true;
    const actionsWithFailedStateWrite = new RepositoryWorktreeActionService({
      userData: fixture.userData,
      runner: fixture.runner,
      scheduler: fixture.scheduler,
      inspection: fixture.inspection,
      workbenchState: {
        load: () => fixture.workbenchState.load(),
        update: (updater) => {
          if (rejectNextUpdate) {
            rejectNextUpdate = false;
            return Promise.reject(new Error("simulated state write failure"));
          }
          return fixture.workbenchState.update(updater);
        }
      },
      now: () => 50
    });
    const removeRegistration = vi.spyOn(fixture.runner, "removeWorktree");

    await expect(actionsWithFailedStateWrite.recoverAppOwnedWorktree({
      workspaceId: created.receipt.workspace.id,
      confirmation: "recreate-committed-state"
    })).resolves.toEqual({ status: "rejected", error: "internal", recoverable: true });
    await expect(fixture.runner.statusPorcelain(targetPath)).resolves.toBe("");
    expect((await fixture.workbenchState.load()).state.workspaces.find((workspace) => (
      workspace.id === created.receipt.workspace.id
    ))?.availability).toBe("missing");

    await expect(fixture.actions.recoverAppOwnedWorktree({
      workspaceId: created.receipt.workspace.id,
      confirmation: "recreate-committed-state"
    })).resolves.toMatchObject({ status: "recovered", workspace: { id: created.receipt.workspace.id } });
    expect(removeRegistration).toHaveBeenCalledOnce();
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it.each(["source-trust", "source-missing", "target-available"] as const)("rejects recovery after queued authority drift: %s", async (drift) => {
    const fixture = await actionFixture();
    const created = await createCommittedWorktree(fixture);
    if (created.status !== "created") throw new Error("Expected a created Worktree.");
    await rm(created.receipt.workspace.identity.canonicalPath, { recursive: true, force: true });
    await fixture.workbenchState.update((state) => replaceWorkspaceRegistrations(state,
      state.workspaces.map((workspace) => workspace.id === created.receipt.workspace.id
        ? { ...workspace, availability: "missing" as const } : workspace)));
    const group = (await fixture.workbenchState.load()).state.environmentMutations[0]!.repositoryGroupId;
    let release!: () => void;
    const blocker = fixture.scheduler.run(group, () => new Promise<void>((resolve) => { release = resolve; }));
    const restore = vi.spyOn(fixture.runner, "restoreWorktree");
    const remove = vi.spyOn(fixture.runner, "removeWorktree");
    const recovery = fixture.actions.recoverAppOwnedWorktree({
      workspaceId: created.receipt.workspace.id, confirmation: "recreate-committed-state"
    });
    try {
      await vi.waitFor(() => expect(fixture.scheduler.diagnostics().queuedCount).toBe(1));
      await fixture.workbenchState.update((state) => replaceWorkspaceRegistrations(state,
        state.workspaces.map((workspace) => {
          if (drift === "target-available" && workspace.id === created.receipt.workspace.id) {
            return { ...workspace, availability: "available" as const };
          }
          if (workspace.id !== fixture.source.id) return workspace;
          if (drift === "source-trust") return { ...workspace, trust: "untrusted" as const };
          if (drift === "source-missing") return { ...workspace, availability: "missing" as const };
          return workspace;
        })));
    } finally {
      release();
      await blocker;
    }
    await expect(recovery).resolves.toMatchObject({ status: "rejected" });
    expect(restore).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("uses network-capable Submodule Git only after the exact explicit action", async () => {
    const fixture = await actionFixture();
    const inspect = vi.spyOn(fixture.runner, "inspectSubmodules")
      .mockResolvedValueOnce({ status: "incomplete", total: 1, uninitialized: 1, divergent: 0, conflicted: 0 })
      .mockResolvedValueOnce({ status: "incomplete", total: 1, uninitialized: 1, divergent: 0, conflicted: 0 })
      .mockResolvedValueOnce({ status: "complete", total: 1, uninitialized: 0, divergent: 0, conflicted: 0 });
    const initialize = vi.spyOn(fixture.runner, "initializeSubmodules").mockResolvedValueOnce(undefined);

    await expect(fixture.actions.initializeSubmodules({
      workspaceId: fixture.source.id,
      mode: "network-explicit"
    })).resolves.toMatchObject({ status: "initialized", submodules: { status: "complete" } });
    expect(initialize).toHaveBeenCalledWith(fixture.repository, "network-explicit");
    expect(inspect).toHaveBeenCalledTimes(3);
  }, REAL_GIT_TEST_TIMEOUT_MS);
});

async function actionFixture() {
  const root = await temporaryRoot();
  const userData = join(root, "user-data");
  const repository = join(root, "repository");
  await mkdir(userData);
  await mkdir(repository);
  await runSystemGit(repository, ["init"]);
  await runSystemGit(repository, [
    "-c", "user.name=Pi-67", "-c", "user.email=pi67@example.invalid",
    "commit", "--allow-empty", "-m", "initial"
  ]);
  const source = await createNativeWorkspaceDescriptor(repository, {
    createId: () => "workspace-source",
    now: () => 10
  });
  const workbenchState = new WorkbenchStateStore(userData, {
    now: () => 20,
    createToken: () => "state-token"
  });
  await workbenchState.update((state) => addOrRefreshWorkspace(state, source).state);
  const runner = new BoundedPrivateGitRunner(await systemGitToolchain(root));
  const inspection = new WorktreeInspectionService({
    runner,
    workbenchState,
    catalog: new WorktreeCatalogStore(userData, { now: () => 30, createToken: () => "catalog-token" }),
    now: () => 30
  });
  const scheduler = new RepositoryMutationScheduler();
  const creation = new WorktreeCreationService({
    userData,
    runner,
    scheduler,
    workbenchState,
    inspection,
    now: () => 40,
    createToken: () => "0123456789abcdef",
    createWorkspaceId: () => "workspace-created"
  });
  const actions = new RepositoryWorktreeActionService({
    userData,
    runner,
    scheduler,
    workbenchState,
    inspection,
    now: () => 50
  });
  return {
    userData,
    repository: await realpath(repository),
    source,
    workbenchState,
    runner,
    inspection,
    scheduler,
    creation,
    actions
  };
}

async function createCommittedWorktree(fixture: Awaited<ReturnType<typeof actionFixture>>) {
  const result = await fixture.creation.create({
    requestId: "request-create",
    creationId: "creation-create",
    sourceWorkspaceId: fixture.source.id
  });
  if (result.status !== "created") return result;
  for (const targetState of [
    "host-registering",
    "host-registered",
    "session-materializing"
  ] as const) {
    await fixture.creation.advance({ creationId: "creation-create", targetState });
  }
  await fixture.creation.advance({
    creationId: "creation-create",
    targetState: "session-bound",
    sessionFileIdentity: "session-created"
  });
  await fixture.creation.advance({ creationId: "creation-create", targetState: "committed" });
  return result;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-worktree-actions-"));
  roots.push(root);
  return root;
}

async function systemGitToolchain(root: string): Promise<DesktopToolchain> {
  const { stdout } = await execFileAsync("git", ["--exec-path"], { encoding: "utf8" });
  return {
    ready: true,
    root,
    packaged: false,
    platform: process.platform === "win32" ? "win32" : "darwin",
    architecture: process.arch === "x64" ? "x64" : "arm64",
    gitExecutable: "git",
    gitExecPath: stdout.trim()
  };
}

async function runSystemGit(cwd: string, arguments_: string[]): Promise<void> {
  await execFileAsync("git", arguments_, { cwd, encoding: "utf8" });
}
