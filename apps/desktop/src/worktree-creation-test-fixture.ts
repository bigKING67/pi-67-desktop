import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DesktopToolchain } from "./desktop-toolchain.js";
import { RepositoryMutationScheduler } from "./repository-mutation-scheduler.js";
import { addOrRefreshWorkspace, WorkbenchStateStore } from "./workbench-state.js";
import { WorktreeCatalogStore } from "./worktree-catalog-store.js";
import { WorktreeCreationService } from "./worktree-creation-service.js";
import { BoundedPrivateGitRunner } from "./worktree-git-runner.js";
import { WorktreeInspectionService } from "./worktree-inspection-service.js";
import { createNativeWorkspaceDescriptor } from "./workspace-identity.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
export async function cleanupCreationFixtures() {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export async function creationFixture(options: { createWorkspaceId?: () => string } = {}) {
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

export async function runSystemGit(cwd: string, arguments_: string[]): Promise<void> {
  await execFileAsync("git", arguments_, { cwd, encoding: "utf8" });
}
