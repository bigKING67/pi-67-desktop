import {
  MAX_RUNNING_TASKS,
  type RuntimeRecoveryRecord,
  type SessionSummary,
  type WorkbenchSettingsState,
  type WorkbenchSurface
} from "@pi67/domain";
import type { AgentConnectionIdentity } from "@pi67/protocol";
import { useAppStore } from "../app/app-store.js";
import { INITIAL_RUNTIME_STATE } from "../app/app-state-projection.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import { messages } from "../localization/message-catalog.js";
import {
  selectConversationSessionSummary,
  useSessionCatalogStore
} from "../navigation/session-catalog-store.js";
import { registerAvailableRendererWorkspaces } from "./workspace-host-registration-controller.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  type RendererWorkbenchState,
  type RendererWorkbenchTask
} from "./workbench-store.js";

let initialization: Promise<void> | undefined;
let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
let persistenceRevision = 0;
let observedPersistenceFingerprint: string | undefined;

export function initializeRendererWorkbench(): Promise<void> {
  initialization ??= initialize();
  return initialization;
}

export interface WorkbenchPersistenceAuthority {
  identity: Pick<AgentConnectionIdentity, "hostInstanceId" | "hostEpoch"> | undefined;
  sessionFor(task: RendererWorkbenchTask): SessionSummary | undefined;
}

export function workbenchLayout(
  state: RendererWorkbenchState,
  authority: WorkbenchPersistenceAuthority = livePersistenceAuthority()
): WorkbenchLayoutV3 {
  const runtimeRecovery = state.runtimeTaskOrder.flatMap((taskId): RuntimeRecoveryRecord[] => {
    const task = state.tasks[taskId];
    const identity = authority.identity;
    if (
      !task
      || !identity
      || task.runtime.phase === "stopped"
      || task.conversation.kind !== "session"
      || task.lifecycle === "draft"
      || task.lifecycle === "failed"
      || task.creationStatus !== undefined
      || task.sessionGeneration === undefined
      || task.sessionPath !== task.conversation.sessionPath
    ) return [];
    const catalogSession = authority.sessionFor(task);
    if (
      !catalogSession
      || catalogSession.id !== task.sessionId
      || catalogSession.path !== task.conversation.sessionPath
    ) return [];
    return [{
      taskId: task.id,
      conversation: task.conversation,
      sessionId: task.sessionId,
      taskGeneration: task.taskGeneration,
      sessionGeneration: task.sessionGeneration,
      hostInstanceId: identity.hostInstanceId,
      hostEpoch: identity.hostEpoch,
      lastKnownLifecycle: task.lifecycle
    }];
  }).slice(0, MAX_RUNNING_TASKS);
  const settings: WorkbenchSettingsState = {
    section: state.settingsSection,
    scope: state.settingsScope,
    ...(state.settingsScope === "project" && state.settingsWorkspaceId
      ? { workspaceId: state.settingsWorkspaceId }
      : {})
  };
  const selectedSurface = persistedSelectedSurface(state.selectedSurface, state);
  return {
    expandedWorkspaceIds: state.expandedWorkspaceIds,
    ...(state.currentWorkspaceId ? { currentWorkspaceId: state.currentWorkspaceId } : {}),
    ...(selectedSurface ? { selectedSurface } : {}),
    runtimeRecovery,
    settings
  };
}

async function initialize(): Promise<void> {
  try {
    const state = await window.pi67.system.loadWorkbenchState();
    rendererWorkbenchStore.getState().hydrate(state);
    bindPersistedRendererWorkbenchAuthority();
    await registerAvailableRendererWorkspaces();
  } catch (error) {
    publishNotification({
      level: "error",
      title: messages.runtime.workbench.restoreFailedTitle,
      message: errorMessage(error)
    });
  }
  observedPersistenceFingerprint = persistenceFingerprint(rendererWorkbenchStore.getState());
  rendererWorkbenchStore.subscribe(observePersistenceChange);
  useSessionCatalogStore.subscribe(observePersistenceChange);
}

