import {
  MAX_REPOSITORY_WORKTREES,
  type RepositoryEnvironmentError,
  type RepositoryEnvironmentSnapshot,
  type WorktreeObservation
} from "@pi67/domain";

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/u;
const REPOSITORY_ID_PATTERN = /^repo_[0-9a-f]{32}$/u;
const WORKTREE_ID_PATTERN = /^wt_[0-9a-f]{32}$/u;
const HEAD_SHA_PATTERN = /^[0-9a-f]{40}$/u;

const FAILURE_STAGES = new Set<RepositoryEnvironmentError["stage"]>([
  "workspace",
  "toolchain",
  "repository-root",
  "common-dir",
  "worktree-list",
  "identity",
  "state",
  "catalog"
]);

const ERROR_CODES = new Set<RepositoryEnvironmentError["code"]>([
  "workspace-not-found",
  "workspace-unavailable",
  "toolchain-unavailable",
  "not-a-repository",
  "timeout",
  "output-limit",
  "process-failed",
  "invalid-output",
  "identity-unavailable",
  "state-unavailable",
  "catalog-unavailable",
  "unknown"
]);

export function isRepositoryEnvironmentSnapshot(
  value: unknown
): value is RepositoryEnvironmentSnapshot {
  if (!isRecord(value) || !hasBaseFields(value)) return false;

  if (value.status === "ready") return isReadySnapshot(value);
  if (value.status === "non-git") return isNonGitSnapshot(value);
  if (
    value.status === "toolchain-unavailable"
    || value.status === "missing"
    || value.status === "error"
  ) {
    return isFailureSnapshot(value);
  }
  return false;
}

function isReadySnapshot(value: Record<string, unknown>): boolean {
  if (!hasExactKeys(value, [
    "workspaceId",
    "status",
    "revision",
    "observedAt",
    "stale",
    "repository",
    "worktrees"
  ], ["error"])) return false;
  if (!isRepositoryIdentity(value.repository) || !isWorktreeList(value.worktrees, false)) {
    return false;
  }
  if (value.error !== undefined && !isEnvironmentError(value.error)) return false;

  const ids = new Set<string>();
  for (const worktree of value.worktrees) {
    if (ids.has(worktree.worktreeId)) return false;
    ids.add(worktree.worktreeId);
  }
  return ids.has(value.repository.currentWorktreeId);
}

function isNonGitSnapshot(value: Record<string, unknown>): boolean {
  if (!hasExactKeys(value, [
    "workspaceId",
    "status",
    "revision",
    "observedAt",
    "stale",
    "worktrees"
  ], ["error"])) return false;
  return isWorktreeList(value.worktrees, true)
    && (value.error === undefined || isEnvironmentError(value.error));
}

function isFailureSnapshot(value: Record<string, unknown>): boolean {
  if (!hasExactKeys(value, [
    "workspaceId",
    "status",
    "revision",
    "observedAt",
    "stale",
    "worktrees",
    "error"
  ])) return false;
  return isWorktreeList(value.worktrees, true) && isEnvironmentError(value.error);
}

function hasBaseFields(value: Record<string, unknown>): boolean {
  return typeof value.workspaceId === "string"
    && WORKSPACE_ID_PATTERN.test(value.workspaceId)
    && isNonNegativeSafeInteger(value.revision)
    && isNonNegativeSafeInteger(value.observedAt)
    && typeof value.stale === "boolean";
}

function isRepositoryIdentity(value: unknown): value is {
  repositoryGroupId: string;
  assurance: "filesystem" | "path-only";
  currentWorktreeId: string;
} {
  return isRecord(value)
    && hasExactKeys(value, ["repositoryGroupId", "assurance", "currentWorktreeId"])
    && typeof value.repositoryGroupId === "string"
    && REPOSITORY_ID_PATTERN.test(value.repositoryGroupId)
    && (value.assurance === "filesystem" || value.assurance === "path-only")
    && typeof value.currentWorktreeId === "string"
    && WORKTREE_ID_PATTERN.test(value.currentWorktreeId);
}

function isWorktreeList(value: unknown, requireEmpty: boolean): value is WorktreeObservation[] {
  if (!Array.isArray(value) || value.length > MAX_REPOSITORY_WORKTREES) return false;
  if (requireEmpty && value.length !== 0) return false;
  return value.every(isWorktreeObservation);
}

function isWorktreeObservation(value: unknown): value is WorktreeObservation {
  if (!isRecord(value) || !hasExactKeys(value, [
    "worktreeId",
    "kind",
    "status",
    "detached",
    "locked"
  ], ["workspaceId", "branchName", "headSha"])) return false;
  return typeof value.worktreeId === "string"
    && WORKTREE_ID_PATTERN.test(value.worktreeId)
    && (value.workspaceId === undefined || (
      typeof value.workspaceId === "string" && WORKSPACE_ID_PATTERN.test(value.workspaceId)
    ))
    && (value.kind === "primary" || value.kind === "linked")
    && (value.status === "ready" || value.status === "missing" || value.status === "prunable")
    && (value.branchName === undefined || (
      typeof value.branchName === "string"
      && value.branchName.length >= 1
      && value.branchName.length <= 512
    ))
    && (value.headSha === undefined || (
      typeof value.headSha === "string" && HEAD_SHA_PATTERN.test(value.headSha)
    ))
    && typeof value.detached === "boolean"
    && typeof value.locked === "boolean";
}

function isEnvironmentError(value: unknown): value is RepositoryEnvironmentError {
  return isRecord(value)
    && hasExactKeys(value, ["stage", "code", "recoverable"])
    && typeof value.stage === "string"
    && FAILURE_STAGES.has(value.stage as RepositoryEnvironmentError["stage"])
    && typeof value.code === "string"
    && ERROR_CODES.has(value.code as RepositoryEnvironmentError["code"])
    && typeof value.recoverable === "boolean";
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const keys = Object.keys(value);
  if (!required.every((key) => Object.hasOwn(value, key))) return false;
  const allowed = new Set([...required, ...optional]);
  return keys.every((key) => allowed.has(key));
}
