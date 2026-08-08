import { createHash } from "node:crypto";
import type {
  EnvironmentCreationState,
  EnvironmentMutationRecoveryRecord,
  RepositoryEnvironmentSnapshot,
  WorktreeCreationAdvanceReceipt,
  WorktreeCreationErrorView,
  WorktreeCreationProgressState,
  WorktreeCreationRequest,
  WorktreeCreationResult,
  WorktreeCreationRollbackRequest,
  WorktreeCreationRollbackResult
} from "@pi67/protocol";
import type { WorkbenchStateV5 } from "./workbench-state.js";
import { GitInspectionError } from "./worktree-git-runner.js";
import type { PhysicalDirectoryIdentity } from "./repository-identity.js";

export interface WorkbenchStateAuthority {
  load(): Promise<{ state: WorkbenchStateV5 }>;
  update(mutator: (current: WorkbenchStateV5) => WorkbenchStateV5): Promise<WorkbenchStateV5>;
}

export interface RepositoryEnvironmentAuthority {
  inspect(request: { workspaceId: string }): Promise<RepositoryEnvironmentSnapshot>;
}

export class WorktreeCreationServiceError extends Error {
  constructor(readonly view: WorktreeCreationErrorView) {
    super(`Worktree creation failed (${view.stage}/${view.code}).`);
    this.name = "WorktreeCreationServiceError";
  }
}

export function serviceError(
  stage: WorktreeCreationErrorView["stage"],
  code: WorktreeCreationErrorView["code"],
  recoverable: boolean
): WorktreeCreationServiceError {
  return new WorktreeCreationServiceError({ stage, code, recoverable });
}

export function rejected(
  stage: WorktreeCreationErrorView["stage"],
  code: WorktreeCreationErrorView["code"],
  recoverable: boolean
): { status: "rejected"; error: WorktreeCreationErrorView } {
  return { status: "rejected", error: { stage, code, recoverable } };
}

export function mapGitPreflightError(error: unknown): WorktreeCreationServiceError {
  if (error instanceof GitInspectionError && error.code === "toolchain-unavailable") {
    return serviceError("preflight", "toolchain-unavailable", true);
  }
  return serviceError("preflight", "repository-not-ready", true);
}

export function creationRequestFingerprint(request: WorktreeCreationRequest): string {
  return createHash("sha256")
    .update(JSON.stringify([request.requestId, request.creationId, request.sourceWorkspaceId]))
    .digest("hex");
}

export function existingCreationResult(
  state: WorkbenchStateV5,
  request: WorktreeCreationRequest,
  fingerprint: string
): WorktreeCreationResult | undefined {
  const record = state.environmentMutations.find((candidate) => (
    candidate.creationId === request.creationId || candidate.requestId === request.requestId
  ));
  if (!record) return undefined;
  if (
    record.creationId !== request.creationId
    || record.requestId !== request.requestId
    || record.sourceWorkspaceId !== request.sourceWorkspaceId
    || record.requestFingerprint !== fingerprint
  ) return rejected("request", "invalid-request", false);
  if (record.state !== "workspace-registered" || !record.workspaceId) {
    return rejected("state", "recovery-required", true);
  }
  const workspace = state.workspaces.find((candidate) => candidate.id === record.workspaceId);
  if (!workspace) return rejected("state", "recovery-required", true);
  return {
    status: "created",
    receipt: {
      requestId: record.requestId,
      creationId: record.creationId,
      sourceWorkspaceId: record.sourceWorkspaceId,
      repositoryGroupId: record.repositoryGroupId,
      state: "workspace-registered",
      workspace
    }
  };
}

export function matchingRollbackRecord(
  state: WorkbenchStateV5,
  request: WorktreeCreationRollbackRequest
): EnvironmentMutationRecoveryRecord | undefined {
  const record = state.environmentMutations.find((candidate) => (
    candidate.creationId === request.creationId || candidate.requestId === request.requestId
  ));
  return record
    && record.creationId === request.creationId
    && record.requestId === request.requestId
    && record.sourceWorkspaceId === request.sourceWorkspaceId
    ? record
    : undefined;
}

export function rolledBack(
  record: EnvironmentMutationRecoveryRecord
): Extract<WorktreeCreationRollbackResult, { status: "rolled-back" }> {
  return {
    status: "rolled-back",
    receipt: {
      requestId: record.requestId,
      creationId: record.creationId,
      sourceWorkspaceId: record.sourceWorkspaceId,
      state: "rolled-back"
    }
  };
}

export function monotonicNow(now: number, previous: number): number {
  return Math.max(now, previous);
}

export function isTerminalCreationState(state: EnvironmentCreationState): boolean {
  return ["committed", "rolled-back", "rollback-protected", "failed", "indeterminate"].includes(state);
}

export function pathsEqual(left: string, right: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export const PROGRESS_STATES: readonly WorktreeCreationProgressState[] = [
  "workspace-registered",
  "host-registering",
  "host-registered",
  "session-materializing",
  "session-bound",
  "committed"
];

export function isProgressState(value: string): value is WorktreeCreationProgressState {
  return PROGRESS_STATES.includes(value as WorktreeCreationProgressState);
}

export function progressReceipt(record: EnvironmentMutationRecoveryRecord): WorktreeCreationAdvanceReceipt {
  if (!record.workspaceId || !isProgressState(record.state)) {
    throw serviceError("state", "recovery-required", true);
  }
  if (record.state === "session-bound" || record.state === "committed") {
    if (!record.sessionFileIdentity) throw serviceError("state", "recovery-required", true);
    return {
      creationId: record.creationId,
      state: record.state,
      workspaceId: record.workspaceId,
      sessionFileIdentity: record.sessionFileIdentity
    };
  }
  return {
    creationId: record.creationId,
    state: record.state,
    workspaceId: record.workspaceId
  };
}

export type RollbackArtifactObservation =
  | { kind: "absent" }
  | { kind: "exact-branch-only" }
  | { kind: "present-mismatch" }
  | {
      kind: "exact-clean";
      targetPath: string;
      targetIdentity: PhysicalDirectoryIdentity;
    };
