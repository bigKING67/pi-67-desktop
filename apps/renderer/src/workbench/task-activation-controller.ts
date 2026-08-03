import { useAppStore } from "../app/app-store.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { resynchronizeRendererProjection } from "../connection/projection-recovery-controller.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import { rendererWorkbenchStore } from "./workbench-store.js";
import { registerRendererWorkspaceWithHost } from "./workspace-host-registration-controller.js";

export async function activateRendererTask(taskId: string): Promise<boolean> {
  const workbench = rendererWorkbenchStore.getState();
  const task = workbench.tasks[taskId];
  const workspace = task ? workbench.workspaces[task.workspaceId] : undefined;
  if (!task || !workspace || !workbench.selectTask(taskId)) return false;
  if (task.runtime.phase === "stopped" || task.lifecycle === "lost" || task.lifecycle === "stopped") return true;

  const projection = useSessionProjectionStore.getState().authority;
  const appState = useAppStore.getState();
  if (
    projection.phase === "active"
    && projection.sessionId === task.sessionId
    && projection.sessionGeneration === task.sessionGeneration
    && appState.workspace === workspace.identity.canonicalPath
  ) return true;

  useAppStore.setState({
    workspace: workspace.identity.canonicalPath,
    trust: workspace.trust,
    sessionTransitionPending: true,
    runtime: { phase: "recovering", detail: `正在切换任务：${task.title}`, recoverable: true }
  });
  try {
    const identity = await ensureAgentConnection();
    await resynchronizeRendererProjection(useAppStore.getState, useAppStore.setState, {
      hostEpoch: identity.hostEpoch,
      recoveringDetail: `正在恢复任务：${task.title}`,
      readyDetail: `已切换到任务：${task.title}`,
      failureTitle: "无法切换任务"
    });
    return true;
  } catch (error) {
    useAppStore.setState({ sessionTransitionPending: false });
    publishNotification({
      level: "error",
      title: "无法切换任务",
      message: error instanceof Error ? error.message : "未知错误"
    });
    return false;
  }
}

export async function resumeRendererTask(taskId: string): Promise<boolean> {
  const workbench = rendererWorkbenchStore.getState();
  const task = workbench.tasks[taskId];
  const workspace = task ? workbench.workspaces[task.workspaceId] : undefined;
  if (!task || !workspace || !task.sessionPath || !workbench.selectTask(taskId)) return false;
  workbench.updateTask(task.id, {
    lifecycle: "initializing",
    runtime: { phase: "starting", detail: `正在恢复任务：${task.title}`, recoverable: true }
  });
  useAppStore.setState({
    workspace: workspace.identity.canonicalPath,
    trust: workspace.trust
  });
  try {
    await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
    const identity = await ensureAgentConnection();
    const recovery = await resynchronizeRendererProjection(useAppStore.getState, useAppStore.setState, {
      hostEpoch: identity.hostEpoch,
      recoveringDetail: `正在重新连接任务：${task.title}`,
      readyDetail: "Pi SDK 已就绪",
      failureTitle: "无法恢复任务",
      deferRuntimeNotReady: true
    });
    if (recovery === "committed") return true;
    if (recovery !== "runtime-not-ready") {
      if (recovery === "failed") markTaskRecoveryFailed(task.id);
      return false;
    }
    workbench.removeRuntimeTask(task.id);
    return openRendererWorkspaceDescriptor(workspace, task.sessionPath);
  } catch (error) {
    markTaskRecoveryFailed(task.id, error);
    return false;
  }
}

function markTaskRecoveryFailed(taskId: string, error?: unknown): void {
  const detail = error instanceof Error
    ? error.message
    : useAppStore.getState().runtime.detail || "无法恢复任务";
  rendererWorkbenchStore.getState().updateTask(taskId, {
    lifecycle: "lost",
    runtime: { phase: "failed", detail, recoverable: true }
  });
}
