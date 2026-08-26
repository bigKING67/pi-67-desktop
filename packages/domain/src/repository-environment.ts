import type { WorkspaceId } from "./workbench.js";

export const MAX_REPOSITORY_WORKTREES = 100;
export const MAX_REPOSITORY_CHANGES = 500;
export const MAX_REPOSITORY_DIFF_CHARS = 512 * 1024;

export type RepositoryEnvironmentStatus =
  | "ready"
  | "non-git"
  | "toolchain-unavailable"
  | "missing"
  | "error";

export type RepositoryEnvironmentFailureStage =
  | "workspace"
  | "toolchain"
  | "repository-root"
  | "common-dir"
  | "worktree-list"
  | "submodule-status"
  | "identity"
  | "state"
  | "catalog";

export type RepositoryEnvironmentErrorCode =
  | "workspace-not-found"
  | "workspace-unavailable"
  | "toolchain-unavailable"
  | "not-a-repository"
  | "timeout"
  | "output-limit"
  | "process-failed"
  | "invalid-output"
  | "identity-unavailable"
  | "state-unavailable"
  | "catalog-unavailable"
  | "unknown";

export interface RepositoryEnvironmentError {
  stage: RepositoryEnvironmentFailureStage;
  code: RepositoryEnvironmentErrorCode;
  recoverable: boolean;
}

export interface RepositoryIdentityView {
  repositoryGroupId: string;
  assurance: "filesystem" | "path-only";
  currentWorktreeId: string;
}

export interface WorktreeObservation {
  worktreeId: string;
  workspaceId?: WorkspaceId;
  kind: "primary" | "linked";
  status: "ready" | "missing" | "prunable";
  branchName?: string;
  headSha?: string;
  detached: boolean;
  locked: boolean;
}

export interface RepositorySubmoduleObservation {
  status: "not-configured" | "complete" | "incomplete" | "conflicted";
  total: number;
  uninitialized: number;
  divergent: number;
  conflicted: number;
  networkActionRequired: boolean;
}

export interface RepositoryWorktreeRecoveryView {
  kind: "app-owned-worktree";
  action: "recreate-committed-state";
  unrecoverableData: "uncommitted-and-untracked";
}

export interface RepositoryEnvironmentSnapshot {
  workspaceId: WorkspaceId;
  status: RepositoryEnvironmentStatus;
  revision: number;
  observedAt: number;
  stale: boolean;
  repository?: RepositoryIdentityView;
  worktrees: WorktreeObservation[];
  submodules?: RepositorySubmoduleObservation;
  recovery?: RepositoryWorktreeRecoveryView;
  error?: RepositoryEnvironmentError;
}

export type RepositoryChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "conflict";

export interface RepositoryWorkingTreeChange {
  changeId: string;
  displayPath: string;
  previousDisplayPath?: string;
  kind: RepositoryChangeKind;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
}

export interface RepositoryWorkingTreeSnapshot {
  workspaceId: WorkspaceId;
  revision: number;
  observedAt: number;
  headSha?: string;
  changes: RepositoryWorkingTreeChange[];
  truncated: boolean;
}

export interface RepositoryChangeDetail {
  workspaceId: WorkspaceId;
  revision: number;
  changeId: string;
  contentFingerprint: string;
  stagedPatch?: string;
  unstagedPatch?: string;
  truncated: boolean;
}

export function nextRepositoryEnvironmentRevision(
  previous: RepositoryEnvironmentSnapshot | undefined
): number {
  if (!previous) return 1;
  return Math.min(Number.MAX_SAFE_INTEGER, previous.revision + 1);
}

export function staleRepositoryEnvironmentSnapshot(
  previous: RepositoryEnvironmentSnapshot,
  error: RepositoryEnvironmentError
): RepositoryEnvironmentSnapshot {
  return {
    ...previous,
    stale: true,
    error: { ...error },
    ...(previous.repository ? { repository: { ...previous.repository } } : {}),
    worktrees: previous.worktrees.map((worktree) => ({ ...worktree })),
    ...(previous.submodules ? { submodules: { ...previous.submodules } } : {}),
    ...(previous.recovery ? { recovery: { ...previous.recovery } } : {})
  };
}

export function currentWorktreeObservation(
  snapshot: RepositoryEnvironmentSnapshot
): WorktreeObservation | undefined {
  const currentWorktreeId = snapshot.repository?.currentWorktreeId;
  return currentWorktreeId
    ? snapshot.worktrees.find((worktree) => worktree.worktreeId === currentWorktreeId)
    : undefined;
}
