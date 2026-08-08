export type {
  RepositoryEnvironmentError,
  RepositoryEnvironmentErrorCode,
  RepositoryEnvironmentFailureStage,
  RepositoryEnvironmentSnapshot,
  RepositoryEnvironmentStatus,
  RepositoryIdentityView,
  WorktreeObservation
} from "@pi67/domain";
export {
  nextRepositoryEnvironmentRevision,
  staleRepositoryEnvironmentSnapshot
} from "@pi67/domain";

export interface RepositoryEnvironmentInspectionRequest {
  workspaceId: string;
}