export function bindPersistedRendererWorkbenchAuthority(
  state = rendererWorkbenchStore.getState()
): boolean {
  const workspaceId = state.currentWorkspaceId;
  const workspace = workspaceId ? state.workspaces[workspaceId] : undefined;
  if (!workspace) {
    useAppStore.setState({
      workspace: undefined,
      trust: "unknown",
      sessionTransitionPending: false,
      runtime: INITIAL_RUNTIME_STATE
    });
    return false;
  }

  if (workspace.availability !== "available") {
    useAppStore.setState({
      workspace: undefined,
      trust: workspace.trust,
      sessionTransitionPending: false,
      runtime: {
        phase: "failed",
        detail: workspace.availability === "identity-changed"
          ? messages.runtime.workbench.workspaceIdentityChanged
          : messages.runtime.workbench.workspaceUnavailable,
        recoverable: true
      }
    });
    return false;
  }

  const selectedTask = selectedWorkbenchTask(state);
  const runtime = selectedTask?.runtime ?? (
    state.selectedSurface?.kind === "conversation"
      ? { phase: "stopped" as const, detail: messages.runtime.workbench.sessionPendingOpen, recoverable: true }
      : { phase: "stopped" as const, detail: messages.runtime.workbench.workspaceRestored, recoverable: true }
  );
  useAppStore.setState({
    workspace: workspace.identity.canonicalPath,
    trust: workspace.trust,
    trustUpdating: false,
    sessionTransitionPending: false,
    runtime
  });
  return true;
}

function schedulePersistence(): void {
  persistenceRevision += 1;
  const revision = persistenceRevision;
  if (persistenceTimer) clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(() => {
    persistenceTimer = undefined;
    void persist(revision);
  }, 120);
}

function observePersistenceChange(): void {
  const next = persistenceFingerprint(rendererWorkbenchStore.getState());
  if (next === observedPersistenceFingerprint) return;
  observedPersistenceFingerprint = next;
  schedulePersistence();
}

async function persist(revision: number): Promise<void> {
  try {
    await window.pi67.system.updateWorkbenchLayout(workbenchLayout(rendererWorkbenchStore.getState()));
  } catch (error) {
    if (revision !== persistenceRevision) return;
    publishNotification({
      level: "warning",
      title: messages.runtime.workbench.layoutNotSavedTitle,
      message: errorMessage(error)
    });
  }
}

function persistedSelectedSurface(
  surface: WorkbenchSurface | undefined,
  state: RendererWorkbenchState
): WorkbenchSurface | undefined {
  if (!surface) return undefined;
  if (surface.kind === "settings") {
    return persistedSelectedSurface(state.settingsReturnSurface, state);
  }
  if (surface.kind === "workspace") {
    return surface.workspaceId === state.currentWorkspaceId ? surface : undefined;
  }
  if (surface.conversation.kind === "provisional") {
    return surface.conversation.workspaceId === state.currentWorkspaceId
      ? { kind: "workspace", workspaceId: surface.conversation.workspaceId }
      : undefined;
  }
  return surface.conversation.workspaceId === state.currentWorkspaceId
    ? surface
    : undefined;
}

function persistenceFingerprint(state: RendererWorkbenchState): string {
  return JSON.stringify(workbenchLayout(state));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : messages.runtime.unknownError;
}

interface WorkbenchLayoutV3 {
  expandedWorkspaceIds: string[];
  currentWorkspaceId?: string;
  selectedSurface?: WorkbenchSurface;
  runtimeRecovery: RuntimeRecoveryRecord[];
  settings: WorkbenchSettingsState;
}

function livePersistenceAuthority(): WorkbenchPersistenceAuthority {
  return {
    identity: agentConnectionController.identity,
    sessionFor: (task) => selectConversationSessionSummary(
      useSessionCatalogStore.getState(),
      task.conversation
    )
  };
}
