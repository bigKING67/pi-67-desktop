import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { createMessageId } from "@pi67/protocol";
import { publishNotification } from "../notifications/notification-store.js";
import { messages } from "../localization/message-catalog.js";
import { useAppStore } from "../app/app-store.js";
import type { AppState } from "../app/app-store.types.js";
import {
  runIncrementalSessionTransition,
  runSessionBootstrapTransition
} from "../app/session-transition.js";
import { activateRendererTask } from "../workbench/task-activation-controller.js";
import { rendererWorkbenchStore, type RendererWorkbenchTask } from "../workbench/workbench-store.js";

type StoreGet = () => AppState;
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export async function createRendererSession(): Promise<void> {
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  if (!get().workspace || get().sessionTransitionPending) return;
  const task = beginPendingTask();
  if (!task) return;
  await runSessionBootstrapTransition(get, set, {
    detail: messages.runtime.session.creating,
    refreshSessionCatalogFor: task.workspaceId,
    onError: (error) => {
      rendererWorkbenchStore.getState().updateTask(task.id, {
        lifecycle: "failed",
        runtime: { phase: "failed", detail: messages.runtime.session.createFailed, recoverable: true }
      });
      reportSessionError(error, set, messages.runtime.session.createFailed);
    },
    request: () => agentConnectionController.request("session.create", {})
  });
}

export async function openRendererSession(
  path: string
): Promise<void> {
  const existing = Object.values(rendererWorkbenchStore.getState().tasks).find((task) => task.sessionPath === path);
  if (existing) {
    await activateRendererTask(existing.id);
    return;
  }
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  if (get().sessionTransitionPending) return;
  const task = beginPendingTask(path);
  if (!task) return;
  const workspace = get().workspace;
  await runSessionBootstrapTransition(get, set, {
    detail: messages.runtime.connection.restoringSession,
    refreshSessionCatalogFor: task.workspaceId,
    onError: (error) => {
      rendererWorkbenchStore.getState().updateTask(task.id, {
        lifecycle: "failed",
        runtime: { phase: "failed", detail: messages.runtime.connection.restoreSessionFailed, recoverable: true }
      });
      reportSessionError(error, set, messages.runtime.connection.restoreSessionFailed);
    },
    request: () => agentConnectionController.request("session.open", {
      path,
      ...(workspace ? { cwdOverride: workspace } : {})
    })
  });
}

function beginPendingTask(sessionPath?: string): RendererWorkbenchTask | undefined {
  const workbench = rendererWorkbenchStore.getState();
  const workspaceId = workbench.currentWorkspaceId;
  if (!workspaceId || !workbench.workspaces[workspaceId]) return undefined;
  const taskId = createMessageId("task");
  const task: RendererWorkbenchTask = {
    id: taskId,
    conversation: sessionPath
      ? { kind: "session", workspaceId, sessionPath }
      : { kind: "provisional", workspaceId, draftId: taskId },
    workspaceId,
    sessionId: `pending:${taskId}`,
    taskGeneration: 1,
    lifecycle: "initializing",
    runtime: { phase: "starting", detail: messages.runtime.session.starting, recoverable: true },
    title: messages.runtime.workbench.unnamedSession,
    ...(sessionPath ? { sessionPath } : {}),
    hasDraft: false,
    attachmentCount: 0
  };
  const result = workbench.openTask(task);
  return result === "workspace-missing" ? undefined : task;
}

export async function rollbackRendererSession(entryId: string): Promise<void> {
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  await runIncrementalSessionTransition(get, set, {
    detail: messages.runtime.session.rollingBack,
    readyDetail: messages.runtime.session.rolledBack,
    refreshChanges: true,
    onError: (error) => reportSessionError(error, set, messages.runtime.session.rollbackFailed),
    request: () => agentConnectionController.request("session.rollback", { entryId })
  });
}

function reportSessionError(error: unknown, set: StoreSet, title: string): void {
  const detail = error instanceof Error ? error.message : messages.runtime.unknownError;
  publishNotification({ level: "error", title, message: detail });
  set({ runtime: { phase: "failed", detail: `${title}：${detail}`, recoverable: true } });
}
