import { Value } from "./typebox-schema.js";
import type {
  RepositoryEnvironmentInspectionRequest
} from "./repository-environment-contract.js";
import {
  RepositoryEnvironmentInspectionRequestSchema
} from "./repository-environment-schema.js";

export { isRepositoryEnvironmentSnapshot } from "./repository-environment-snapshot-validation.js";

export function parseRepositoryEnvironmentInspectionRequest(
  value: unknown
): RepositoryEnvironmentInspectionRequest | undefined {
  if (!Value.Check(RepositoryEnvironmentInspectionRequestSchema, value)) return undefined;
  return { workspaceId: value.workspaceId };
}
