import type {
  WorktreeCreationErrorView,
  WorktreeCreationAdvanceResult,
  WorktreeCreationActivityResult,
  WorktreeCreationCancelResult,
  WorktreeCreationProgressState,
  WorktreeCreationResult,
  WorktreeCreationRollbackResult
} from "./worktree-creation-contract.js";

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/u;
const REPOSITORY_PATTERN = /^repo_[0-9a-f]{32}$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]{0,39})$/u;
const PROGRESS_STATES = new Set<WorktreeCreationProgressState>([
  "workspace-registered",
  "host-registering",
  "host-registered",
  "session-materializing",
  "session-bound",
  "committed"
]);

const FAILURE_STAGES = new Set<WorktreeCreationErrorView["stage"]>([
  "request",
  "preflight",
  "state",
  "git",
  "identity",
  "rollback"
]);
const FAILURE_CODES = new Set<WorktreeCreationErrorView["code"]>([
  "invalid-request",
  "workspace-not-found",
  "workspace-unavailable",
  "workspace-untrusted",
  "repository-not-ready",
  "repository-stale",
  "state-unavailable",
  "toolchain-unavailable",
  "custom-filter",
  "queue-full",
  "repository-indeterminate",
  "identity-collision",
  "cancelled",
  "git-failed",
  "rollback-protected",
  "recovery-required",
  "internal"
]);

export function isWorktreeCreationResult(value: unknown): value is WorktreeCreationResult {
  if (!isRecord(value)) return false;
  if (value.status === "rejected") {
    return hasExactKeys(value, ["status", "error"]) && isCreationError(value.error);
  }
  if (value.status !== "created" || !hasExactKeys(value, ["status", "receipt"]) || !isRecord(value.receipt)) {
    return false;
  }
  const receipt = value.receipt;
  return hasExactKeys(receipt, [
    "requestId",
    "creationId",
    "sourceWorkspaceId",
    "repositoryGroupId",
    "state",
    "workspace"
  ], ["submodules"])
    && isId(receipt.requestId)
    && isId(receipt.creationId)
    && isId(receipt.sourceWorkspaceId)
    && typeof receipt.repositoryGroupId === "string"
    && REPOSITORY_PATTERN.test(receipt.repositoryGroupId)
    && receipt.state === "workspace-registered"
    && isWorkspaceDescriptor(receipt.workspace)
    && (receipt.submodules === undefined || isSubmoduleObservation(receipt.submodules));
}

export function isWorktreeCreationActivityResult(value: unknown): value is WorktreeCreationActivityResult {
  if (!isRecord(value)) return false;
  if (value.status === "inactive") return hasExactKeys(value, ["status"]);
  if (value.status !== "active" || !hasExactKeys(value, ["status", "activity"]) || !isRecord(value.activity)) {
    return false;
  }
  const activity = value.activity;
  return hasExactKeys(activity, [
    "creationId", "stage", "startedAt", "updatedAt", "cancellable"
  ], ["budgetMs"])
    && isId(activity.creationId)
    && ["preflight", "queued", "checkout", "submodules", "verifying", "workspace-registering"]
      .includes(activity.stage as string)
    && isTimestamp(activity.startedAt)
    && isTimestamp(activity.updatedAt)
    && Number(activity.updatedAt) >= Number(activity.startedAt)
    && (activity.budgetMs === undefined || (
      Number.isSafeInteger(activity.budgetMs) && Number(activity.budgetMs) >= 1 && Number(activity.budgetMs) <= 600_000
    ))
    && activity.cancellable === true;
}

export function isWorktreeCreationCancelResult(value: unknown): value is WorktreeCreationCancelResult {
  return isRecord(value)
    && hasExactKeys(value, ["status"])
    && (value.status === "cancel-requested" || value.status === "inactive");
}

