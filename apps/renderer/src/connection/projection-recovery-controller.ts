import {
  ProtocolRequestError,
  type AgentConnectionIdentity
} from "@pi67/protocol";
import { clearedTransientState } from "../app/app-state-projection.js";
import type { AppState } from "../app/app-store.types.js";
import { prepareRendererSessionTransaction } from "../app/renderer-session-transaction.js";
import { queryFirstSessionCatalog } from "../navigation/session-catalog-controller.js";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import {
  acceptRendererSessionTransitionResponse,
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
import { workspaceIdForCanonicalPath } from "../workbench/renderer-workspace-identity.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask
} from "../workbench/workbench-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import type { WorkspaceId } from "@pi67/domain";
import { reconcileUnconfirmedRendererSessions } from "../session/session-creation-recovery-controller.js";
import { selectAuthoritativeRecoveryTask } from "./projection-recovery-task-selection.js";

type StoreGet = () => AppState;
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export interface ProjectionRecoveryOptions {
  hostEpoch: number;
  operationId?: string;
  recoveringDetail: string;
  readyDetail: string;
  failureTitle: string;
  deferRuntimeNotReady?: boolean;
}

export type ProjectionRecoveryDisposition =
  | "committed"
  | "runtime-not-ready"
  | "stale"
  | "failed";

interface ConnectedProjectionRecoveryInput {
  identity: AgentConnectionIdentity;
  workspace: string;
  workspaceId: WorkspaceId | undefined;
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
  const recoverySessionFileIdentity = useSessionProjectionStore.getState().recoverySessionFileIdentity;
  const recoverySelection = selectAuthoritativeRecoveryTask(recoverySessionFileIdentity);
  if (!recoverySelection) {
    if (input.workspaceId && hasPendingSessionCreation(input.workspaceId)) {
      recoverCreationOnlyWorkbench(get, set, {
        ...input,
        workspaceId: input.workspaceId
      }, revision);
      return;
    }
    failProjectionRecovery(get, set, input.identity.hostEpoch, revision, messages.runtime.connection.restoreSessionFailed, new Error(
      "No authoritative Workbench Task is available for Session recovery."
    ));
    return;
  }
  prepareRendererSessionTransaction(
    input.sameHost ? "projection-resync" : "host-replaced"
  );
  set({
    ...clearedTransientState(),
    runtime: { phase: "recovering", detail: messages.runtime.connection.restoringSession, recoverable: true }
  });
  const transitionTarget = captureRendererSessionTransition(get());
  if (!transitionTarget) {
    recoverySelection.restore();
    failProjectionRecovery(get, set, input.identity.hostEpoch, revision, messages.runtime.connection.restoreSessionFailed, new Error(
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
        messages.runtime.connection.sessionRestored,
        input.workspaceId
      )
    ), recoverySelection.context).then((committed) => {
      recoverySelection.restore();
      if (committed && input.workspaceId) {
        void reconcileUnconfirmedRendererSessions(input.workspaceId);
      }
    }).catch((error: unknown) => {
      recoverySelection.restore();
      failProjectionRecovery(get, set, input.identity.hostEpoch, revision, messages.runtime.connection.restoreSessionFailed, error, transitionTarget);
    });
    return;
  }
  void recoverSession({
    workspace: input.workspace,
    ...(recoverySessionPath === undefined ? {} : { sessionPath: recoverySessionPath }),
    trust: input.trust,
    approvalMode: input.approvalMode
  }, recoverySelection.context).then((acknowledgement) => {
    if (!projectionRecoveryLedger.isCurrent(get(), input.identity.hostEpoch, revision)) {
      recoverySelection.restore();
      return;
    }
    const disposition = classifyRendererSessionBootstrap(
      get(),
      transitionTarget,
      acknowledgement
    );
    if (disposition === "committed") {
      recoverySelection.restore();
      projectionRecoveryLedger.clearInterruptedOperation();
      if (input.workspaceId) void queryFirstSessionCatalog(input.workspaceId);
      if (input.workspaceId) void reconcileUnconfirmedRendererSessions(input.workspaceId);
      return;
    }
    if (disposition === "stale") {
      recoverySelection.restore();
      return;
    }
    throw new Error(messages.runtime.connection.missingRuntimeReady);
  }).catch((error: unknown) => {
    if (
      projectionRecoveryLedger.isCurrent(get(), input.identity.hostEpoch, revision)
      && classifyRendererSessionBootstrap(get(), transitionTarget) === "committed"
    ) {
      recoverySelection.restore();
      projectionRecoveryLedger.clearInterruptedOperation();
      if (input.workspaceId) void queryFirstSessionCatalog(input.workspaceId);
      if (input.workspaceId) void reconcileUnconfirmedRendererSessions(input.workspaceId);
      return;
    }
    recoverySelection.restore();
    failProjectionRecovery(get, set, input.identity.hostEpoch, revision, messages.runtime.connection.restoreSessionFailed, error, transitionTarget);
  });
}

function hasPendingSessionCreation(workspaceId: WorkspaceId): boolean {
  return Object.values(rendererWorkbenchStore.getState().tasks).some((task) => (
    task.workspaceId === workspaceId
    && task.conversation.kind === "provisional"
    && task.creationId !== undefined
    && task.creationStatus !== undefined
  ));
}

