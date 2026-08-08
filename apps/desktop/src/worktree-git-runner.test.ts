import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { DesktopToolchain } from "./desktop-toolchain.js";
import {
  BoundedPrivateGitRunner,
  GitInspectionError,
  parseConfiguredFilters,
  parseGitWorktreePorcelain
} from "./worktree-git-runner.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const REAL_GIT_TEST_TIMEOUT_MS = 15_000;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Git worktree porcelain parser", () => {
  it("parses primary, linked, detached, locked, and prunable records", () => {
    const records = parseGitWorktreePorcelain([
      "worktree /Users/pi/repository",
      `HEAD ${"a".repeat(40)}`,
      "branch refs/heads/main",
      "",
      "worktree /Users/pi/repository-task",
      `HEAD ${"b".repeat(40)}`,
      "detached",
      "locked maintenance",
      "prunable gitdir file points to non-existent location",
      "",
      ""
    ].join("\0"), "darwin");

    expect(records).toEqual([
      {
        path: "/Users/pi/repository",
        headSha: "a".repeat(40),
        branchName: "main",
        detached: false,
        locked: false,
        prunable: false
      },
      {
        path: "/Users/pi/repository-task",
        headSha: "b".repeat(40),
        detached: true,
        locked: true,
        prunable: true
      }
    ]);
  });

  it("accepts non-ASCII and long Windows paths without normalizing their bytes", () => {
    const path = `C:\\用户\\项目\\${"deep\\".repeat(40)}worktree`;
    const [record] = parseGitWorktreePorcelain([
      `worktree ${path}`,
      `HEAD ${"c".repeat(40)}`,
      "branch refs/heads/feature/windows",
      "",
      ""
    ].join("\0"), "win32");
    expect(record?.path).toBe(path);
    expect(record?.branchName).toBe("feature/windows");
  });

  it("accepts UNC paths and rejects relative or malformed records", () => {
    const [record] = parseGitWorktreePorcelain([
      "worktree \\\\server\\share\\repository",
      `HEAD ${"d".repeat(40)}`,
      "detached",
      "",
      ""
    ].join("\0"), "win32");
    expect(record?.path).toBe("\\\\server\\share\\repository");

    expect(() => parseGitWorktreePorcelain("worktree relative\0\0", "darwin"))
      .toThrow(GitInspectionError);
    expect(() => parseGitWorktreePorcelain("worktree /repo\0unknown field\0\0", "darwin"))
      .toThrow("invalid-output");
  });
});

describe("Git filter parser", () => {
  it("allows only LFS while returning bounded unknown filter names", () => {
    expect(parseConfiguredFilters([
      "filter.lfs.process git-lfs filter-process",
      "filter.lfs.required true",
      "filter.generated.smudge generate-file"
    ].join("\n"))).toEqual({
      lfsConfigured: true,
      unknownFilterNames: ["generated"]
    });
    expect(() => parseConfiguredFilters("credential.helper manager"))
      .toThrow("invalid-output");
  });
});

describe("BoundedPrivateGitRunner", () => {
  it("inspects a real no-origin repository with non-ASCII, spaces and special path characters", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "主 仓库 #1");
    const linked = join(root, "linked worktree [测试]");
    await mkdir(repository);
    await runSystemGit(repository, ["init"]);
    await runSystemGit(repository, ["-c", "user.name=Pi-67", "-c", "user.email=pi67@example.invalid", "commit", "--allow-empty", "-m", "initial"]);
    await runSystemGit(repository, ["worktree", "add", "--detach", linked, "HEAD"]);
    const toolchain = await systemGitToolchain(root);
    const runner = new BoundedPrivateGitRunner(toolchain);
    const canonicalRepository = await realpath(repository);
    const canonicalLinked = await realpath(linked);

    await expect(runner.resolveRepositoryRoot(linked)).resolves.toBe(canonicalLinked);
    await expect(runner.resolveCommonDirectory(linked)).resolves.toContain(join(canonicalRepository, ".git"));
    const records = await runner.listWorktrees(linked);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ path: canonicalRepository, detached: false });
    expect(records[1]).toMatchObject({ path: canonicalLinked, detached: true });
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("fails closed when the private Git toolchain is unavailable", async () => {
    const runner = new BoundedPrivateGitRunner({ ready: false } as DesktopToolchain);
    await expect(runner.resolveRepositoryRoot(process.cwd())).rejects.toMatchObject({
      stage: "repository-root",
      code: "toolchain-unavailable"
    });
  });

  it("creates and conservatively rolls back one opaque Worktree through the private runner", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "repository");
    const target = join(root, "worktrees", "a1b2c3d4e5f6g7h8");
    const hooksPath = join(root, "empty-hooks");
    await mkdir(repository);
    await mkdir(join(root, "worktrees"));
    await mkdir(hooksPath);
    await runSystemGit(repository, ["init"]);
    await runSystemGit(repository, [
      "-c", "user.name=Pi-67",
      "-c", "user.email=pi67@example.invalid",
      "commit", "--allow-empty", "-m", "initial"
    ]);
    await runSystemGit(repository, ["config", "filter.lfs.required", "true"]);
    const runner = new BoundedPrivateGitRunner(await systemGitToolchain(root));
    const headSha = await runner.resolveHeadSha(repository);
    const branchName = "pi67/task-a1b2c3d4e5f6g7h8";

    await expect(runner.inspectFilters(repository)).resolves.toEqual({
      lfsConfigured: true,
      unknownFilterNames: []
    });
    await runner.addWorktree({ cwd: repository, targetPath: target, branchName, headSha, hooksPath });
    await expect(runner.statusPorcelain(target)).resolves.toBe("");
    await expect(runner.resolveBranchHead(repository, branchName)).resolves.toBe(headSha);
    await expect(runner.listWorktrees(repository)).resolves.toHaveLength(2);

    await runner.removeWorktree(repository, target);
    await runner.deleteBranch(repository, branchName);
    await expect(runner.resolveBranchHead(repository, branchName)).resolves.toBeUndefined();
    await expect(runner.listWorktrees(repository)).resolves.toHaveLength(1);
  }, REAL_GIT_TEST_TIMEOUT_MS);

  it("bounds timeout and output while confirming child cleanup", async () => {
    const root = await temporaryRoot();
    const script = join(root, "fake-git.mjs");
    await writeFile(script, [
      "const mode = process.argv[2];",
      "if (mode === 'hang') setInterval(() => {}, 1000);",
      "if (mode === 'output') process.stdout.write('x'.repeat(4096));"
    ].join("\n"), "utf8");
    if (process.platform !== "win32") await chmod(script, 0o700);
    const base = {
      ready: true,
      gitExecutable: process.execPath,
      gitExecPath: root
    } as DesktopToolchain;
    const timeoutRunner = new BoundedPrivateGitRunner(base, {
      argumentPrefix: [script, "hang"],
      budgets: { revParseTimeoutMs: 20 }
    });
    await expect(timeoutRunner.resolveRepositoryRoot(root)).rejects.toMatchObject({
      code: "timeout",
      details: { cleanupConfirmed: true }
    });
    const outputRunner = new BoundedPrivateGitRunner(base, {
      argumentPrefix: [script, "output"],
      budgets: { revParseOutputBytes: 32 }
    });
    await expect(outputRunner.resolveRepositoryRoot(root)).rejects.toMatchObject({
      code: "output-limit",
      details: { cleanupConfirmed: true }
    });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-worktree-git-runner-"));
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
