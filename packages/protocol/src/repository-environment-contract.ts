export type {
  RepositoryEnvironmentError,
  RepositoryEnvironmentErrorCode,
  RepositoryEnvironmentFailureStage,
  RepositoryEnvironmentSnapshot,
  RepositoryEnvironmentStatus,
  RepositoryIdentityView,
  RepositoryChangeDetail,
  RepositoryChangeKind,
  RepositoryWorkingTreeChange,
  RepositoryWorkingTreeSnapshot,
  RepositorySubmoduleObservation,
  RepositoryWorktreeRecoveryView,
  WorktreeObservation
} from "@pi67/domain";
export {
  MAX_REPOSITORY_CHANGES,
  MAX_REPOSITORY_DIFF_CHARS,
  nextRepositoryEnvironmentRevision,
  staleRepositoryEnvironmentSnapshot
} from "@pi67/domain";

export interface RepositoryEnvironmentInspectionRequest {
  workspaceId: string;
}

export interface RepositoryWorkingTreeInspectionRequest {
  workspaceId: string;
}

export interface RepositoryChangeDetailRequest {
  workspaceId: string;
  revision: number;
  changeId: string;
}

export interface RepositorySubmoduleInitializationRequest {
  workspaceId: string;
  mode: "network-explicit";
}

export type RepositorySubmoduleInitializationResult =
  | {
      status: "initialized" | "incomplete";
      submodules: import("@pi67/domain").RepositorySubmoduleObservation;
    }
  | {
      status: "rejected";
      error: "invalid-request" | "workspace-unavailable" | "repository-stale" | "git-failed" | "internal";
    };

export interface AppOwnedWorktreeRecoveryRequest {
  workspaceId: string;
  confirmation: "recreate-committed-state";
}

export type AppOwnedWorktreeRecoveryResult =
  | { status: "recovered"; workspace: import("@pi67/domain").WorkspaceDescriptor }
  | {
      status: "rejected";
      error: "invalid-request" | "not-app-owned" | "identity-changed" | "not-recoverable" | "git-failed" | "internal";
      recoverable: boolean;
    };
