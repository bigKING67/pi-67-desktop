import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopToolchain } from "./desktop-toolchain.js";
import { RepositoryMutationScheduler } from "./repository-mutation-scheduler.js";
import { addOrRefreshWorkspace, WorkbenchStateStore } from "./workbench-state.js";
import { advanceEnvironmentMutation } from "./workbench-state-mutations.js";
import { WorktreeCatalogStore } from "./worktree-catalog-store.js";
import { WorktreeCreationService } from "./worktree-creation-service.js";
import { BoundedPrivateGitRunner, GitInspectionError } from "./worktree-git-runner.js";
import { WorktreeInspectionService } from "./worktree-inspection-service.js";
import { createNativeWorkspaceDescriptor } from "./workspace-identity.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const REAL_GIT_TEST_TIMEOUT_MS = 15_000;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WorktreeCreationService", () => {
  it("creates one app-owned Worktree transaction and replays the caller-stable receipt", async () => {
    const fixture = await creationFixture();
    const request = {
      requestId: "request-1",
      creationId: "creation-1",
      sourceWorkspaceId: fixture.source.id
    };

    const first = await fixture.service.create(request);
    const replay = await fixture.service.create(request);

    expect(first).toMatchObject({
      status: "created",
      receipt: {
        requestId: request.requestId,
        creationId: request.creationId,
        sourceWorkspaceId: fixture.source.id,
        state: "workspace-registered",
        workspace: {
          id: "workspace-created",
          trust: "trusted",
          trustProvenance: "indirect",
          availability: "available"
        }
      }
    });
    expect(replay).toEqual(first);
    const state = (await fixture.workbenchState.load()).state;
    expect(state.environmentMutations).toMatchObject([{
      creationId: "creation-1",
      state: "workspace-registered",
      workspaceId: "workspace-created"
    }]);
    expect(state.workspaceEnvironments).toMatchObject([
      { workspaceId: fixture.source.id, kind: "repository-primary", ownership: "user" },
      {
        workspaceId: "workspace-created",
        kind: "repository-worktree",
        ownership: "app",
        creationId: "creation-1"
      }
    ]);
    expect(await fixture.runner.listWorktrees(fixture.repository)).toHaveLength(2);
    await expect(fixture.service.create({ ...request, requestId: "request-other" })).resolves.toMatchObject({
      status: "rejected",
      error: { stage: "request", code: "invalid-request", recoverable: false }
    });
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("blocks unknown filters before reserving durable state or invoking Worktree mutation", async () => {
    const fixture = await creationFixture();
    await runSystemGit(fixture.repository, ["config", "filter.generated.smudge", "generate-file"]);

    await expect(fixture.service.create({
      requestId: "request-filter",
      creationId: "creation-filter",
      sourceWorkspaceId: fixture.source.id
    })).resolves.toMatchObject({
      status: "rejected",
      error: { stage: "preflight", code: "custom-filter", recoverable: true }
    });
    expect((await fixture.workbenchState.load()).state.environmentMutations).toEqual([]);
    expect(await fixture.runner.listWorktrees(fixture.repository)).toHaveLength(1);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("reports checkout activity and cancels queued Git work through the normal rollback contract", async () => {
    const fixture = await creationFixture();
    vi.spyOn(fixture.runner, "addWorktree").mockImplementationOnce(async (_input, signal) => {
      await new Promise<void>((_resolve, reject) => {
        const cancelled = () => reject(new GitInspectionError(
          "worktree-add",
          "cancelled",
          { cleanupConfirmed: true }
        ));
        if (signal?.aborted) cancelled();
        else signal?.addEventListener("abort", cancelled, { once: true });
      });
    });
    const request = {
      requestId: "request-cancel",
      creationId: "creation-cancel",
      sourceWorkspaceId: fixture.source.id
    };
    const pending = fixture.service.create(request);
    await vi.waitFor(() => expect(fixture.service.activity({ creationId: request.creationId })).toMatchObject({
      status: "active",
      activity: { stage: "checkout", budgetMs: 300_000, cancellable: true }
    }), { timeout: 10_000 });

    expect(fixture.service.cancel({ creationId: request.creationId })).toEqual({ status: "cancel-requested" });
    await expect(pending).resolves.toMatchObject({
      status: "rejected",
      error: { stage: "git", code: "cancelled", recoverable: true }
    });
    expect(fixture.service.activity({ creationId: request.creationId })).toEqual({ status: "inactive" });
    expect((await fixture.workbenchState.load()).state.environmentMutations).toMatchObject([{
      creationId: request.creationId,
      state: "rolled-back"
    }]);
    expect(await fixture.runner.listWorktrees(fixture.repository)).toHaveLength(1);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("advances Host and Session milestones one durable step at a time with idempotent replay", async () => {
    const fixture = await creationFixture();
    await fixture.service.create({
      requestId: "request-progress",
      creationId: "creation-progress",
      sourceWorkspaceId: fixture.source.id
    });

    await expect(fixture.service.advance({
      creationId: "creation-progress",
      targetState: "workspace-registered"
    })).resolves.toMatchObject({
      status: "advanced",
      receipt: { state: "workspace-registered", workspaceId: "workspace-created" }
    });
    await expect(fixture.service.advance({
      creationId: "creation-progress",
      targetState: "host-registering"
    })).resolves.toMatchObject({ status: "advanced", receipt: { state: "host-registering" } });
    await expect(fixture.service.advance({
      creationId: "creation-progress",
      targetState: "host-registered"
    })).resolves.toMatchObject({ status: "advanced", receipt: { state: "host-registered" } });
    await expect(fixture.service.advance({
      creationId: "creation-progress",
      targetState: "session-bound",
      sessionFileIdentity: "session-file-1"
    })).resolves.toMatchObject({
      status: "rejected",
      error: { stage: "state", code: "recovery-required" }
    });
    await expect(fixture.service.advance({
      creationId: "creation-progress",
      targetState: "session-materializing"
    })).resolves.toMatchObject({ status: "advanced", receipt: { state: "session-materializing" } });
    const bound = await fixture.service.advance({
      creationId: "creation-progress",
      targetState: "session-bound",
      sessionFileIdentity: "session-file-1"
    });
    await expect(fixture.service.advance({
      creationId: "creation-progress",
      targetState: "session-bound",
      sessionFileIdentity: "session-file-1"
    })).resolves.toEqual(bound);
    await expect(fixture.service.advance({
      creationId: "creation-progress",
      targetState: "session-bound",
      sessionFileIdentity: "session-file-other"
    })).resolves.toMatchObject({
      status: "rejected",
      error: { stage: "request", code: "invalid-request", recoverable: false }
    });
    await expect(fixture.service.advance({
      creationId: "creation-progress",
      targetState: "committed"
    })).resolves.toMatchObject({
      status: "advanced",
      receipt: {
        state: "committed",
        sessionFileIdentity: "session-file-1"
      }
    });
    await expect(fixture.service.advance({
      creationId: "creation-progress",
      targetState: "host-registered"
    })).resolves.toMatchObject({
      status: "advanced",
      receipt: {
        state: "committed",
        sessionFileIdentity: "session-file-1"
      }
    });
    expect((await fixture.workbenchState.load()).state.environmentMutations).toMatchObject([{
      creationId: "creation-progress",
      state: "committed",
      sessionFileIdentity: "session-file-1"
    }]);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("rolls back the exact clean branch and path when downstream Workspace identity creation fails", async () => {
    const fixture = await creationFixture({ createWorkspaceId: () => "invalid workspace id" });

    await expect(fixture.service.create({
      requestId: "request-rollback",
      creationId: "creation-rollback",
      sourceWorkspaceId: fixture.source.id
    })).resolves.toMatchObject({
      status: "rejected",
      error: { stage: "git", code: "git-failed", recoverable: true }
    });
    expect((await fixture.workbenchState.load()).state.environmentMutations).toMatchObject([{
      creationId: "creation-rollback",
      state: "rolled-back"
    }]);
    expect(await fixture.runner.listWorktrees(fixture.repository)).toHaveLength(1);
    await expect(fixture.runner.resolveBranchHead(
      fixture.repository,
      "pi67/task-a1b2c3d4e5f6g7h8"
    )).resolves.toBeUndefined();
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("explicitly rolls back only the exact clean pre-Host Workspace and replays the durable receipt", async () => {
    const fixture = await creationFixture();
    const request = {
      requestId: "request-explicit-rollback",
      creationId: "creation-explicit-rollback",
      sourceWorkspaceId: fixture.source.id
    };
    const created = await fixture.service.create(request);
    if (created.status !== "created") throw new Error("Expected Worktree creation to succeed.");

    const first = await fixture.service.rollback(request);
    const replay = await fixture.service.rollback(request);

    expect(first).toEqual({
      status: "rolled-back",
      receipt: { ...request, state: "rolled-back" }
    });
    expect(replay).toEqual(first);
    const state = (await fixture.workbenchState.load()).state;
    expect(state.environmentMutations).toMatchObject([{
      creationId: request.creationId,
      state: "rolled-back",
      rollbackSafety: "pre-host-confirmed"
    }]);
    expect(state.environmentMutations[0]?.workspaceId).toBeUndefined();
    expect(state.workspaces.some((workspace) => workspace.id === created.receipt.workspace.id)).toBe(false);
    expect(state.workspaceEnvironments.some((binding) => binding.creationId === request.creationId)).toBe(false);
    expect(await fixture.runner.listWorktrees(fixture.repository)).toHaveLength(1);
    await expect(fixture.runner.resolveBranchHead(
      fixture.repository,
      "pi67/task-a1b2c3d4e5f6g7h8"
    )).resolves.toBeUndefined();
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("protects a dirty explicit rollback without deleting its Worktree or branch", async () => {
    const fixture = await creationFixture();
    const request = {
      requestId: "request-dirty-rollback",
      creationId: "creation-dirty-rollback",
      sourceWorkspaceId: fixture.source.id
    };
    const created = await fixture.service.create(request);
    if (created.status !== "created") throw new Error("Expected Worktree creation to succeed.");
    await writeFile(join(created.receipt.workspace.identity.canonicalPath, "dirty.txt"), "dirty");

    await expect(fixture.service.rollback(request)).resolves.toMatchObject({
      status: "rejected",
      error: { stage: "rollback", code: "rollback-protected", recoverable: false }
    });
    expect((await fixture.workbenchState.load()).state.environmentMutations).toMatchObject([{
      creationId: request.creationId,
      state: "rollback-protected",
      rollbackSafety: "pre-host-confirmed"
    }]);
    expect(fixture.scheduler.isFenced((await fixture.inspection.inspect({
      workspaceId: fixture.source.id
    })).repository?.repositoryGroupId ?? "missing")).toBe(true);
    expect(await fixture.runner.listWorktrees(fixture.repository)).toHaveLength(2);
    await expect(fixture.runner.resolveBranchHead(
      fixture.repository,
      "pi67/task-a1b2c3d4e5f6g7h8"
    )).resolves.toBeDefined();
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("refuses rollback after Main has authorized Host registration", async () => {
    const fixture = await creationFixture();
    const request = {
      requestId: "request-host-authority",
      creationId: "creation-host-authority",
      sourceWorkspaceId: fixture.source.id
    };
    await fixture.service.create(request);
    await fixture.service.advance({ creationId: request.creationId, targetState: "host-registering" });

    await expect(fixture.service.rollback(request)).resolves.toMatchObject({
      status: "rejected",
      error: { stage: "state", code: "recovery-required", recoverable: true }
    });
    expect((await fixture.workbenchState.load()).state.environmentMutations).toMatchObject([{
      creationId: request.creationId,
      state: "host-registering"
    }]);
    expect(await fixture.runner.listWorktrees(fixture.repository)).toHaveLength(2);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("fences an explicit rollback when Git cleanup outcome is indeterminate", async () => {
    const fixture = await creationFixture();
    const request = {
      requestId: "request-unknown-cleanup",
      creationId: "creation-unknown-cleanup",
      sourceWorkspaceId: fixture.source.id
    };
    await fixture.service.create(request);
    vi.spyOn(fixture.runner, "removeWorktree").mockRejectedValueOnce(new GitInspectionError(
      "worktree-remove",
      "timeout",
      { cleanupConfirmed: false }
    ));

    await expect(fixture.service.rollback(request)).resolves.toMatchObject({
      status: "rejected",
      error: { stage: "git", code: "repository-indeterminate", recoverable: true }
    });
    const state = (await fixture.workbenchState.load()).state;
    expect(state.environmentMutations).toMatchObject([{
      creationId: request.creationId,
      state: "indeterminate",
      rollbackSafety: "pre-host-confirmed"
    }]);
    expect(fixture.scheduler.isFenced(state.environmentMutations[0]!.repositoryGroupId)).toBe(true);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("resumes an explicit branch-only rollback but rejects mismatched caller identity", async () => {
    const fixture = await creationFixture();
    const request = {
      requestId: "request-branch-only",
      creationId: "creation-branch-only",
      sourceWorkspaceId: fixture.source.id
    };
    const created = await fixture.service.create(request);
    if (created.status !== "created") throw new Error("Expected Worktree creation to succeed.");
    await fixture.workbenchState.update((state) => advanceEnvironmentMutation(
      state,
      request.creationId,
      "rollback-pending",
      41,
      { rollbackSafety: "pre-host-confirmed" }
    ));
    await fixture.runner.removeWorktree(fixture.repository, created.receipt.workspace.identity.canonicalPath);

    await expect(fixture.service.rollback({ ...request, requestId: "request-other" })).resolves.toMatchObject({
      status: "rejected",
      error: { stage: "request", code: "invalid-request", recoverable: false }
    });
    await expect(fixture.service.rollback(request)).resolves.toMatchObject({ status: "rolled-back" });
    await expect(fixture.runner.resolveBranchHead(
      fixture.repository,
      "pi67/task-a1b2c3d4e5f6g7h8"
    )).resolves.toBeUndefined();
    expect((await fixture.workbenchState.load()).state.environmentMutations).toMatchObject([{
      creationId: request.creationId,
      state: "rolled-back"
    }]);
  }, REAL_GIT_TEST_TIMEOUT_MS);
});

async function creationFixture(options: { createWorkspaceId?: () => string } = {}) {
  const root = await temporaryRoot();
  const userData = join(root, "user-data");
  const repository = join(root, "主仓库");
  await mkdir(userData);
  await mkdir(repository);
  await runSystemGit(repository, ["init"]);
  await runSystemGit(repository, [
    "-c", "user.name=Pi-67",
    "-c", "user.email=pi67@example.invalid",
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
  const service = new WorktreeCreationService({
    userData,
    runner,
    scheduler,
    workbenchState,
    inspection,
    now: () => 40,
    createToken: () => "a1b2c3d4e5f6g7h8",
    createWorkspaceId: options.createWorkspaceId ?? (() => "workspace-created")
  });
  return {
    repository: await realpath(repository),
    source,
    workbenchState,
    runner,
    scheduler,
    inspection,
    service
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-worktree-creation-"));
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
