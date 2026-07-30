import type {
  RuntimeRecoveryRecord,
  WorkbenchSettingsState,
  WorkbenchSurface
} from "@pi67/domain";
import { useAppStore } from "../app/app-store.js";
import { INITIAL_RUNTIME_STATE } from "../app/app-state-projection.js";
import { publishNotification } from "../notifications/notification-store.js";
import { messages } from "../localization/message-catalog.js";
import { registerAvailableRendererWorkspaces } from "./workspace-host-registration-controller.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  taskForConversation,
  type RendererWorkbenchState
} from "./workbench-store.js";

let initialization: Promise<void> | undefined;
let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
let persistenceRevision = 0;

export function initializeRendererWorkbench(): Promise<void> {
  initialization ??= initialize();
  return initialization;
}

export function workbenchLayout(state: RendererWorkbenchState): WorkbenchLayoutV2 {
  const runtimeRecovery = state.runtimeTaskOrder.flatMap((taskId): RuntimeRecoveryRecord[] => {
    const task = state.tasks[taskId];
    if (!task || task.runtime.phase === "stopped") return [];
    return [{
      taskId: task.id,
      conversation: task.conversation,
      sessionId: task.sessionId,
      taskGeneration: task.taskGeneration,
      lastKnownLifecycle: task.lifecycle
    }];
  }).slice(0, 4);
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
  rendererWorkbenchStore.subscribe((state, previous) => {
    if (persistenceFingerprint(state) === persistenceFingerprint(previous)) return;
    schedulePersistence();
  });
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
    const task = taskForConversation(state.tasks, surface.conversation);
    if (!task || task.runtime.phase === "stopped") return undefined;
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

interface WorkbenchLayoutV2 {
  expandedWorkspaceIds: string[];
  currentWorkspaceId?: string;
  selectedSurface?: WorkbenchSurface;
  runtimeRecovery: RuntimeRecoveryRecord[];
  settings: WorkbenchSettingsState;
}
