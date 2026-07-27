import type { OperationFreshness } from "@pi67/domain";
import type { AgentEvent, EventEnvelope } from "@pi67/protocol";
import { useAppStore } from "../app/app-store.js";
import type { AppState } from "../app/app-store.types.js";
import { resynchronizeRendererProjection } from "../connection/projection-recovery-controller.js";
import {
  OperationFreshnessWatchdog,
  type OperationWatchdogAuthority
} from "./operation-freshness-watchdog.js";
import { useOperationFreshnessStore } from "./operation-freshness-store.js";

let activeWatchdog: OperationFreshnessWatchdog | undefined;

export function installOperationFreshnessController(): () => void {
  if (activeWatchdog) throw new Error("Operation freshness controller is already installed.");
  const watchdog = new OperationFreshnessWatchdog({
    onFreshness: (freshness, authority) => {
      const state = useAppStore.getState();
      if (!hasAuthority(state, authority)) return;
      const freshnessStore = useOperationFreshnessStore.getState();
      if (sameFreshness(freshnessStore.freshness, freshness)) return;
      freshnessStore.setFreshness(freshness);
    },
    onRecover: (authority) => {
      const state = useAppStore.getState();
      if (!hasAuthority(state, authority)) return;
      void resynchronizeRendererProjection(useAppStore.getState, useAppStore.setState, {
        hostEpoch: authority.hostEpoch,
        operationId: authority.operationId,
        recoveringDetail: "Agent Host 心跳超时，正在确认任务状态",
        readyDetail: "任务状态已重新同步",
        failureTitle: "无法确认当前任务状态"
      });
    }
  });
  activeWatchdog = watchdog;
  const synchronize = (state: AppState) => synchronizeOperation(watchdog, state);
  const unsubscribe = useAppStore.subscribe(synchronize);
  synchronize(useAppStore.getState());

  return () => {
    unsubscribe();
    watchdog.stop();
    useOperationFreshnessStore.getState().clear();
    if (activeWatchdog === watchdog) activeWatchdog = undefined;
  };
}

export function observeOperationFreshnessEvent(event: AgentEvent, envelope: EventEnvelope): void {
  const watchdog = activeWatchdog;
  if (!watchdog) return;
  const authority = authorityForEnvelope(useAppStore.getState(), envelope);
  if (!authority) return;
  if (event.type === "operation.heartbeat") {
    watchdog.observeHeartbeat(authority, event.payload);
    return;
  }
  if (isBusinessActivityEvent(event)) watchdog.observeBusinessActivity(authority);
}

export function resetOperationFreshnessAfterPowerResume(): void {
  activeWatchdog?.handlePowerResume();
}

function synchronizeOperation(watchdog: OperationFreshnessWatchdog, state: AppState): void {
  if (state.connected && state.hostEpoch !== undefined && state.operation) {
    watchdog.track(state.operation, state.hostEpoch);
    if (isActiveOperation(state.operation)) return;
  } else {
    watchdog.stop();
  }
  if (useOperationFreshnessStore.getState().freshness !== undefined) {
    useOperationFreshnessStore.getState().clear();
  }
}

function authorityForEnvelope(
  state: AppState,
  envelope: EventEnvelope
): OperationWatchdogAuthority | undefined {
  const operation = state.operation;
  if (
    !state.connected
    || !operation
    || state.hostEpoch !== envelope.hostEpoch
    || operation.operationId !== envelope.operationId
    || operation.sessionId !== envelope.sessionId
    || operation.sessionGeneration !== envelope.sessionGeneration
  ) return undefined;
  return {
    hostEpoch: envelope.hostEpoch,
    operationId: operation.operationId,
    sessionId: operation.sessionId,
    sessionGeneration: operation.sessionGeneration
  };
}

function hasAuthority(state: AppState, authority: OperationWatchdogAuthority): boolean {
  const operation = state.operation;
  return state.connected
    && state.hostEpoch === authority.hostEpoch
    && operation?.operationId === authority.operationId
    && operation.sessionId === authority.sessionId
    && operation.sessionGeneration === authority.sessionGeneration
    && isActiveOperation(operation);
}

function isActiveOperation(operation: NonNullable<AppState["operation"]>): boolean {
  return operation.lifecycle === "submitting"
    || operation.lifecycle === "accepted"
    || operation.lifecycle === "running"
    || operation.lifecycle === "waiting-input";
}

function isBusinessActivityEvent(event: AgentEvent): boolean {
  switch (event.type) {
    case "turn.streamBatch":
    case "operation.started":
    case "operation.activityChanged":
    case "operation.progress":
    case "workspace.changeChanged":
    case "approval.requested":
    case "approval.resolved":
    case "approval.cancelled":
    case "extension.ui.requested":
    case "extension.ui.updated":
    case "extension.ui.resolved":
    case "extension.ui.cancelled":
      return true;
    default:
      return false;
  }
}

function sameFreshness(
  left: OperationFreshness | undefined,
  right: OperationFreshness | undefined
): boolean {
  return left?.operationId === right?.operationId
    && left?.phase === right?.phase
    && left?.lastActivityAt === right?.lastActivityAt
    && left?.lastHeartbeatAt === right?.lastHeartbeatAt
    && left?.observedAt === right?.observedAt
    && left?.reason === right?.reason;
}
