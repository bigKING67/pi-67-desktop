import { spawn } from "node:child_process";
import { dirname, delimiter } from "node:path";
import type { DesktopToolchain } from "./desktop-toolchain.js";
import { captureGitProcess, type GitChild } from "./bounded-git-process.js";
import {
  GitInspectionError,
  type BoundedPrivateGitRunnerOptions,
  type GitFilterInspection,
  type GitInspectionStage,
  type GitWorktreeRecord,
  type RepositoryMutationGitRunner
} from "./worktree-git-contract.js";
export {
  GitInspectionError,
  type BoundedPrivateGitRunnerOptions,
  type GitFilterInspection,
  type GitInspectionStage,
  type GitWorktreeRecord,
  type RepositoryMutationGitRunner,
  type RepositoryReadOnlyGitRunner
} from "./worktree-git-contract.js";

const REV_PARSE_TIMEOUT_MS = 5_000;
const REV_PARSE_OUTPUT_BYTES = 64 * 1024;
const WORKTREE_LIST_TIMEOUT_MS = 8_000;
const WORKTREE_LIST_OUTPUT_BYTES = 1024 * 1024;
const FILTER_INSPECTION_TIMEOUT_MS = 5_000;
const FILTER_INSPECTION_OUTPUT_BYTES = 256 * 1024;
const STATUS_TIMEOUT_MS = 10_000;
const STATUS_OUTPUT_BYTES = 1024 * 1024;
const DIFF_TIMEOUT_MS = 15_000;
const DIFF_OUTPUT_BYTES = 2 * 1024 * 1024;
const WORKTREE_ADD_TIMEOUT_MS = 60_000;
const WORKTREE_REMOVE_TIMEOUT_MS = 30_000;
const MUTATION_OUTPUT_BYTES = 1024 * 1024;
export class BoundedPrivateGitRunner implements RepositoryMutationGitRunner {
  readonly #toolchain: DesktopToolchain;
  readonly #platform: NodeJS.Platform;
  readonly #argumentPrefix: string[];
  readonly #budgets: Required<NonNullable<BoundedPrivateGitRunnerOptions["budgets"]>>;
  readonly #controllers = new Set<AbortController>();
  #disposed = false;

