import { Value } from "./typebox-schema.js";
import type {
  WorktreeCreationAdvanceRequest,
  WorktreeCreationActivityRequest,
  WorktreeCreationCancelRequest,
  WorktreeCreationRequest,
  WorktreeCreationRollbackRequest
} from "./worktree-creation-contract.js";
import {
  WorktreeCreationAdvanceRequestSchema,
  WorktreeCreationActivityRequestSchema,
  WorktreeCreationCancelRequestSchema,
  WorktreeCreationRequestSchema,
  WorktreeCreationRollbackRequestSchema
} from "./worktree-creation-schema.js";

export {
  isWorktreeCreationAdvanceResult,
  isWorktreeCreationActivityResult,
  isWorktreeCreationCancelResult,
  isWorktreeCreationResult,
  isWorktreeCreationRollbackResult
} from "./worktree-creation-result-validation.js";

export function parseWorktreeCreationRequest(value: unknown): WorktreeCreationRequest | undefined {
  if (!Value.Check(WorktreeCreationRequestSchema, value)) return undefined;
  return {
    requestId: value.requestId,
    creationId: value.creationId,
    sourceWorkspaceId: value.sourceWorkspaceId
  };
}

export function parseWorktreeCreationActivityRequest(
  value: unknown
): WorktreeCreationActivityRequest | undefined {
  if (!Value.Check(WorktreeCreationActivityRequestSchema, value)) return undefined;
  return { creationId: value.creationId };
}

export function parseWorktreeCreationCancelRequest(
  value: unknown
): WorktreeCreationCancelRequest | undefined {
  if (!Value.Check(WorktreeCreationCancelRequestSchema, value)) return undefined;
  return { creationId: value.creationId };
}

export function parseWorktreeCreationAdvanceRequest(
  value: unknown
): WorktreeCreationAdvanceRequest | undefined {
  if (!Value.Check(WorktreeCreationAdvanceRequestSchema, value)) return undefined;
  if (value.targetState === "session-bound") {
    return {
      creationId: value.creationId,
      targetState: "session-bound",
      sessionFileIdentity: value.sessionFileIdentity
    };
  }
  return {
    creationId: value.creationId,
    targetState: value.targetState
  };
}

export function parseWorktreeCreationRollbackRequest(
  value: unknown
): WorktreeCreationRollbackRequest | undefined {
  if (!Value.Check(WorktreeCreationRollbackRequestSchema, value)) return undefined;
  return {
    requestId: value.requestId,
    creationId: value.creationId,
    sourceWorkspaceId: value.sourceWorkspaceId
  };
}
