import type { AgentConnectionIdentity, SequenceGap } from "@pi67/protocol";
import type { AppState } from "../app/app-store.types.js";
import { clearedTransientState, INITIAL_RUNTIME_STATE } from "../app/app-state-projection.js";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useShellStore } from "../shell/shell-store.js";
import {
  beginRendererConnectionLoss,
  prepareRendererHostReplacement,
  recoverAgentConnectionAfterTeardown,
  recoverAgentConnectionAfterPowerResume,
  recoverConnectedRendererProjection,
  resynchronizeRendererProjection
} from "./projection-recovery-controller.js";

type StoreGet = () => AppState;
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;
type HostFailure = Parameters<AppState["handleAgentHostFailed"]>[0];

export function handleConnected(
  get: StoreGet,
  set: StoreSet,
  identity: AgentConnectionIdentity
): void {
  const state = get();
  const previousHostEpoch = state.hostEpoch;
  const shouldRecover = Boolean(
    state.workspace
    && previousHostEpoch !== undefined
    && (!state.connected || state.connectionIdentity !== undefined || previousHostEpoch !== identity.hostEpoch)
  );
  const sameHost = shouldRecover && previousHostEpoch === identity.hostEpoch;
  set({
    connectionIdentity: identity,
    hostEpoch: identity.hostEpoch,
    connected: true,
    trustUpdating: false,
    sessionTransitionPending: shouldRecover
  });
  if (!shouldRecover || !state.workspace) return;
  recoverConnectedRendererProjection(get, set, {
    identity,
    workspace: state.workspace,
    trust: state.trust,
    approvalMode: state.approvalMode,
    sameHost
  });
}

export function handleTeardown(get: StoreGet, set: StoreSet, error: Error): void {
  const current = get();
  const workspace = current.workspace;
  const revision = beginRendererConnectionLoss(current);
  set({
    ...clearedTransientState(),
    connectionIdentity: undefined,
    connected: false,
    trustUpdating: false,
    sessionTransitionPending: false,
    runtime: workspace
      ? { phase: "recovering", detail: "Agent Host 连接已中断，正在等待恢复", recoverable: true }
      : INITIAL_RUNTIME_STATE
  });
  if (!workspace) return;
  recoverAgentConnectionAfterTeardown(get, set, workspace, revision, error);
}

export function handleSequenceGap(get: StoreGet, set: StoreSet, gap: SequenceGap): void {
  void resynchronizeRendererProjection(get, set, {
    hostEpoch: gap.hostEpoch,
    recoveringDetail: "检测到状态事件缺口，正在重新同步",
    readyDetail: "Pi 状态已重新同步",
    failureTitle: "无法重新同步 Pi 状态"
  });
}

export function handlePowerResume(get: StoreGet, set: StoreSet): void {
  const state = get();
  if (!state.workspace) return;
  if (state.connected && state.hostEpoch !== undefined) {
    void resynchronizeRendererProjection(get, set, {
      hostEpoch: state.hostEpoch,
      recoveringDetail: "系统已恢复，正在重新同步 Pi 状态",
      readyDetail: "系统恢复后 Pi 状态已重新同步",
      failureTitle: "系统恢复后无法同步 Pi 状态"
    });
    return;
  }
  recoverAgentConnectionAfterPowerResume(get, set, state.workspace);
}

export function handleHostFailure(get: StoreGet, set: StoreSet, state: HostFailure): void {
  prepareRendererHostReplacement();
  useShellStore.getState().closeRuntimeBoundDialogs();
  set({
    ...clearedTransientState(),
    connectionIdentity: undefined,
    connected: false,
    trustUpdating: false,
    sessionTransitionPending: false,
    runtime: {
      phase: state.recoverable ? "recovering" : "failed",
      detail: state.recoverable
        ? `Agent Host 已退出，正在进行第 ${state.attempt ?? 1} 次恢复`
        : "Agent Host 连续退出，自动恢复已停止",
      recoverable: state.recoverable,
      ...(state.attempt === undefined ? {} : { attempt: state.attempt })
    }
  });
  publishNotification({
    level: "warning",
    title: "Agent Host 已退出",
    message: messages.credentials.clearedAfterHostReplacement
  });
}