export function isWorktreeCreationAdvanceResult(value: unknown): value is WorktreeCreationAdvanceResult {
  if (!isRecord(value)) return false;
  if (value.status === "rejected") {
    return hasExactKeys(value, ["status", "error"]) && isCreationError(value.error);
  }
  if (value.status !== "advanced" || !hasExactKeys(value, ["status", "receipt"]) || !isRecord(value.receipt)) {
    return false;
  }
  const receipt = value.receipt;
  if (
    typeof receipt.state !== "string"
    || !PROGRESS_STATES.has(receipt.state as WorktreeCreationProgressState)
  ) return false;
  const hasSessionIdentity = receipt.state === "session-bound" || receipt.state === "committed";
  if (!hasExactKeys(
    receipt,
    hasSessionIdentity
      ? ["creationId", "state", "workspaceId", "sessionFileIdentity"]
      : ["creationId", "state", "workspaceId"]
  )) return false;
  return isId(receipt.creationId)
    && isId(receipt.workspaceId)
    && (!hasSessionIdentity || isSessionFileIdentity(receipt.sessionFileIdentity));
}

export function isWorktreeCreationRollbackResult(value: unknown): value is WorktreeCreationRollbackResult {
  if (!isRecord(value)) return false;
  if (value.status === "rejected") {
    return hasExactKeys(value, ["status", "error"]) && isCreationError(value.error);
  }
  if (value.status !== "rolled-back" || !hasExactKeys(value, ["status", "receipt"]) || !isRecord(value.receipt)) {
    return false;
  }
  const receipt = value.receipt;
  return hasExactKeys(receipt, ["requestId", "creationId", "sourceWorkspaceId", "state"])
    && isId(receipt.requestId)
    && isId(receipt.creationId)
    && isId(receipt.sourceWorkspaceId)
    && receipt.state === "rolled-back";
}

function isCreationError(value: unknown): value is WorktreeCreationErrorView {
  return isRecord(value)
    && hasExactKeys(value, ["stage", "code", "recoverable"])
    && typeof value.stage === "string"
    && FAILURE_STAGES.has(value.stage as WorktreeCreationErrorView["stage"])
    && typeof value.code === "string"
    && FAILURE_CODES.has(value.code as WorktreeCreationErrorView["code"])
    && typeof value.recoverable === "boolean";
}

function isWorkspaceDescriptor(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, [
    "id",
    "displayName",
    "identity",
    "trust",
    "trustProvenance",
    "availability"
  ], ["lastVerifiedAt"])) return false;
  return isId(value.id)
    && typeof value.displayName === "string"
    && value.displayName.length >= 1
    && value.displayName.length <= 1_024
    && isWorkspaceIdentity(value.identity)
    && (value.lastVerifiedAt === undefined || isTimestamp(value.lastVerifiedAt))
    && (value.trust === "unknown" || value.trust === "trusted" || value.trust === "untrusted")
    && ["native-picker", "user-confirmed", "restored", "identity-changed", "indirect"]
      .includes(value.trustProvenance as string)
    && ["available", "missing", "identity-changed", "needs-confirmation", "unavailable"]
      .includes(value.availability as string);
}

function isSubmoduleObservation(value: unknown): boolean {
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

function isWorkspaceIdentity(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["canonicalPath", "assurance"], [
    "device",
    "inode",
    "birthtimeNs"
  ])) return false;
  if (
    typeof value.canonicalPath !== "string"
    || value.canonicalPath.length < 1
    || value.canonicalPath.length > 32_768
    || value.canonicalPath.includes("\0")
    || !isAbsolutePath(value.canonicalPath)
  ) return false;
  if (value.device !== undefined && !isDecimal(value.device)) return false;
  if (value.inode !== undefined && !isDecimal(value.inode)) return false;
  if (value.birthtimeNs !== undefined && !isDecimal(value.birthtimeNs)) return false;
  if (value.assurance === "path-only") return true;
  return value.assurance === "filesystem" && value.device !== undefined && value.inode !== undefined;
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || /^\\\\[^\\]+\\[^\\]+/u.test(value);
}

function isDecimal(value: unknown): boolean {
  return typeof value === "string" && DECIMAL_PATTERN.test(value);
}

function isSessionFileIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 1_024 && !value.includes("\0");
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isTimestamp(value: unknown): boolean {
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
