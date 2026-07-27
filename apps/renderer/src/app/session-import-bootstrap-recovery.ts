import type { AgentEvent, EventEnvelope } from "@pi67/protocol";
import { resynchronizeRendererProjection } from "../connection/projection-recovery-controller.js";
import type { AppState } from "./app-store.types.js";
import { armSessionImportBootstrapWatchdog } from "./session-import-bootstrap-watchdog.js";
import {
  captureSessionImportSubmission,
  isSessionImportSubmissionCurrent,
  type SessionImportSubmissionTarget
} from "./session-import-transition.js";

type StoreGet = () => AppState;
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export function recoverMissingSessionImportBootstrap(
  get: StoreGet,
  set: StoreSet,
  target: SessionImportSubmissionTarget,
  operationId: string
): void {
  if (!isSessionImportSubmissionCurrent(get(), target)) return;
  set({
    sessionTransitionPending: true,
    runtime: {
      phase: "recovering",
      detail: "正在确认导入后的 Pi 会话",
      recoverable: true
    }
  });
  armSessionImportBootstrapWatchdog({
    hostEpoch: target.authority.hostEpoch,
    operationId
  }, () => {
    if (!isSessionImportSubmissionCurrent(get(), target)) return;
    void resynchronizeRendererProjection(get, set, {
      hostEpoch: target.authority.hostEpoch,
      operationId,
      recoveringDetail: "导入会话缺少权威 Bootstrap，正在重新同步",
      readyDetail: "Pi 导入会话已重新同步",
      failureTitle: "无法确认导入后的 Pi 会话"
    });
  });
}

export function recoverSessionImportTerminalWithoutBootstrap(
  event: AgentEvent,
  envelope: EventEnvelope,
  get: StoreGet,
  set: StoreSet
): boolean {
  if (!isTerminalEvent(event)) return false;
  const state = get();
  const operation = state.operation;
  if (
    !state.connected
    || state.hostEpoch !== envelope.hostEpoch
    || operation?.kind !== "session-import"
    || operation.operationId !== event.payload.operationId
  ) return false;
  const target = captureSessionImportSubmission(state);
  if (!target) return false;
  recoverMissingSessionImportBootstrap(get, set, target, operation.operationId);
  return true;
}

function isTerminalEvent(
  event: AgentEvent
): event is Extract<AgentEvent, {
  type: "operation.completed" | "operation.failed" | "operation.cancelled" | "operation.lost";
}> {
  return event.type === "operation.completed"
    || event.type === "operation.failed"
    || event.type === "operation.cancelled"
    || event.type === "operation.lost";
}
