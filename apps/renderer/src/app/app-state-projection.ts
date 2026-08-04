import type { OperationKind, OperationView } from "@pi67/domain";
import type { OperationSubmissionResult } from "@pi67/protocol";
import type { AppState } from "./app-store.types.js";

export const INITIAL_RUNTIME_STATE = {
  phase: "idle",
  detail: "等待选择工作区",
  recoverable: true
} as const;

export function clearedTransientState(): Pick<AppState,
  | "operation"
  | "operationDetail"
  | "operationProgress"
  | "sessionBootstrapTransitionPending"
  | "workspaceOpenPending"
> {
  return {
    operation: undefined,
    operationDetail: undefined,
    operationProgress: undefined,
    sessionBootstrapTransitionPending: false,
    workspaceOpenPending: false
  };
}

export function operationFromSubmission(
  result: OperationSubmissionResult,
  kind: OperationKind
): OperationView {
  if (result.kind === "accepted") {
    return {
      operationId: result.operationId,
      kind,
      lifecycle: "accepted",
      cancellable: result.cancellable,
      sessionId: result.sessionId,
      sessionGeneration: result.sessionGeneration,
      startedAt: Date.now()
    };
  }
  return {
    operationId: result.operationId,
    kind: result.operationKind,
    lifecycle: result.lifecycle,
    cancellable: false,
    sessionId: result.sessionId,
    sessionGeneration: result.sessionGeneration,
    startedAt: result.startedAt
  };
}
