import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { EnvironmentCreationState, EnvironmentMutationRecoveryRecord } from "@pi67/protocol";
import type { DesktopToolchain } from "./desktop-toolchain.js";
import { RepositoryMutationScheduler } from "./repository-mutation-scheduler.js";
import {
  addOrRefreshWorkspace,
  WorkbenchStateStore
} from "./workbench-state.js";
import {
  advanceEnvironmentMutation,
  reserveEnvironmentMutation
} from "./workbench-state-mutations.js";
import { WorktreeCatalogStore } from "./worktree-catalog-store.js";
import { WorktreeCreationService } from "./worktree-creation-service.js";
import { BoundedPrivateGitRunner } from "./worktree-git-runner.js";
import { WorktreeInspectionService } from "./worktree-inspection-service.js";
import { prepareWorktreeProfilePath } from "./worktree-profile-root.js";
import {
  WorktreeStartupReconcileService,
  type WorktreeStartupReconcileServiceOptions
} from "./worktree-startup-reconcile-service.js";
import { createNativeWorkspaceDescriptor } from "./workspace-identity.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

export interface StartupFixture {
  root: string;
  userData: string;
  workbenchState: WorkbenchStateStore;
  catalog: WorktreeCatalogStore;
  runner: BoundedPrivateGitRunner;
}

export interface RepositoryFixture {
  repository: string;
  sourceWorkspaceId: string;
  repositoryGroupId: string;
  headSha: string;
  inspection: WorktreeInspectionService;
}

