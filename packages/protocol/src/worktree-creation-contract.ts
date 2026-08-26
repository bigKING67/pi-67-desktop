import type { WorkspaceDescriptor } from "@pi67/domain";

export interface WorktreeCreationRequest {
  requestId: string;
  creationId: string;
  sourceWorkspaceId: string;
}

export type WorktreeCreationRollbackRequest = WorktreeCreationRequest;

export type WorktreeMaterializationStage =
  | "preflight"
  | "queued"
  | "checkout"
  | "submodules"
  | "verifying"
  | "workspace-registering";

export interface WorktreeCreationActivityRequest {
  creationId: string;
}

export interface WorktreeCreationActivity {
  creationId: string;
  stage: WorktreeMaterializationStage;
  startedAt: number;
  updatedAt: number;
  budgetMs?: number;
  cancellable: true;
}

export type WorktreeCreationActivityResult =
  | { status: "active"; activity: WorktreeCreationActivity }
  | { status: "inactive" };

export type WorktreeCreationCancelRequest = WorktreeCreationActivityRequest;

export type WorktreeCreationCancelResult =
  | { status: "cancel-requested" }
  | { status: "inactive" };

export type WorktreeCreationProgressState =
  | "workspace-registered"
  | "host-registering"
  | "host-registered"
  | "session-materializing"
  | "session-bound"
  | "committed";

export type WorktreeCreationAdvanceRequest =
  | {
      creationId: string;
      targetState: "session-bound";
      sessionFileIdentity: string;
    }
  | {
      creationId: string;
      targetState: Exclude<WorktreeCreationProgressState, "session-bound">;
      sessionFileIdentity?: never;
    };

export type WorktreeCreationFailureStage =
  | "request"
  | "preflight"
  | "state"
  | "git"
  | "identity"
  | "rollback";

export type WorktreeCreationFailureCode =
  | "invalid-request"
  | "workspace-not-found"
  | "workspace-unavailable"
  | "workspace-untrusted"
  | "repository-not-ready"
  | "repository-stale"
  | "state-unavailable"
  | "toolchain-unavailable"
  | "custom-filter"
  | "queue-full"
  | "repository-indeterminate"
  | "identity-collision"
  | "cancelled"
  | "git-failed"
  | "rollback-protected"
  | "recovery-required"
  | "internal";

export interface WorktreeCreationErrorView {
  stage: WorktreeCreationFailureStage;
  code: WorktreeCreationFailureCode;
  recoverable: boolean;
}

export interface WorktreeCreationReceipt {
  requestId: string;
  creationId: string;
  sourceWorkspaceId: string;
  repositoryGroupId: string;
  state: "workspace-registered";
  workspace: WorkspaceDescriptor;
  submodules?: import("@pi67/domain").RepositorySubmoduleObservation;
}

export type WorktreeCreationResult =
  | { status: "created"; receipt: WorktreeCreationReceipt }
  | { status: "rejected"; error: WorktreeCreationErrorView };

export interface WorktreeCreationAdvanceReceipt {
  creationId: string;
  state: WorktreeCreationProgressState;
  workspaceId: string;
  sessionFileIdentity?: string;
}

export type WorktreeCreationAdvanceResult =
  | { status: "advanced"; receipt: WorktreeCreationAdvanceReceipt }
  | { status: "rejected"; error: WorktreeCreationErrorView };

export interface WorktreeCreationRollbackReceipt {
  requestId: string;
  creationId: string;
  sourceWorkspaceId: string;
  state: "rolled-back";
}

export type WorktreeCreationRollbackResult =
  | { status: "rolled-back"; receipt: WorktreeCreationRollbackReceipt }
  | { status: "rejected"; error: WorktreeCreationErrorView };
