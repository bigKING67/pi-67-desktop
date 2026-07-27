import type { AgentConnectionIdentity } from "@pi67/protocol";
import { clearedTransientState } from "../app/app-state-projection.js";
import type { AppState } from "../app/app-store.types.js";
import { prepareRendererSessionTransaction } from "../app/renderer-session-transaction.js";
import { queryFirstSessionCatalog } from "../navigation/session-catalog-controller.js";
import { publishNotification } from "../notifications/notification-store.js";
import {
  captureRendererSessionTransition,
  classifyRendererSessionBootstrap
} from "../session/session-authority.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  ensureAgentConnection,
  recoverSession,
  resynchronizeProjection
} from "./connection-recovery.js";
import { projectionRecoveryLedger } from "./projection-recovery-ledger.js";
import {
  failProjectionRecovery,
  installResynchronizedProjection
} from "./projection-resync-installation.js";

type StoreGet = () => AppState;
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export interface ProjectionRecoveryOptions {
  hostEpoch: number;
  operationId?: string;
  recoveringDetail: string;
  readyDetail: string;
  failureTitle: string;
}

interface ConnectedProjectionRecoveryInput {
  identity: AgentConnectionIdentity;
  workspace: string;
  trust: AppState["trust"];
  approvalMode: AppState["approvalMode"];
  sameHost: boolean;
}

export function invalidateProjectionRecoveryGeneration(): number {
  return projectionRecoveryLedger.invalidate();
}

export function recoverConnectedRendererProjection(
  get: StoreGet,
  set: StoreSet,
  input: ConnectedProjectionRecoveryInput
): void {
  const revision = invalidateProjectionRecoveryGeneration();
  const recoverySessionPath = useSessionProjectionStore.getState().recoverySessionPath;
  prepareRendererSessionTransaction(
    input.sameHost ? "projection-resync" : "host-replaced"
  );
  set({
    ...clearedTransientState(),
    runtime: { phase: "recovering", detail: "正在恢复 Pi 会话", recoverable: true }
  });
  const transitionTarget = captureRendererSessionTransition(get());
  if (!transitionTarget) {
    failProjectionRecovery(get, set, input.identity.hostEpoch, revision, "无法恢复 Pi 会话", new Error(
      "Renderer Session transition authority is not connected."
    ));
    return;
  }
  if (input.sameHost) {
    void resynchronizeProjection(input.identity.hostEpoch, (result) => (
      installResynchronizedProjection(
        get,
        set,
        result,
        input.identity.hostEpoch,
        revision,
        transitionTarget,
        "Pi 会话已恢复"
      )
    )).catch((error: unknown) => {
      failProjectionRecovery(get, set, input.identity.hostEpoch, revision, "无法恢复 Pi 会话", error, transitionTarget);
    });
    return;
  }
  void recoverSession({
    workspace: input.workspace,
    ...(recoverySessionPath === undefined ? {} : { sessionPath: recoverySessionPath }),
    trust: input.trust,
    approvalMode: input.approvalMode
  }).then((acknowledgement) => {
    if (!projectionRecoveryLedger.isCurrent(get(), input.identity.hostEpoch, revision)) return;
    const disposition = classifyRendererSessionBootstrap(
      get(),
      transitionTarget,
      acknowledgement
    );
    if (disposition === "committed") {
      projectionRecoveryLedger.clearInterruptedOperation();
      void queryFirstSessionCatalog();
      return;
    }
    if (disposition === "stale") return;
    throw new Error("Agent Host 未发送 authoritative runtime.ready 事件。");
  }).catch((error: unknown) => {
    if (
      projectionRecoveryLedger.isCurrent(get(), input.identity.hostEpoch, revision)
      && classifyRendererSessionBootstrap(get(), transitionTarget) === "committed"
    ) {
      projectionRecoveryLedger.clearInterruptedOperation();
      void queryFirstSessionCatalog();
      return;
    }
    failProjectionRecovery(get, set, input.identity.hostEpoch, revision, "无法恢复 Pi 会话", error, transitionTarget);
  });
}

export function beginRendererConnectionLoss(state: AppState): number {
  const revision = projectionRecoveryLedger.beginConnectionLoss(state);
  prepareRendererSessionTransaction("connection-lost");
  return revision;
}

export function recoverAgentConnectionAfterTeardown(
  get: StoreGet,
  set: StoreSet,
  workspace: string,
  revision: number,
  sourceError: Error
): void {
  publishNotification({
    level: "warning",
    title: "Agent Host 连接已中断",
    message: sourceError.message
  });
  void ensureAgentConnection().catch((reconnectError: unknown) => {
    const state = get();
    if (
      state.connected
      || state.workspace !== workspace
      || !projectionRecoveryLedger.isRevisionCurrent(revision)
    ) return;
    set({
      runtime: {
        phase: "failed",
        detail: `无法恢复 Agent Host 连接：${errorMessage(reconnectError)}`,
        recoverable: true
      }
    });
    publishNotification({
      level: "error",
      title: "无法恢复 Agent Host 连接",
      message: errorMessage(reconnectError)
    });
  });
}

export function recoverAgentConnectionAfterPowerResume(
  get: StoreGet,
  set: StoreSet,
  workspace: string
): void {
  const revision = invalidateProjectionRecoveryGeneration();
  set({
    sessionTransitionPending: true,
    runtime: { phase: "recovering", detail: "系统已恢复，正在重新连接 Agent Host", recoverable: true }
  });
  void ensureAgentConnection().catch((error: unknown) => {
    const state = get();
    if (
      state.connected
      || state.workspace !== workspace
      || !projectionRecoveryLedger.isRevisionCurrent(revision)
    ) return;
    const detail = errorMessage(error);
    set({
      sessionTransitionPending: false,
      runtime: {
        phase: "failed",
        detail: `系统恢复后无法连接 Agent Host：${detail}`,
        recoverable: true
      }
    });
    publishNotification({
      level: "error",
      title: "系统恢复后无法连接 Agent Host",
      message: detail
    });
  });
}

export async function resynchronizeRendererProjection(
  get: StoreGet,
  set: StoreSet,
  options: ProjectionRecoveryOptions
): Promise<void> {
  const revision = invalidateProjectionRecoveryGeneration();
  projectionRecoveryLedger.captureInterruptedOperation(get(), options.operationId);
  prepareRendererSessionTransaction("projection-resync");
  set({
    ...clearedTransientState(),
    sessionTransitionPending: true,
    runtime: { phase: "recovering", detail: options.recoveringDetail, recoverable: true }
  });
  const transitionTarget = captureRendererSessionTransition(get());
  if (!transitionTarget) {
    failProjectionRecovery(get, set, options.hostEpoch, revision, options.failureTitle, new Error(
      "Renderer Session transition authority is not connected."
    ));
    return;
  }
  try {
    await resynchronizeProjection(options.hostEpoch, (result) => (
      installResynchronizedProjection(
        get,
        set,
        result,
        options.hostEpoch,
        revision,
        transitionTarget,
        options.readyDetail
      )
    ));
  } catch (error) {
    failProjectionRecovery(
      get,
      set,
      options.hostEpoch,
      revision,
      options.failureTitle,
      error,
      transitionTarget
    );
  }
}

export function prepareRendererHostReplacement(): void {
  projectionRecoveryLedger.prepareHostReplacement();
  prepareRendererSessionTransaction("host-replaced");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
