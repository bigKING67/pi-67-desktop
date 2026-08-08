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
