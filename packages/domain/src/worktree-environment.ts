export type WorkspaceEnvironmentKind = "plain" | "repository-primary" | "repository-worktree";
export type WorkspaceEnvironmentOwnership = "user" | "app";

export interface WorkspaceEnvironmentBinding {
  workspaceId: string;
  kind: WorkspaceEnvironmentKind;
  ownership: WorkspaceEnvironmentOwnership;
  repositoryGroupId?: string;
  creationId?: string;
}

export type EnvironmentCreationState =
  | "reserved"
  | "git-materializing"
  | "git-materialized"
  | "workspace-registered"
  | "host-registering"
  | "host-registered"
  | "session-materializing"
  | "session-bound"
  | "committed"
  | "rollback-pending"
  | "rolled-back"
  | "rollback-protected"
  | "failed"
  | "indeterminate";

export type EnvironmentRollbackSafety = "pre-host-confirmed";

export interface EnvironmentMutationRecoveryRecord {
  kind: "worktree-creation";
  creationId: string;
  requestId: string;
  requestFingerprint: string;
  sourceWorkspaceId: string;
  repositoryGroupId: string;
  worktreeToken: string;
  branchName: string;
  headSha: string;
  state: EnvironmentCreationState;
  createdAt: number;
  updatedAt: number;
  workspaceId?: string;
  sessionFileIdentity?: string;
  rollbackSafety?: EnvironmentRollbackSafety;
}

const ENVIRONMENT_CREATION_TRANSITIONS: Readonly<Record<EnvironmentCreationState, readonly EnvironmentCreationState[]>> = {
  reserved: ["git-materializing", "failed", "indeterminate"],
  "git-materializing": ["git-materialized", "rollback-pending", "failed", "indeterminate"],
  "git-materialized": ["workspace-registered", "rollback-pending", "indeterminate"],
  "workspace-registered": ["host-registering", "rollback-pending", "indeterminate"],
  "host-registering": ["host-registered", "rollback-pending", "indeterminate"],
  "host-registered": ["session-materializing", "rollback-pending", "indeterminate"],
  "session-materializing": ["session-bound", "rollback-pending", "indeterminate"],
  "session-bound": ["committed", "indeterminate"],
  committed: [],
  "rollback-pending": ["rolled-back", "rollback-protected", "indeterminate"],
  "rolled-back": [],
  "rollback-protected": [],
  failed: [],
  indeterminate: []
};

export function canAdvanceEnvironmentCreation(
  current: EnvironmentCreationState,
  next: EnvironmentCreationState
): boolean {
  return ENVIRONMENT_CREATION_TRANSITIONS[current].includes(next);
}

export function advanceEnvironmentCreation(
  record: EnvironmentMutationRecoveryRecord,
  next: EnvironmentCreationState,
  updatedAt: number,
  patch: {
    workspaceId?: string | undefined;
    sessionFileIdentity?: string | undefined;
    rollbackSafety?: EnvironmentRollbackSafety | undefined;
  } = {}
): EnvironmentMutationRecoveryRecord {
  if (!canAdvanceEnvironmentCreation(record.state, next)) {
    throw new Error(`Environment creation cannot advance from ${record.state} to ${next}.`);
  }
  const candidate = { ...record, ...patch, state: next, updatedAt };
  if (!isEnvironmentMutationRecoveryRecord(candidate)) {
    throw new Error("Environment creation transition produced an invalid recovery record.");
  }
  return candidate;
}

export function isWorkspaceEnvironmentBinding(value: unknown): value is WorkspaceEnvironmentBinding {
  if (!isExactRecord(value, ["workspaceId", "kind", "ownership", "repositoryGroupId", "creationId"], [
    "workspaceId",
    "kind",
    "ownership"
  ])) return false;
  if (!isBoundedId(value.workspaceId, 200)) return false;
  if (!isOneOf(value.kind, ["plain", "repository-primary", "repository-worktree"])) return false;
  if (!isOneOf(value.ownership, ["user", "app"])) return false;
  if (value.repositoryGroupId !== undefined && !isRepositoryGroupId(value.repositoryGroupId)) return false;
  if (value.creationId !== undefined && !isBoundedId(value.creationId, 200)) return false;

  if (value.kind === "plain") {
    return value.ownership === "user"
      && value.repositoryGroupId === undefined
      && value.creationId === undefined;
  }
  if (value.repositoryGroupId === undefined) return false;
  if (value.kind === "repository-primary") {
    return value.ownership === "user" && value.creationId === undefined;
  }
  return value.ownership === "app"
    ? value.creationId !== undefined
    : value.creationId === undefined;
}

