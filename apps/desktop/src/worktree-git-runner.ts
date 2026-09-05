import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { DesktopToolchain } from "./desktop-toolchain.js";
import { captureGitProcess, type GitChild } from "./bounded-git-process.js";
import {
  GitInspectionError,
  type BoundedPrivateGitRunnerOptions,
  type GitFilterInspection,
  type GitInspectionStage,
  type GitSubmoduleInspection,
  type GitWorktreeRecord,
  type RepositoryMutationGitRunner
} from "./worktree-git-contract.js";
import {
  assertAbsolutePath,
  assertBranchName,
  assertMutationIdentity,
  assertRelativeGitPath,
  isContainedPath,
  parseConfiguredFilters,
  parseGitWorktreePorcelain,
  parseHeadSha,
  parseSinglePath,
  parseSubmodulePathConfiguration,
  parseSubmoduleStatus,
  privateGitEnvironment
} from "./worktree-git-runner-support.js";
export {
  GitInspectionError,
  type BoundedPrivateGitRunnerOptions,
  type GitFilterInspection,
  type GitInspectionStage,
  type GitSubmoduleInspection,
  type GitWorktreeRecord,
  type RepositoryMutationGitRunner,
  type RepositoryReadOnlyGitRunner
} from "./worktree-git-contract.js";
export {
  parseConfiguredFilters,
  parseGitWorktreePorcelain,
  parseSubmoduleStatus
} from "./worktree-git-runner-support.js";

const REV_PARSE_TIMEOUT_MS = 5_000;
const REV_PARSE_OUTPUT_BYTES = 64 * 1024;
const WORKTREE_LIST_TIMEOUT_MS = 8_000;
const WORKTREE_LIST_OUTPUT_BYTES = 1024 * 1024;
const FILTER_INSPECTION_TIMEOUT_MS = 5_000;
const FILTER_INSPECTION_OUTPUT_BYTES = 256 * 1024;
const SUBMODULE_STATUS_TIMEOUT_MS = 10_000;
const SUBMODULE_UPDATE_TIMEOUT_MS = 120_000;
const SUBMODULE_OUTPUT_BYTES = 1024 * 1024;
const STATUS_TIMEOUT_MS = 10_000;
const STATUS_OUTPUT_BYTES = 1024 * 1024;
const DIFF_TIMEOUT_MS = 15_000;
const DIFF_OUTPUT_BYTES = 2 * 1024 * 1024;
const WORKTREE_ADD_TIMEOUT_MS = 300_000;
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
      submoduleStatusTimeoutMs: options.budgets?.submoduleStatusTimeoutMs ?? SUBMODULE_STATUS_TIMEOUT_MS,
      submoduleUpdateTimeoutMs: options.budgets?.submoduleUpdateTimeoutMs ?? SUBMODULE_UPDATE_TIMEOUT_MS,
      submoduleOutputBytes: options.budgets?.submoduleOutputBytes ?? SUBMODULE_OUTPUT_BYTES,
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

  async inspectSubmodules(cwd: string, signal?: AbortSignal): Promise<GitSubmoduleInspection> {
    const output = await this.#execute(
      "submodule-status",
      cwd,
      ["--no-optional-locks", "-c", "core.longpaths=true", "submodule", "status", "--recursive"],
      this.#budgets.submoduleStatusTimeoutMs,
      this.#budgets.submoduleOutputBytes,
      signal
    );
    return parseSubmoduleStatus(output);
  }

  async initializeSubmodules(
    cwd: string,
    mode: "local-only" | "network-explicit",
    signal?: AbortSignal
  ): Promise<void> {
    const local = mode === "local-only" ? await this.#localSubmoduleMaterialization(cwd, signal) : undefined;
    if (mode === "local-only" && (!local || local.paths.length === 0)) {
      throw new GitInspectionError("submodule-update", "process-failed");
    }
    const transports = mode === "local-only"
      ? [
          "-c", "protocol.allow=never",
          "-c", "protocol.file.allow=always",
        ]
      : [
          "-c", "protocol.allow=never",
          "-c", "protocol.http.allow=always",
          "-c", "protocol.https.allow=always",
          "-c", "protocol.ssh.allow=always",
          "-c", "protocol.git.allow=always",
          "-c", "protocol.file.allow=never"
        ];
    await this.#execute(
      "submodule-update",
      cwd,
      [
        "--no-optional-locks",
        "-c", "core.longpaths=true",
        ...transports,
        ...(local?.overrides ?? []),
        "submodule", "update", "--init",
        ...(mode === "network-explicit" ? ["--recursive"] : []),
        "--checkout",
        ...(mode === "local-only" ? ["--no-fetch", "--", ...local!.paths] : [])
      ],
      this.#budgets.submoduleUpdateTimeoutMs,
      this.#budgets.submoduleOutputBytes,
      signal
    );
  }

  statusPorcelain(cwd: string, signal?: AbortSignal): Promise<string> {
    return this.#execute(
      "status",
      cwd,
      [
        "--no-optional-locks",
        "-c", "core.longpaths=true",
        "-c", "core.fsmonitor=false",
        "status", "--porcelain=v2", "-z", "--untracked-files=all"
      ],
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

  async restoreWorktree(input: {
    cwd: string;
    targetPath: string;
    branchName: string;
    hooksPath: string;
  }, signal?: AbortSignal): Promise<void> {
    assertAbsolutePath(input.targetPath, this.#platform);
    assertAbsolutePath(input.hooksPath, this.#platform);
    assertBranchName(input.branchName);
    await this.#execute(
      "worktree-add",
      input.cwd,
      [
        "--no-optional-locks",
        "-c", "core.longpaths=true",
        "-c", `core.hooksPath=${input.hooksPath}`,
        "worktree", "add", input.targetPath, input.branchName
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

  async #localSubmoduleMaterialization(
    cwd: string,
    signal?: AbortSignal
  ): Promise<{ overrides: string[]; paths: string[] }> {
    const output = await this.#execute(
      "submodule-status",
      cwd,
      [
        "--no-optional-locks", "-c", "core.longpaths=true", "config", "--file", ".gitmodules",
        "--null", "--get-regexp", "^submodule\\..*\\.path$"
      ],
      this.#budgets.submoduleStatusTimeoutMs,
      this.#budgets.submoduleOutputBytes,
      signal,
      [0, 1]
    );
    const entries = parseSubmodulePathConfiguration(output);
    if (entries.length === 0) return { overrides: [], paths: [] };
    const commonDirectory = await this.resolveCommonDirectory(cwd, signal);
    const requestedModuleRoot = resolve(commonDirectory, "modules");
    let moduleRoot: string;
    try {
      moduleRoot = await realpath(requestedModuleRoot);
    } catch {
      return { overrides: [], paths: [] };
    }
    const overrides: string[] = [];
    const paths: string[] = [];
    for (const entry of entries) {
      const candidate = resolve(moduleRoot, ...entry.name.split("/"));
      let source: string;
      try {
        source = await realpath(candidate);
        if (!isContainedPath(moduleRoot, source) || !(await stat(source)).isDirectory()) continue;
      } catch {
        continue;
      }
      overrides.push("-c", `submodule.${entry.name}.url=${source}`);
      paths.push(entry.path);
    }
    return { overrides, paths };
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
