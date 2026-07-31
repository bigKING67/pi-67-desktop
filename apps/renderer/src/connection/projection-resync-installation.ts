import type {
  OperationSettled,
  ProjectionResyncResult
} from "@pi67/protocol";
import { operationFromSubmission } from "../app/app-state-projection.js";
import type { AppState } from "../app/app-store.types.js";
import { installRendererSessionResync } from "../app/renderer-session-installation.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { queryFirstSessionCatalog } from "../navigation/session-catalog-controller.js";
import { useOperationActivityTimelineStore } from "../operation/operation-activity-timeline-store.js";
import { messages } from "../localization/message-catalog.js";
import {
  publishNotification,
  recordOperationTerminal
} from "../notifications/notification-store.js";
import {
  acceptRendererSessionTransitionResponse,
  type RendererSessionTransitionTarget
} from "../session/session-authority.js";
import { projectionRecoveryLedger } from "./projection-recovery-ledger.js";
import type { WorkspaceId } from "@pi67/domain";

type StoreGet = () => AppState;
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export function installResynchronizedProjection(
  get: StoreGet,
  set: StoreSet,
  result: ProjectionResyncResult,
  hostEpoch: number,
  revision: number,
  transitionTarget: RendererSessionTransitionTarget,
  readyDetail: string,
  workspaceId: WorkspaceId | undefined
): boolean {
  if (!projectionRecoveryLedger.isCurrent(get(), hostEpoch, revision)) return false;
  if (!acceptRendererSessionTransitionResponse(get(), transitionTarget)) return false;
  if (result.changes.sessionId !== result.snapshot.sessionId) {
    throw new Error("Projection resync returned changes for a different Session.");
  }
  const recoveredTerminal = projectionRecoveryLedger.matchingInterruptedTerminal(
    result.latestOperationTerminal
  );
  const recoveredOperation = result.activeOperation
    ?? (recoveredTerminal
      ? operationFromSubmission(recoveredTerminal, recoveredTerminal.operationKind)
      : undefined);
  const terminalDetail = recoveredTerminal
    ? terminalRecoveryDetail(recoveredTerminal)
    : undefined;
  const current = get();
  if (!installRendererSessionResync(current, result, hostEpoch, transitionTarget, workspaceId)) {
    throw new Error("Projection resync result is stale or internally inconsistent.");
  }
  set((next) => projectionRecoveryLedger.isCurrent(next, hostEpoch, revision) ? {
    operation: recoveredOperation,
    operationDetail: terminalDetail,
    sessionTransitionPending: false,
    runtime: result.activeOperation
      ? { phase: "busy", detail: messages.operation.running, recoverable: true }
      : recoveredTerminal
        ? terminalRecoveryRuntime(recoveredTerminal, terminalDetail!)
        : { phase: "ready", detail: readyDetail, recoverable: true }
  } : {});
  if (result.activeOperation) {
    useLiveTurnStore.getState().begin(result.activeOperation, hostEpoch);
    useOperationActivityTimelineStore.getState().restoreFromProjection(result.activeOperation);
  } else {
    useOperationActivityTimelineStore.getState().reset();
  }
  if (recoveredTerminal) recordOperationTerminal(recoveredTerminal);
  projectionRecoveryLedger.clearInterruptedOperation();
  if (workspaceId) void queryFirstSessionCatalog(workspaceId);
  return true;
}

export function failProjectionRecovery(
  get: StoreGet,
  set: StoreSet,
  hostEpoch: number,
  revision: number,
  context: string,
  error: unknown,
  transitionTarget?: RendererSessionTransitionTarget
): void {
  if (!projectionRecoveryLedger.isCurrent(get(), hostEpoch, revision)) return;
  if (
    transitionTarget
    && !acceptRendererSessionTransitionResponse(get(), transitionTarget)
  ) return;
  projectionRecoveryLedger.clearInterruptedOperation();
  const detail = recoveryErrorMessage(error);
  set({
    sessionTransitionPending: false,
    runtime: { phase: "failed", detail: `${context}：${detail}`, recoverable: true }
  });
  publishNotification({ level: "error", title: context, message: detail });
}

function terminalRecoveryDetail(terminal: OperationSettled): string {
  switch (terminal.lifecycle) {
    case "completed":
      return messages.operation.completed;
    case "failed":
      return terminal.error.message;
    case "cancelled":
      return terminal.reason;
    case "lost":
      return terminal.reason;
  }
}

function terminalRecoveryRuntime(
  terminal: OperationSettled,
  detail: string
): AppState["runtime"] {
  return {
    phase: terminal.lifecycle === "failed"
      ? "failed"
      : terminal.lifecycle === "lost"
        ? "recovering"
        : "ready",
    detail,
    recoverable: true
  };
}

function recoveryErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : messages.runtime.unknownError;
}