export async function cleanupStartupFixtures(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export async function startupFixture(): Promise<StartupFixture> {
  const root = await temporaryRoot();
  const userData = join(root, "user-data");
  await mkdir(userData);
  const workbenchState = new WorkbenchStateStore(userData, {
    now: () => 20,
    createToken: () => "state-token"
  });
  return {
    root,
    userData,
    workbenchState,
    catalog: new WorktreeCatalogStore(userData, { now: () => 30, createToken: () => "catalog-token" }),
    runner: new BoundedPrivateGitRunner(await systemGitToolchain(root))
  };
}

export async function addRepository(
  fixture: StartupFixture,
  directoryName: string,
  sourceWorkspaceId: string
): Promise<RepositoryFixture> {
  const repository = join(fixture.root, directoryName);
  await mkdir(repository);
  await runSystemGit(repository, ["init"]);
  await runSystemGit(repository, [
    "-c", "user.name=Pi-67",
    "-c", "user.email=pi67@example.invalid",
    "commit", "--allow-empty", "-m", "initial"
  ]);
  const source = await createNativeWorkspaceDescriptor(repository, {
    createId: () => sourceWorkspaceId,
    now: () => 10
  });
  await fixture.workbenchState.update((state) => addOrRefreshWorkspace(state, source).state);
  const inspection = new WorktreeInspectionService({
    runner: fixture.runner,
    workbenchState: fixture.workbenchState,
    catalog: fixture.catalog,
    now: () => 30
  });
  const snapshot = await inspection.inspect({ workspaceId: source.id });
  if (snapshot.status !== "ready" || !snapshot.repository) {
    throw new Error("Repository fixture inspection did not become ready.");
  }
  return {
    repository: await realpath(repository),
    sourceWorkspaceId: source.id,
    repositoryGroupId: snapshot.repository.repositoryGroupId,
    headSha: await fixture.runner.resolveHeadSha(repository),
    inspection
  };
}

export async function reserveRecord(
  fixture: StartupFixture,
  repository: RepositoryFixture,
  identity: { creationId: string; worktreeToken: string }
) {
  const prepared = await prepareWorktreeProfilePath(
    fixture.userData,
    repository.repositoryGroupId,
    identity.worktreeToken
  );
  const record: EnvironmentMutationRecoveryRecord = {
    kind: "worktree-creation",
    creationId: identity.creationId,
    requestId: `request-${identity.creationId}`,
    requestFingerprint: "a".repeat(64),
    sourceWorkspaceId: repository.sourceWorkspaceId,
    repositoryGroupId: repository.repositoryGroupId,
    worktreeToken: identity.worktreeToken,
    branchName: `pi67/task-${identity.worktreeToken}`,
    headSha: repository.headSha,
    state: "reserved",
    createdAt: 100,
    updatedAt: 100
  };
  await fixture.workbenchState.update((state) => reserveEnvironmentMutation(state, record));
  return { record, prepared };
}

export async function materializeRecord(
  fixture: StartupFixture,
  repository: RepositoryFixture,
  identity: {
    creationId: string;
    worktreeToken: string;
    state: "git-materializing" | "git-materialized";
  }
) {
  const reserved = await reserveRecord(fixture, repository, identity);
  await transitionRecord(fixture, identity.creationId, "git-materializing");
  await fixture.runner.addWorktree({
    cwd: repository.repository,
    targetPath: reserved.prepared.targetPath,
    branchName: reserved.record.branchName,
    headSha: reserved.record.headSha,
    hooksPath: reserved.prepared.hooksPath
  });
  if (identity.state === "git-materialized") {
    await transitionRecord(fixture, identity.creationId, "git-materialized");
  }
  return reserved;
}

export async function createRegisteredRecord(
  fixture: StartupFixture,
  repository: RepositoryFixture,
  identity: { creationId: string; worktreeToken: string; workspaceId: string }
) {
  const service = new WorktreeCreationService({
    userData: fixture.userData,
    runner: fixture.runner,
    scheduler: new RepositoryMutationScheduler(),
    workbenchState: fixture.workbenchState,
    inspection: repository.inspection,
    now: () => 200,
    createToken: () => identity.worktreeToken,
    createWorkspaceId: () => identity.workspaceId
  });
  const result = await service.create({
    requestId: `request-${identity.creationId}`,
    creationId: identity.creationId,
    sourceWorkspaceId: repository.sourceWorkspaceId
  });
  if (result.status !== "created") throw new Error("Worktree fixture creation failed.");
  return {
    service,
    targetPath: result.receipt.workspace.identity.canonicalPath
  };
}

export async function advanceCreatedRecord(
  service: WorktreeCreationService,
  creationId: string,
  targetState: "host-registering" | "host-registered" | "session-materializing"
): Promise<void> {
  const result = await service.advance({ creationId, targetState });
  if (result.status !== "advanced") throw new Error("Worktree fixture advance failed.");
}

export async function transitionRecord(
  fixture: StartupFixture,
  creationId: string,
  state: EnvironmentCreationState
): Promise<void> {
  await fixture.workbenchState.update((current) => {
    const record = current.environmentMutations.find((candidate) => candidate.creationId === creationId);
    if (!record) throw new Error("Worktree fixture record was not found.");
    return advanceEnvironmentMutation(current, creationId, state, record.updatedAt + 1);
  });
}

export function startupRecovery(
  fixture: StartupFixture,
  options: Pick<WorktreeStartupReconcileServiceOptions, "createWorkspaceId" | "observeIdentity"> = {}
) {
  const scheduler = new RepositoryMutationScheduler();
  return {
    scheduler,
    service: new WorktreeStartupReconcileService({
      userData: fixture.userData,
      runner: fixture.runner,
      scheduler,
      workbenchState: fixture.workbenchState,
      now: () => 500,
      ...options
    })
  };
}

export async function recordState(
  fixture: StartupFixture,
  creationId: string
): Promise<EnvironmentCreationState | undefined> {
  return (await fixture.workbenchState.load()).state.environmentMutations.find((record) => (
    record.creationId === creationId
  ))?.state;
}

export async function runSystemGit(cwd: string, arguments_: string[]): Promise<void> {
  await execFileAsync("git", arguments_, { cwd, encoding: "utf8" });
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-worktree-startup-"));
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
