import type { TaskProtocolContext } from "@pi67/protocol";
import type { AppState } from "../app/app-store.types.js";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask
} from "../workbench/workbench-store.js";
import { projectionRecoveryLedger } from "./projection-recovery-ledger.js";

type StoreGet = () => AppState;
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export function settleOwnedConnectedProjectionRecoveryFailure(
  get: StoreGet,
  set: StoreSet,
  hostEpoch: number,
  revision: number,
  context: TaskProtocolContext
): void {
  if (!projectionRecoveryLedger.isCurrent(get(), hostEpoch, revision)) return;
  projectionRecoveryLedger.clearInterruptedOperation();
  const title = messages.runtime.connection.restoreSessionFailed;
  const message = "会话恢复结果已过期，请重新打开对话。";
  const failureRuntime = {
    phase: "failed" as const,
    detail: `${title}：${message}`,
    recoverable: true
  };
  const workbench = rendererWorkbenchStore.getState();
  const recoveryTask = context.scope === "task" ? workbench.tasks[context.taskId] : undefined;
  if (recoveryTask && recoveryTask.taskGeneration === context.taskGeneration) {
    workbench.updateTask(recoveryTask.id, { lifecycle: "lost", runtime: failureRuntime });
  }
  const currentWorkbench = rendererWorkbenchStore.getState();
  const selected = selectedWorkbenchTask(currentWorkbench);
  const runtime = selected?.runtime ?? (currentWorkbench.selectedSurface?.kind === "conversation"
    ? { phase: "stopped" as const, detail: messages.runtime.workbench.sessionPendingOpen, recoverable: true }
    : { phase: "stopped" as const, detail: messages.runtime.workbench.workspaceRestored, recoverable: true });
  set({
    sessionTransitionPending: false,
    sessionBootstrapTransitionPending: false,
    runtime
  });
  publishNotification({ level: "error", title, message });
}

export function settleOwnedProjectionResyncFailure(
  get: StoreGet,
  set: StoreSet,
  hostEpoch: number,
  revision: number,
  failureTitle: string
): void {
  if (!projectionRecoveryLedger.isCurrent(get(), hostEpoch, revision)) return;
  projectionRecoveryLedger.clearInterruptedOperation();
  const message = "会话恢复结果已过期，请重新打开对话。";
  set({
    sessionTransitionPending: false,
    sessionBootstrapTransitionPending: false,
    runtime: {
      phase: "failed",
      detail: `${failureTitle}：${message}`,
      recoverable: true
    }
  });
  publishNotification({ level: "error", title: failureTitle, message });
}
