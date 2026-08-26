import {
  MAX_REPOSITORY_CHANGES,
  MAX_REPOSITORY_DIFF_CHARS,
  MAX_REPOSITORY_WORKTREES,
  type RepositoryChangeDetail,
  type RepositoryEnvironmentError,
  type RepositoryEnvironmentSnapshot,
  type RepositorySubmoduleObservation,
  type RepositoryWorkingTreeChange,
  type RepositoryWorkingTreeSnapshot,
  type WorktreeObservation
} from "@pi67/domain";

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/u;
const REPOSITORY_ID_PATTERN = /^repo_[0-9a-f]{32}$/u;
const WORKTREE_ID_PATTERN = /^wt_[0-9a-f]{32}$/u;
const HEAD_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const CHANGE_ID_PATTERN = /^chg_[0-9a-f]{32}$/u;
const CONTENT_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u;
const CHANGE_KINDS = new Set<RepositoryWorkingTreeChange["kind"]>([
  "added", "modified", "deleted", "renamed", "copied", "untracked", "conflict"
]);

const FAILURE_STAGES = new Set<RepositoryEnvironmentError["stage"]>([
  "workspace",
  "toolchain",
  "repository-root",
  "common-dir",
  "worktree-list",
  "submodule-status",
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

export function isRepositoryWorkingTreeSnapshot(
  value: unknown
): value is RepositoryWorkingTreeSnapshot {
  if (!isRecord(value) || !hasExactKeys(value, [
    "workspaceId", "revision", "observedAt", "changes", "truncated"
  ], ["headSha"])) return false;
  if (
    typeof value.workspaceId !== "string"
    || !WORKSPACE_ID_PATTERN.test(value.workspaceId)
    || !isPositiveSafeInteger(value.revision)
    || !isNonNegativeSafeInteger(value.observedAt)
    || (value.headSha !== undefined && (
      typeof value.headSha !== "string" || !HEAD_SHA_PATTERN.test(value.headSha)
    ))
    || !Array.isArray(value.changes)
    || value.changes.length > MAX_REPOSITORY_CHANGES
    || !value.changes.every(isRepositoryWorkingTreeChange)
    || typeof value.truncated !== "boolean"
  ) return false;
  return new Set(value.changes.map((change) => change.changeId)).size === value.changes.length;
}

export function isRepositoryChangeDetail(value: unknown): value is RepositoryChangeDetail {
  return isRecord(value)
    && hasExactKeys(value, [
      "workspaceId", "revision", "changeId", "contentFingerprint", "truncated"
    ], ["stagedPatch", "unstagedPatch"])
    && typeof value.workspaceId === "string"
    && WORKSPACE_ID_PATTERN.test(value.workspaceId)
    && isPositiveSafeInteger(value.revision)
    && typeof value.changeId === "string"
    && CHANGE_ID_PATTERN.test(value.changeId)
    && typeof value.contentFingerprint === "string"
    && CONTENT_FINGERPRINT_PATTERN.test(value.contentFingerprint)
    && boundedPatch(value.stagedPatch)
    && boundedPatch(value.unstagedPatch)
    && typeof value.truncated === "boolean";
}

function isRepositoryWorkingTreeChange(value: unknown): value is RepositoryWorkingTreeChange {
  return isRecord(value)
    && hasExactKeys(value, [
      "changeId", "displayPath", "kind", "staged", "unstaged", "conflicted"
    ], ["previousDisplayPath"])
    && typeof value.changeId === "string"
    && CHANGE_ID_PATTERN.test(value.changeId)
    && isDisplayPath(value.displayPath)
    && (value.previousDisplayPath === undefined || isDisplayPath(value.previousDisplayPath))
    && typeof value.kind === "string"
    && CHANGE_KINDS.has(value.kind as RepositoryWorkingTreeChange["kind"])
    && typeof value.staged === "boolean"
    && typeof value.unstaged === "boolean"
    && typeof value.conflicted === "boolean";
}

function isDisplayPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4_096 && !value.includes("\0");
}

function boundedPatch(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.length <= MAX_REPOSITORY_DIFF_CHARS);
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
  ], ["error", "submodules"])) return false;
  if (!isRepositoryIdentity(value.repository) || !isWorktreeList(value.worktrees, false)) {
    return false;
  }
  if (value.error !== undefined && !isEnvironmentError(value.error)) return false;
  if (value.submodules !== undefined && !isSubmoduleObservation(value.submodules)) return false;

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
  ], ["recovery"])) return false;
  return isWorktreeList(value.worktrees, true)
    && isEnvironmentError(value.error)
    && (value.recovery === undefined || isRecoveryView(value.recovery));
}

function isSubmoduleObservation(value: unknown): value is RepositorySubmoduleObservation {
  if (!isRecord(value) || !hasExactKeys(value, [
    "status", "total", "uninitialized", "divergent", "conflicted", "networkActionRequired"
  ])) return false;
  if (!["not-configured", "complete", "incomplete", "conflicted"].includes(value.status as string)) return false;
  if (![value.total, value.uninitialized, value.divergent, value.conflicted].every((count) => (
    Number.isSafeInteger(count) && Number(count) >= 0 && Number(count) <= 10_000
  ))) return false;
  if (Number(value.uninitialized) + Number(value.divergent) + Number(value.conflicted) > Number(value.total)) {
    return false;
  }
  if (typeof value.networkActionRequired !== "boolean") return false;
  return !value.networkActionRequired || (
    value.status === "incomplete"
    && Number(value.uninitialized) > 0
    && Number(value.divergent) === 0
    && Number(value.conflicted) === 0
  );
}

function isRecoveryView(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["kind", "action", "unrecoverableData"])
    && value.kind === "app-owned-worktree"
    && value.action === "recreate-committed-state"
    && value.unrecoverableData === "uncommitted-and-untracked";
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

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1;
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
