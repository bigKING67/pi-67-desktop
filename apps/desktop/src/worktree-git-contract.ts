export type GitInspectionStage =
  | "repository-root"
  | "common-dir"
  | "worktree-list"
  | "head"
  | "filters"
  | "status"
  | "diff"
  | "branch-head"
  | "submodule-status"
  | "submodule-update"
  | "worktree-add"
  | "worktree-remove"
  | "branch-delete";

export type GitInspectionFailureCode =
  | "toolchain-unavailable"
  | "not-a-repository"
  | "timeout"
  | "cancelled"
  | "output-limit"
  | "process-failed"
  | "invalid-output";

export class GitInspectionError extends Error {
  constructor(
    readonly stage: GitInspectionStage,
    readonly code: GitInspectionFailureCode,
    readonly details: {
      exitCode?: number;
      signal?: NodeJS.Signals;
      cleanupConfirmed?: boolean;
    } = {}
  ) {
    super(`Git repository inspection failed at ${stage} (${code}).`);
    this.name = "GitInspectionError";
  }
}

export interface GitWorktreeRecord {
  path: string;
  headSha?: string;
  branchName?: string;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface RepositoryReadOnlyGitRunner {
  resolveRepositoryRoot(cwd: string, signal?: AbortSignal): Promise<string>;
  resolveCommonDirectory(cwd: string, signal?: AbortSignal): Promise<string>;
  listWorktrees(cwd: string, signal?: AbortSignal): Promise<GitWorktreeRecord[]>;
  dispose(): void;
}

export interface RepositoryWorkingTreeGitRunner extends RepositoryReadOnlyGitRunner {
  resolveHeadSha(cwd: string, signal?: AbortSignal): Promise<string>;
  statusPorcelain(cwd: string, signal?: AbortSignal): Promise<string>;
  diffPath(
    cwd: string,
    relativePath: string,
    mode: "staged" | "unstaged" | "untracked" | "conflict",
    signal?: AbortSignal
  ): Promise<string>;
  diagnostics(): { activeProcessCount: number; disposed: boolean };
}

export interface GitFilterInspection {
  lfsConfigured: boolean;
  unknownFilterNames: string[];
}

export interface GitSubmoduleInspection {
  status: "not-configured" | "complete" | "incomplete" | "conflicted";
  total: number;
  uninitialized: number;
  divergent: number;
  conflicted: number;
}

export interface RepositoryMutationGitRunner extends RepositoryWorkingTreeGitRunner {
  inspectFilters(cwd: string, signal?: AbortSignal): Promise<GitFilterInspection>;
  inspectSubmodules(cwd: string, signal?: AbortSignal): Promise<GitSubmoduleInspection>;
  initializeSubmodules(
    cwd: string,
    mode: "local-only" | "network-explicit",
    signal?: AbortSignal
  ): Promise<void>;
  resolveBranchHead(cwd: string, branchName: string, signal?: AbortSignal): Promise<string | undefined>;
  addWorktree(input: {
    cwd: string;
    targetPath: string;
    branchName: string;
    headSha: string;
    hooksPath: string;
  }, signal?: AbortSignal): Promise<void>;
  restoreWorktree(input: {
    cwd: string;
    targetPath: string;
    branchName: string;
    hooksPath: string;
  }, signal?: AbortSignal): Promise<void>;
  removeWorktree(cwd: string, targetPath: string, signal?: AbortSignal): Promise<void>;
  deleteBranch(cwd: string, branchName: string, signal?: AbortSignal): Promise<void>;
}

export interface BoundedPrivateGitRunnerOptions {
  platform?: NodeJS.Platform;
  argumentPrefix?: string[];
  budgets?: Partial<{
    revParseTimeoutMs: number;
    revParseOutputBytes: number;
    worktreeListTimeoutMs: number;
    worktreeListOutputBytes: number;
    filterInspectionTimeoutMs: number;
    filterInspectionOutputBytes: number;
    submoduleStatusTimeoutMs: number;
    submoduleUpdateTimeoutMs: number;
    submoduleOutputBytes: number;
    statusTimeoutMs: number;
    statusOutputBytes: number;
    diffTimeoutMs: number;
    diffOutputBytes: number;
    worktreeAddTimeoutMs: number;
    worktreeRemoveTimeoutMs: number;
    mutationOutputBytes: number;
  }>;
}
