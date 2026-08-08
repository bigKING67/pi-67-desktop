import type { WorkspaceId } from "./workbench.js";

export const MAX_REPOSITORY_WORKTREES = 100;

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

export interface RepositoryEnvironmentSnapshot {
  workspaceId: WorkspaceId;
  status: RepositoryEnvironmentStatus;
  revision: number;
  observedAt: number;
  stale: boolean;
  repository?: RepositoryIdentityView;
  worktrees: WorktreeObservation[];
  error?: RepositoryEnvironmentError;
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
    worktrees: previous.worktrees.map((worktree) => ({ ...worktree }))
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
