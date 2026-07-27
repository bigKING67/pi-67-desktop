import type { OperationKind } from "@pi67/domain";
import {
  isOperationSettled,
  type OperationSettled,
  type OperationSubmissionResult
} from "@pi67/protocol";
import { useConversationStore } from "../conversation/conversation-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { recordOperationTerminal } from "../notifications/notification-store.js";
import type { RendererSessionAuthority } from "../session/session-authority.js";
import { operationFromSubmission } from "./app-state-projection.js";
import type { AppState } from "./app-store.types.js";

type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export function applySettledSubmission(
  set: StoreSet,
  result: OperationSubmissionResult,
  kind: OperationKind,
  completedDetail: string,
  authority?: RendererSessionAuthority
): result is OperationSettled {
  if (!isOperationSettled(result)) return false;
  const detail = terminalSubmissionDetail(result, completedDetail);
  if (authority) useConversationStore.getState().setStreaming(false, authority);
  useLiveTurnStore.getState().finish(result.operationId, result.lifecycle);
  set((state) => ({
    operation: operationFromSubmission(result, kind),
    operationDetail: detail,
    operationProgress: undefined,
    sessionTransitionPending: kind === "session-import" ? false : state.sessionTransitionPending,
    runtime: {
      phase: result.lifecycle === "failed" ? "failed" : result.lifecycle === "lost" ? "recovering" : "ready",
      detail,
      recoverable: true
    }
  }));
  recordOperationTerminal(result);
  return true;
}

function terminalSubmissionDetail(result: OperationSettled, completedDetail: string): string {
  switch (result.lifecycle) {
    case "completed":
      return completedDetail;
    case "failed":
      return result.error.message;
    case "cancelled":
      return result.reason;
    case "lost":
      return result.reason;
  }
}
