import { Value } from "./typebox-schema.js";
import type {
  AppOwnedWorktreeRecoveryRequest,
  RepositoryChangeDetailRequest,
  RepositoryEnvironmentInspectionRequest,
  RepositorySubmoduleInitializationRequest,
  RepositoryWorkingTreeInspectionRequest
} from "./repository-environment-contract.js";
import {
  AppOwnedWorktreeRecoveryRequestSchema,
  RepositoryChangeDetailRequestSchema,
  RepositoryEnvironmentInspectionRequestSchema,
  RepositorySubmoduleInitializationRequestSchema
} from "./repository-environment-schema.js";

export {
  isRepositoryChangeDetail,
  isRepositoryEnvironmentSnapshot,
  isRepositoryWorkingTreeSnapshot
} from "./repository-environment-snapshot-validation.js";
export {
  isAppOwnedWorktreeRecoveryResult,
  isRepositorySubmoduleInitializationResult
} from "./repository-environment-action-result-validation.js";

export function parseRepositoryEnvironmentInspectionRequest(
  value: unknown
): RepositoryEnvironmentInspectionRequest | undefined {
  if (!Value.Check(RepositoryEnvironmentInspectionRequestSchema, value)) return undefined;
  return { workspaceId: value.workspaceId };
}

export function parseRepositoryWorkingTreeInspectionRequest(
  value: unknown
): RepositoryWorkingTreeInspectionRequest | undefined {
  if (!Value.Check(RepositoryEnvironmentInspectionRequestSchema, value)) return undefined;
  return { workspaceId: value.workspaceId };
}

export function parseRepositoryChangeDetailRequest(
  value: unknown
): RepositoryChangeDetailRequest | undefined {
  if (!Value.Check(RepositoryChangeDetailRequestSchema, value)) return undefined;
  return { workspaceId: value.workspaceId, revision: value.revision, changeId: value.changeId };
}

export function parseRepositorySubmoduleInitializationRequest(
  value: unknown
): RepositorySubmoduleInitializationRequest | undefined {
  if (!Value.Check(RepositorySubmoduleInitializationRequestSchema, value)) return undefined;
  return { workspaceId: value.workspaceId, mode: "network-explicit" };
}

export function parseAppOwnedWorktreeRecoveryRequest(
  value: unknown
): AppOwnedWorktreeRecoveryRequest | undefined {
  if (!Value.Check(AppOwnedWorktreeRecoveryRequestSchema, value)) return undefined;
  return { workspaceId: value.workspaceId, confirmation: "recreate-committed-state" };
}
