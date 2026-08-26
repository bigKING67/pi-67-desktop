import type {
  AgentConnectionIdentity,
  SequenceGap,
  TaskProtocolContext
} from "@pi67/protocol";
import type { AppState } from "../app/app-store.types.js";
import { clearedTransientState, INITIAL_RUNTIME_STATE } from "../app/app-state-projection.js";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { rendererReadQueryClient } from "../query/renderer-read-query-client.js";
import { observeAgentHostFailure } from "./agent-host-startup-state.js";
import { useShellStore } from "../shell/shell-store.js";
import { reconcileUnconfirmedRendererSessions } from "../session/session-creation-recovery-controller.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { workspaceIdForCanonicalPath } from "../workbench/renderer-workspace-identity.js";
import { workbenchProtocolContextForTask } from "../workbench/workbench-protocol-context.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import { registerAvailableRendererWorkspaces } from "../workbench/workspace-host-registration-controller.js";
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
  const shouldRecoverProjection = shouldRecover && hasProjectionRecoveryIntent(state.workspace);
  const sameHost = shouldRecoverProjection && previousHostEpoch === identity.hostEpoch;
  const restoredRuntime = shouldRestoreFirstConnectionRuntime(state, previousHostEpoch)
    || (shouldRecover && !shouldRecoverProjection)
    ? inactiveWorkbenchRuntime()
    : undefined;
  set({
    connectionIdentity: identity,
    hostEpoch: identity.hostEpoch,
    connected: true,
    trustUpdating: false,
    sessionTransitionPending: shouldRecoverProjection,
    sessionBootstrapTransitionPending: false,
    ...(restoredRuntime === undefined ? {} : { runtime: restoredRuntime })
  });
  if (!shouldRecoverProjection || !state.workspace) {
    const workspaceRegistration = prepareRendererReadQueriesAfterConnection(get, identity);
    synchronizeWorkspaceScopedStateAfterConnection(workspaceRegistration);
    return;
  }
  recoverConnectedRendererProjection(get, set, {
    identity,
    workspace: state.workspace,
    workspaceId: workspaceIdForCanonicalPath(rendererWorkbenchStore.getState(), state.workspace),
    trust: state.trust,
    approvalMode: state.approvalMode,
    sameHost,
    onWorkspaceReady: () => connectRendererReadQueriesIfCurrent(get, identity)
  });
}

function hasProjectionRecoveryIntent(workspace: string | undefined): boolean {
  const projection = useSessionProjectionStore.getState();
  const workbench = rendererWorkbenchStore.getState();
  if (
    projection.recoverySessionFileIdentity !== undefined
    || projection.recoverySessionPath !== undefined
  ) return true;
  if (workspace === undefined) return false;
  const workspaceId = workspaceIdForCanonicalPath(workbench, workspace);
  if (workspaceId === undefined) return false;
  const selectedTask = selectedWorkbenchTask(workbench);
  return Boolean(
    selectedTask?.workspaceId === workspaceId
    && selectedTask.conversation.kind === "session"
    && selectedTask.creationStatus === undefined
  ) || Object.values(workbench.tasks).some((task) => (
    task.workspaceId === workspaceId
    && task.conversation.kind === "provisional"
    && task.creationId !== undefined
    && task.creationStatus !== undefined
  ));
}

function shouldRestoreFirstConnectionRuntime(
  state: AppState,
  previousHostEpoch: number | undefined
): boolean {
  return Boolean(
    state.workspace
    && !state.connected
    && previousHostEpoch === undefined
    && state.runtime.phase === "recovering"
    && state.runtime.detail === messages.runtime.connection.runtimeConnectionRecovering
  );
}

function inactiveWorkbenchRuntime(): AppState["runtime"] {
  const workbench = rendererWorkbenchStore.getState();
  const selectedTask = selectedWorkbenchTask(workbench);
  if (selectedTask) return selectedTask.runtime;
  return workbench.selectedSurface?.kind === "conversation"
    ? { phase: "stopped", detail: messages.runtime.workbench.sessionPendingOpen, recoverable: true }
    : { phase: "stopped", detail: messages.runtime.workbench.workspaceRestored, recoverable: true };
}

function prepareRendererReadQueriesAfterConnection(
  get: StoreGet,
  identity: AgentConnectionIdentity
): Promise<void> {
  const registration = registerAvailableRendererWorkspaces();
  void registration
    .then(() => connectRendererReadQueriesIfCurrent(get, identity))
    .catch(() => undefined);
  return registration;
}

function connectRendererReadQueriesIfCurrent(
  get: StoreGet,
  identity: AgentConnectionIdentity
): void {
  if (isCurrentConnection(get(), identity)) rendererReadQueryClient.connect(identity);
}