  constructor(toolchain: DesktopToolchain, options: BoundedPrivateGitRunnerOptions = {}) {
    this.#toolchain = toolchain;
    this.#platform = options.platform ?? process.platform;
    this.#argumentPrefix = [...(options.argumentPrefix ?? [])];
    this.#budgets = {
      revParseTimeoutMs: options.budgets?.revParseTimeoutMs ?? REV_PARSE_TIMEOUT_MS,
      revParseOutputBytes: options.budgets?.revParseOutputBytes ?? REV_PARSE_OUTPUT_BYTES,
      worktreeListTimeoutMs: options.budgets?.worktreeListTimeoutMs ?? WORKTREE_LIST_TIMEOUT_MS,
      worktreeListOutputBytes: options.budgets?.worktreeListOutputBytes ?? WORKTREE_LIST_OUTPUT_BYTES,
      filterInspectionTimeoutMs: options.budgets?.filterInspectionTimeoutMs ?? FILTER_INSPECTION_TIMEOUT_MS,
      filterInspectionOutputBytes: options.budgets?.filterInspectionOutputBytes ?? FILTER_INSPECTION_OUTPUT_BYTES,
      statusTimeoutMs: options.budgets?.statusTimeoutMs ?? STATUS_TIMEOUT_MS,
      statusOutputBytes: options.budgets?.statusOutputBytes ?? STATUS_OUTPUT_BYTES,
      diffTimeoutMs: options.budgets?.diffTimeoutMs ?? DIFF_TIMEOUT_MS,
      diffOutputBytes: options.budgets?.diffOutputBytes ?? DIFF_OUTPUT_BYTES,
      worktreeAddTimeoutMs: options.budgets?.worktreeAddTimeoutMs ?? WORKTREE_ADD_TIMEOUT_MS,
      worktreeRemoveTimeoutMs: options.budgets?.worktreeRemoveTimeoutMs ?? WORKTREE_REMOVE_TIMEOUT_MS,
      mutationOutputBytes: options.budgets?.mutationOutputBytes ?? MUTATION_OUTPUT_BYTES
    };
  }

  async resolveRepositoryRoot(cwd: string, signal?: AbortSignal): Promise<string> {
    const output = await this.#execute(
      "repository-root",
      cwd,
      ["--no-optional-locks", "-c", "core.longpaths=true", "rev-parse", "--show-toplevel"],
      this.#budgets.revParseTimeoutMs,
      this.#budgets.revParseOutputBytes,
      signal
    );
    return parseSinglePath(output, "repository-root");
  }

  async resolveCommonDirectory(cwd: string, signal?: AbortSignal): Promise<string> {
    const output = await this.#execute(
      "common-dir",
      cwd,
      ["--no-optional-locks", "-c", "core.longpaths=true", "rev-parse", "--path-format=absolute", "--git-common-dir"],
      this.#budgets.revParseTimeoutMs,
      this.#budgets.revParseOutputBytes,
      signal
    );
    return parseSinglePath(output, "common-dir");
  }

  async listWorktrees(cwd: string, signal?: AbortSignal): Promise<GitWorktreeRecord[]> {
    const output = await this.#execute(
      "worktree-list",
      cwd,
      ["--no-optional-locks", "-c", "core.longpaths=true", "worktree", "list", "--porcelain", "-z"],
      this.#budgets.worktreeListTimeoutMs,
      this.#budgets.worktreeListOutputBytes,
      signal
    );
    return parseGitWorktreePorcelain(output, this.#platform);
  }

  async resolveHeadSha(cwd: string, signal?: AbortSignal): Promise<string> {
    const output = await this.#execute(
      "head",
      cwd,
      ["--no-optional-locks", "-c", "core.longpaths=true", "rev-parse", "--verify", "HEAD^{commit}"],
      this.#budgets.revParseTimeoutMs,
      this.#budgets.revParseOutputBytes,
      signal
    );
    return parseHeadSha(output, "head");
  }

  async inspectFilters(cwd: string, signal?: AbortSignal): Promise<GitFilterInspection> {
    let output: string;
    try {
      output = await this.#execute(
        "filters",
        cwd,
        ["--no-optional-locks", "-c", "core.longpaths=true", "config", "--get-regexp", "^filter\\..*\\.(process|smudge|required)$"],
        this.#budgets.filterInspectionTimeoutMs,
        this.#budgets.filterInspectionOutputBytes,
        signal
      );
    } catch (error) {
      if (error instanceof GitInspectionError && error.code === "process-failed" && error.details.exitCode === 1) {
        return { lfsConfigured: false, unknownFilterNames: [] };
      }
      throw error;
    }
    return parseConfiguredFilters(output);
  }

  statusPorcelain(cwd: string, signal?: AbortSignal): Promise<string> {
    return this.#execute(
      "status",
      cwd,
      ["--no-optional-locks", "-c", "core.longpaths=true", "status", "--porcelain=v2", "-z", "--untracked-files=all"],
      this.#budgets.statusTimeoutMs,
      this.#budgets.statusOutputBytes,
      signal
    );
  }

  diffPath(
    cwd: string,
    relativePath: string,
    mode: "staged" | "unstaged" | "untracked" | "conflict",
    signal?: AbortSignal
  ): Promise<string> {
    assertRelativeGitPath(relativePath);
    const common = ["--no-optional-locks", "-c", "core.longpaths=true", "diff", "--no-ext-diff", "--no-textconv", "--unified=3"];
    const arguments_ = mode === "staged"
      ? [...common, "--cached", "--", relativePath]
      : mode === "conflict"
        ? [...common, "--cc", "--", relativePath]
        : mode === "untracked"
          ? [...common, "--no-index", "--no-prefix", "--", this.#platform === "win32" ? "NUL" : "/dev/null", relativePath]
          : [...common, "--", relativePath];
    return this.#execute(
      "diff",
      cwd,
      arguments_,
      this.#budgets.diffTimeoutMs,
      this.#budgets.diffOutputBytes,
      signal,
      mode === "untracked" ? [0, 1] : undefined
    );
  }

  diagnostics(): { activeProcessCount: number; disposed: boolean } {
    return { activeProcessCount: this.#controllers.size, disposed: this.#disposed };
  }

  async resolveBranchHead(cwd: string, branchName: string, signal?: AbortSignal): Promise<string | undefined> {
    assertBranchName(branchName);
    try {
      const output = await this.#execute(
        "branch-head",
        cwd,
        ["--no-optional-locks", "-c", "core.longpaths=true", "rev-parse", "--verify", `refs/heads/${branchName}^{commit}`],
        this.#budgets.revParseTimeoutMs,
        this.#budgets.revParseOutputBytes,
        signal
      );
      return parseHeadSha(output, "branch-head");
    } catch (error) {
      if (error instanceof GitInspectionError && error.code === "process-failed" && error.details.exitCode === 128) {
        return undefined;
      }
      throw error;
    }
  }

  async addWorktree(input: {
    cwd: string;
    targetPath: string;
    branchName: string;
    headSha: string;
    hooksPath: string;
  }, signal?: AbortSignal): Promise<void> {
    assertMutationIdentity(input, this.#platform);
    await this.#execute(
      "worktree-add",
      input.cwd,
      [
        "--no-optional-locks",
        "-c",
        "core.longpaths=true",
        "-c",
        `core.hooksPath=${input.hooksPath}`,
        "worktree",
        "add",
        "-b",
        input.branchName,
        input.targetPath,
        input.headSha
      ],
      this.#budgets.worktreeAddTimeoutMs,
      this.#budgets.mutationOutputBytes,
      signal
    );
  }

  async removeWorktree(cwd: string, targetPath: string, signal?: AbortSignal): Promise<void> {
    assertAbsolutePath(targetPath, this.#platform);
    await this.#execute(
      "worktree-remove",
      cwd,
      ["--no-optional-locks", "-c", "core.longpaths=true", "worktree", "remove", "--force", targetPath],
      this.#budgets.worktreeRemoveTimeoutMs,
      this.#budgets.mutationOutputBytes,
      signal
    );
  }

  async deleteBranch(cwd: string, branchName: string, signal?: AbortSignal): Promise<void> {
    assertBranchName(branchName);
    await this.#execute(
      "branch-delete",
      cwd,
      ["--no-optional-locks", "-c", "core.longpaths=true", "branch", "-D", branchName],
      this.#budgets.statusTimeoutMs,
      this.#budgets.mutationOutputBytes,
      signal
    );
  }

  dispose(): void {
    this.#disposed = true;
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
  }

  async #execute(
    stage: GitInspectionStage,
    cwd: string,
    arguments_: string[],
    timeoutMs: number,
    outputLimitBytes: number,
    callerSignal?: AbortSignal,
    acceptedExitCodes?: readonly number[]
  ): Promise<string> {
    const executable = this.#toolchain.gitExecutable;
    const gitExecPath = this.#toolchain.gitExecPath;
    if (this.#disposed) throw new GitInspectionError(stage, "cancelled", { cleanupConfirmed: true });
    if (!this.#toolchain.ready || !executable || !gitExecPath) {
      throw new GitInspectionError(stage, "toolchain-unavailable");
    }
    if (callerSignal?.aborted) throw new GitInspectionError(stage, "cancelled", { cleanupConfirmed: true });

    const controller = new AbortController();
    this.#controllers.add(controller);
    const abortFromCaller = () => controller.abort();
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

    let child: GitChild | undefined;
    try {
      child = spawn(executable, [...this.#argumentPrefix, ...arguments_], {
        cwd,
        detached: this.#platform !== "win32",
        env: privateGitEnvironment(executable, gitExecPath),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      return await captureGitProcess({
        child,
        stage,
        timeoutMs,
        outputLimitBytes,
        signal: controller.signal,
        platform: this.#platform,
        ...(acceptedExitCodes ? { acceptedExitCodes } : {})
      });
    } finally {
      callerSignal?.removeEventListener("abort", abortFromCaller);
      this.#controllers.delete(controller);
    }
  }
}

function assertRelativeGitPath(path: string): void {
  if (
    path.length === 0
    || path.length > 32_768
    || path.includes("\0")
    || path.startsWith("/")
    || /^[A-Za-z]:[\\/]/u.test(path)
    || path.split(/[\\/]/u).some((segment) => segment === "..")
  ) throw new Error("Git diff path is invalid.");
}

export function parseGitWorktreePorcelain(
  output: string,
  platform: NodeJS.Platform = process.platform
): GitWorktreeRecord[] {
  if (output.length === 0 || !output.includes("\0")) {
    throw new GitInspectionError("worktree-list", "invalid-output");
  }
  const records: GitWorktreeRecord[] = [];
  let current: GitWorktreeRecord | undefined;
  const finish = () => {
    if (!current) return;
    if (!isAbsoluteForPlatform(current.path, platform)) {
      throw new GitInspectionError("worktree-list", "invalid-output");
    }
    records.push(current);
    current = undefined;
  };

  for (const field of output.split("\0")) {
    if (field.length === 0) {
      finish();
      continue;
    }
    if (field.startsWith("worktree ")) {
      finish();
      const path = field.slice("worktree ".length);
      if (path.length === 0 || path.length > 32_768 || path.includes("\0")) {
        throw new GitInspectionError("worktree-list", "invalid-output");
      }
      current = { path, detached: false, locked: false, prunable: false };
      continue;
    }
    if (!current) throw new GitInspectionError("worktree-list", "invalid-output");
    if (field.startsWith("HEAD ")) {
      const headSha = field.slice("HEAD ".length);
      if (!/^[0-9a-f]{40}$/u.test(headSha)) {
        throw new GitInspectionError("worktree-list", "invalid-output");
      }
      current.headSha = headSha;
    } else if (field.startsWith("branch refs/heads/")) {
      const branchName = field.slice("branch refs/heads/".length);
      if (branchName.length === 0 || branchName.length > 512) {
        throw new GitInspectionError("worktree-list", "invalid-output");
      }
      current.branchName = branchName;
    } else if (field === "detached") {
      current.detached = true;
    } else if (field === "locked" || field.startsWith("locked ")) {
      current.locked = true;
    } else if (field === "prunable" || field.startsWith("prunable ")) {
      current.prunable = true;
    } else if (field !== "bare") {
      throw new GitInspectionError("worktree-list", "invalid-output");
    }
  }
  finish();
  if (records.length === 0 || records.length > 100) {
    throw new GitInspectionError("worktree-list", "invalid-output");
  }
  return records;
}

function parseSinglePath(output: string, stage: GitInspectionStage): string {
  const path = output.replace(/[\r\n]+$/u, "");
  if (
    path.length === 0
    || path.length > 32_768
    || path.includes("\r")
    || path.includes("\n")
    || path.includes("\0")
  ) {
    throw new GitInspectionError(stage, "invalid-output");
  }
  return path;
}

function parseHeadSha(output: string, stage: GitInspectionStage): string {
  const headSha = output.replace(/[\r\n]+$/u, "");
  if (!/^[0-9a-f]{40}$/u.test(headSha)) throw new GitInspectionError(stage, "invalid-output");
  return headSha;
}

export function parseConfiguredFilters(output: string): GitFilterInspection {
  const names = new Set<string>();
  for (const line of output.split(/\r?\n/u)) {
    if (line.length === 0) continue;
    const match = /^filter\.([A-Za-z0-9._-]{1,128})\.(?:process|smudge|required)(?:\s|$)/u.exec(line);
    if (!match?.[1]) throw new GitInspectionError("filters", "invalid-output");
    names.add(match[1]);
  }
  const values = [...names].sort((left, right) => left.localeCompare(right));
  return {
    lfsConfigured: values.includes("lfs"),
    unknownFilterNames: values.filter((name) => name !== "lfs")
  };
}

function assertMutationIdentity(input: {
  targetPath: string;
  branchName: string;
  headSha: string;
  hooksPath: string;
}, platform: NodeJS.Platform): void {
  assertAbsolutePath(input.targetPath, platform);
  assertAbsolutePath(input.hooksPath, platform);
  assertBranchName(input.branchName);
  if (!/^[0-9a-f]{40}$/u.test(input.headSha)) throw new Error("Git mutation HEAD is invalid.");
}

function assertAbsolutePath(path: string, platform: NodeJS.Platform): void {
  if (
    path.length === 0
    || path.length > 32_768
    || path.includes("\0")
    || !isAbsoluteForPlatform(path, platform)
  ) throw new Error("Git mutation path is invalid.");
}

function assertBranchName(branchName: string): void {
  if (!/^pi67\/task-[a-z0-9]{16}$/u.test(branchName)) throw new Error("Git mutation branch is invalid.");
}

function privateGitEnvironment(executable: string, gitExecPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: [dirname(executable), process.env.PATH].filter(Boolean).join(delimiter),
    GIT_EXEC_PATH: gitExecPath,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    LANG: "C",
    LC_ALL: "C"
  };
}

function isAbsoluteForPlatform(path: string, platform: NodeJS.Platform): boolean {
  if (platform === "win32") return /^[A-Za-z]:[\\/]/u.test(path) || /^\\\\[^\\]+\\[^\\]+/u.test(path);
  return path.startsWith("/");
}
