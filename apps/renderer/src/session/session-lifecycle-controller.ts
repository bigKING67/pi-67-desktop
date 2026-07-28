import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { createMessageId } from "@pi67/protocol";
import { publishNotification } from "../notifications/notification-store.js";
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
  const taskId = beginPendingTask();
  if (!taskId) return;
  await runSessionBootstrapTransition(get, set, {
    detail: "正在创建 Pi 新会话",
    refreshSessionCatalog: true,
    onError: (error) => {
      rendererWorkbenchStore.getState().updateTask(taskId, {
        lifecycle: "failed",
        runtime: { phase: "failed", detail: "无法创建 Pi 会话", recoverable: true }
      });
      reportSessionError(error, set, "无法创建 Pi 会话");
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
  const taskId = beginPendingTask(path);
  if (!taskId) return;
  const workspace = get().workspace;
  await runSessionBootstrapTransition(get, set, {
    detail: "正在恢复 Pi 会话",
    refreshSessionCatalog: true,
    onError: (error) => {
      rendererWorkbenchStore.getState().updateTask(taskId, {
        lifecycle: "failed",
        runtime: { phase: "failed", detail: "无法恢复 Pi 会话", recoverable: true }
      });
      reportSessionError(error, set, "无法恢复 Pi 会话");
    },
    request: () => agentConnectionController.request("session.open", {
      path,
      ...(workspace ? { cwdOverride: workspace } : {})
    })
  });
}

function beginPendingTask(sessionPath?: string): string | undefined {
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
    runtime: { phase: "starting", detail: "正在启动 Pi 会话", recoverable: true },
    title: "未命名会话",
    ...(sessionPath ? { sessionPath } : {}),
    hasDraft: false,
    attachmentCount: 0
  };
  const result = workbench.openTask(task);
  return result === "workspace-missing" ? undefined : taskId;
}

export async function rollbackRendererSession(entryId: string): Promise<void> {
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  await runIncrementalSessionTransition(get, set, {
    detail: "正在回退 Pi 会话",
    readyDetail: "Pi 会话已回退",
    refreshChanges: true,
    onError: (error) => reportSessionError(error, set, "无法回退 Pi 会话"),
    request: () => agentConnectionController.request("session.rollback", { entryId })
  });
}

function reportSessionError(error: unknown, set: StoreSet, title: string): void {
  const detail = error instanceof Error ? error.message : "未知错误";
  publishNotification({ level: "error", title, message: detail });
  set({ runtime: { phase: "failed", detail: `${title}：${detail}`, recoverable: true } });
}