function synchronizeWorkspaceScopedStateAfterConnection(registration: Promise<void>): void {
  void registration
    .then(() => reconcileUnconfirmedRendererSessions())
    .catch(() => undefined);
}

function isCurrentConnection(state: AppState, identity: AgentConnectionIdentity): boolean {
  return state.connected
    && state.connectionIdentity?.appInstanceId === identity.appInstanceId
    && state.connectionIdentity.hostInstanceId === identity.hostInstanceId
    && state.connectionIdentity.hostEpoch === identity.hostEpoch;
}

export function handleTeardown(get: StoreGet, set: StoreSet, error: Error): void {
  const current = get();
  const workspace = current.workspace;
  const revision = beginRendererConnectionLoss(current);
  rendererReadQueryClient.disconnect();
  set({
    ...clearedTransientState(),
    connectionIdentity: undefined,
    connected: false,
    trustUpdating: false,
    sessionTransitionPending: false,
    sessionBootstrapTransitionPending: false,
    runtime: workspace
      ? { phase: "recovering", detail: messages.runtime.connection.runtimeConnectionRecovering, recoverable: true }
      : INITIAL_RUNTIME_STATE
  });
  if (!workspace) return;
  recoverAgentConnectionAfterTeardown(get, set, workspace, revision, error);
}

export function handleSequenceGap(get: StoreGet, set: StoreSet, gap: SequenceGap): void {
    void resynchronizeRendererProjection(get, set, {
      hostEpoch: gap.hostEpoch,
      recoveringDetail: messages.runtime.connection.resyncGap,
      readyDetail: messages.runtime.connection.resyncGapReady,
      failureTitle: messages.runtime.connection.resyncGapFailed
  });
}

export function handlePowerResume(get: StoreGet, set: StoreSet): void {
  const state = get();
  if (!state.workspace) return;
  if (state.connected && state.hostEpoch !== undefined) {
    const context = activeProjectionTaskContext(state);
    if (!context) return;
    void resynchronizeRendererProjection(get, set, {
      hostEpoch: state.hostEpoch,
      context,
      recoveringDetail: messages.runtime.connection.resyncPower,
      readyDetail: messages.runtime.connection.resyncPowerReady,
      failureTitle: messages.runtime.connection.resyncPowerFailed
    });
    return;
  }
  recoverAgentConnectionAfterPowerResume(get, set, state.workspace);
}

function activeProjectionTaskContext(state: AppState): TaskProtocolContext | undefined {
  const projection = useSessionProjectionStore.getState();
  const authority = projection.currentAuthority(state);
  const task = Object.values(rendererWorkbenchStore.getState().tasks).find((candidate) => (
    authority
      ? matchesProjectionAuthority(candidate, authority)
      : projection.recoverySessionFileIdentity !== undefined
        && candidate.sessionFileIdentity === projection.recoverySessionFileIdentity
        && candidate.sessionGeneration !== undefined
  ));
  return task ? workbenchProtocolContextForTask(task) : undefined;
}

function matchesProjectionAuthority(
  task: RendererWorkbenchTask,
  authority: {
    sessionId: string;
    sessionFileIdentity: string;
    sessionGeneration: number;
  }
): boolean {
  return task.sessionId === authority.sessionId
    && task.sessionFileIdentity === authority.sessionFileIdentity
    && task.sessionGeneration === authority.sessionGeneration;
}

export function handleHostFailure(get: StoreGet, set: StoreSet, state: HostFailure): void {
  const deterministicStartupFailure = observeAgentHostFailure(state);
  rendererReadQueryClient.disconnect();
  prepareRendererHostReplacement();
  useShellStore.getState().closeRuntimeBoundDialogs();
  set({
    ...clearedTransientState(),
    connectionIdentity: undefined,
    connected: false,
    trustUpdating: false,
    sessionTransitionPending: false,
    sessionBootstrapTransitionPending: false,
    runtime: {
      phase: state.recoverable ? "recovering" : "failed",
      detail: deterministicStartupFailure
        ? messages.runtime.connection.hostStartupFailed
        : state.recoverable
        ? messages.runtime.connection.hostExitedRecovering(state.attempt ?? 1)
        : messages.runtime.connection.hostExitedStopped,
      recoverable: state.recoverable,
      ...(state.attempt === undefined ? {} : { attempt: state.attempt })
    }
  });
  publishNotification({
    level: "warning",
    title: deterministicStartupFailure
      ? messages.runtime.connection.hostStartupFailedTitle
      : messages.runtime.connection.hostExitedTitle,
    message: deterministicStartupFailure
      ? messages.runtime.connection.hostStartupFailedDetail
      : messages.credentials.clearedAfterHostReplacement
  });
}