export function isEnvironmentMutationRecoveryRecord(
  value: unknown
): value is EnvironmentMutationRecoveryRecord {
  if (!isExactRecord(value, [
    "kind",
    "creationId",
    "requestId",
    "requestFingerprint",
    "sourceWorkspaceId",
    "repositoryGroupId",
    "worktreeToken",
    "branchName",
    "headSha",
    "state",
    "createdAt",
    "updatedAt",
    "workspaceId",
    "sessionFileIdentity",
    "rollbackSafety"
  ], [
    "kind",
    "creationId",
    "requestId",
    "requestFingerprint",
    "sourceWorkspaceId",
    "repositoryGroupId",
    "worktreeToken",
    "branchName",
    "headSha",
    "state",
    "createdAt",
    "updatedAt"
  ])) return false;
  if (value.kind !== "worktree-creation") return false;
  if (!isBoundedId(value.creationId, 200) || !isBoundedId(value.requestId, 200)) return false;
  if (typeof value.requestFingerprint !== "string" || !/^[0-9a-f]{64}$/u.test(value.requestFingerprint)) return false;
  if (!isBoundedId(value.sourceWorkspaceId, 200)) return false;
  if (!isRepositoryGroupId(value.repositoryGroupId)) return false;
  if (typeof value.worktreeToken !== "string" || !/^[a-z0-9]{16}$/u.test(value.worktreeToken)) return false;
  if (value.branchName !== `pi67/task-${value.worktreeToken}`) return false;
  if (typeof value.headSha !== "string" || !/^[0-9a-f]{40}$/u.test(value.headSha)) return false;
  if (!isOneOf(value.state, Object.keys(ENVIRONMENT_CREATION_TRANSITIONS) as EnvironmentCreationState[])) return false;
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) || value.updatedAt < value.createdAt) return false;
  if (value.workspaceId !== undefined && !isBoundedId(value.workspaceId, 200)) return false;
  if (value.sessionFileIdentity !== undefined && !isBoundedString(value.sessionFileIdentity, 1_024)) return false;
  if (value.rollbackSafety !== undefined && value.rollbackSafety !== "pre-host-confirmed") return false;

  const workspaceRequired = [
    "workspace-registered",
    "host-registering",
    "host-registered",
    "session-materializing",
    "session-bound",
    "committed"
  ].includes(value.state as string);
  const recoveryState = [
    "rollback-pending",
    "rolled-back",
    "rollback-protected",
    "failed",
    "indeterminate"
  ].includes(value.state as string);
  if (workspaceRequired && value.workspaceId === undefined) return false;
  if (!workspaceRequired && !recoveryState && value.workspaceId !== undefined) return false;
  const sessionRequired = value.state === "session-bound" || value.state === "committed";
  if (sessionRequired && value.sessionFileIdentity === undefined) return false;
  if (!sessionRequired && !recoveryState && value.sessionFileIdentity !== undefined) return false;
  if (value.sessionFileIdentity !== undefined && value.workspaceId === undefined) return false;
  const rollbackState = [
    "rollback-pending",
    "rolled-back",
    "rollback-protected",
    "indeterminate"
  ].includes(value.state as string);
  return value.rollbackSafety === undefined || rollbackState;
}

function isRepositoryGroupId(value: unknown): value is string {
  return typeof value === "string" && /^repo_[0-9a-f]{32}$/u.test(value);
}

function isBoundedId(value: unknown, maximumLength: number): value is string {
  return isBoundedString(value, maximumLength) && /^[A-Za-z0-9._:-]+$/u.test(value);
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength && !value.includes("\0");
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isOneOf<const T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.includes(value as T);
}

function isExactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[]
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.every((key) => allowedKeys.includes(key))
    && requiredKeys.every((key) => Object.hasOwn(value, key));
}
