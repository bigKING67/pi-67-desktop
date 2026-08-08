import { Value } from "./typebox-schema.js";
import type {
  RepositoryChangeDetailRequest,
  RepositoryEnvironmentInspectionRequest,
  RepositoryWorkingTreeInspectionRequest
} from "./repository-environment-contract.js";
import {
  RepositoryChangeDetailRequestSchema,
  RepositoryEnvironmentInspectionRequestSchema
} from "./repository-environment-schema.js";

export {
  isRepositoryChangeDetail,
  isRepositoryEnvironmentSnapshot,
  isRepositoryWorkingTreeSnapshot
} from "./repository-environment-snapshot-validation.js";

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