function recoverCreationOnlyWorkbench(
  get: StoreGet,
  set: StoreSet,
  input: ConnectedProjectionRecoveryInput & { workspaceId: WorkspaceId },
  revision: number
): void {
  const workspace = rendererWorkbenchStore.getState().workspaces[input.workspaceId];
  if (!workspace || workspace.availability !== "available") {
    finishCreationOnlyRecoveryFailure(
      get,
      set,
      input.identity.hostEpoch,
      revision,
      new Error("The Workspace for Session creation recovery is unavailable.")
    );
    return;
  }
  prepareRendererSessionTransaction(input.sameHost ? "projection-resync" : "host-replaced");
  set({
    ...clearedTransientState(),
    sessionTransitionPending: true,
    runtime: {
      phase: "recovering",
      detail: messages.runtime.connection.restoringSession,
      recoverable: true
    }
  });
  void registerRendererWorkspaceWithHost(workspace, {
    queryCatalog: true,
    refreshCatalog: true
  }).then(async (registered) => {
    if (!registered) throw new Error("The Workspace could not be registered for Session creation recovery.");
    if (!projectionRecoveryLedger.isCurrent(get(), input.identity.hostEpoch, revision)) return;
    await reconcileUnconfirmedRendererSessions(input.workspaceId);
    if (!projectionRecoveryLedger.isCurrent(get(), input.identity.hostEpoch, revision)) return;
    projectionRecoveryLedger.clearInterruptedOperation();
    const selected = selectedWorkbenchTask(rendererWorkbenchStore.getState());
    set({
      sessionTransitionPending: false,
      sessionBootstrapTransitionPending: false,
      runtime: selected?.runtime ?? {
        phase: "stopped",
        detail: messages.runtime.workbench.workspaceRestored,
        recoverable: true
      }
    });
  }).catch((error: unknown) => {
    finishCreationOnlyRecoveryFailure(
      get,
      set,
      input.identity.hostEpoch,
      revision,
      error
    );
  });
}

function finishCreationOnlyRecoveryFailure(
  get: StoreGet,
  set: StoreSet,
  hostEpoch: number,
  revision: number,
  error: unknown
): void {
  if (!projectionRecoveryLedger.isCurrent(get(), hostEpoch, revision)) return;
  projectionRecoveryLedger.clearInterruptedOperation();
  const selected = selectedWorkbenchTask(rendererWorkbenchStore.getState());
  set({
    sessionTransitionPending: false,
    sessionBootstrapTransitionPending: false,
    runtime: selected?.runtime ?? {
      phase: "failed",
      detail: messages.runtime.session.creationOutcomeUnknown,
      recoverable: true
    }
  });
  publishNotification({
    level: "warning",
    title: messages.runtime.session.creationRecheckUnavailable,
    message: errorMessage(error)
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
    title: messages.runtime.connection.runtimeConnectionInterrupted,
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
        detail: messages.runtime.connection.restoreConnectionFailedDetail(errorMessage(reconnectError)),
        recoverable: true
      }
    });
    publishNotification({
      level: "error",
      title: messages.runtime.connection.restoreConnectionFailed,
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
    runtime: { phase: "recovering", detail: messages.runtime.connection.systemReconnect, recoverable: true }
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
        detail: messages.runtime.connection.systemReconnectFailedDetail(detail),
        recoverable: true
      }
    });
    publishNotification({
      level: "error",
      title: messages.runtime.connection.systemReconnectFailed,
      message: detail
    });
  });
}

export async function resynchronizeRendererProjection(
  get: StoreGet,
  set: StoreSet,
  options: ProjectionRecoveryOptions
): Promise<ProjectionRecoveryDisposition> {
  const revision = invalidateProjectionRecoveryGeneration();
  const workspace = get().workspace;
  const workbench = rendererWorkbenchStore.getState();
  const workspaceId = workspace
    ? workspaceIdForCanonicalPath(workbench, workspace)
    : workbench.currentWorkspaceId;
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
    return "failed";
  }
  try {
    const committed = await resynchronizeProjection(options.hostEpoch, (result) => (
      installResynchronizedProjection(
        get,
        set,
        result,
        options.hostEpoch,
        revision,
        transitionTarget,
        options.readyDetail,
        workspaceId
      )
    ));
    return committed ? "committed" : "stale";
  } catch (error) {
    if (
      options.deferRuntimeNotReady
      && error instanceof ProtocolRequestError
      && error.code === "RUNTIME_NOT_READY"
    ) {
      deferProjectionRecoveryForBootstrap(get, set, options.hostEpoch, revision, transitionTarget);
      return "runtime-not-ready";
    }
    failProjectionRecovery(
      get,
      set,
      options.hostEpoch,
      revision,
      options.failureTitle,
      error,
      transitionTarget
    );
    return "failed";
  }
}

export function prepareRendererHostReplacement(): void {
  projectionRecoveryLedger.prepareHostReplacement();
  prepareRendererSessionTransaction("host-replaced");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : messages.runtime.unknownError;
}

function deferProjectionRecoveryForBootstrap(
  get: StoreGet,
  set: StoreSet,
  hostEpoch: number,
  revision: number,
  transitionTarget: ReturnType<typeof captureRendererSessionTransition>
): void {
  if (!transitionTarget || !projectionRecoveryLedger.isCurrent(get(), hostEpoch, revision)) return;
  if (!acceptRendererSessionTransitionResponse(get(), transitionTarget)) return;
  projectionRecoveryLedger.clearInterruptedOperation();
  set({ sessionTransitionPending: false });
}
