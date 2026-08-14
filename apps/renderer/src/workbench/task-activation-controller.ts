import { useAppStore } from "../app/app-store.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { resynchronizeRendererProjection } from "../connection/projection-recovery-controller.js";
import { publishNotification } from "../notifications/notification-store.js";
import { clearConversationAttention } from "../navigation/conversation-attention-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  type RendererWorkbenchTask
} from "./workbench-store.js";
import { registerRendererWorkspaceWithHost } from "./workspace-host-registration-controller.js";
import { workbenchProtocolContextForTask } from "./workbench-protocol-context.js";
import { rotateRendererTaskForSessionOpen } from "./task-runtime-reopen.js";

const taskActivationFlights = new Map<string, Promise<boolean>>();

export function activateRendererTask(taskId: string): Promise<boolean> {
  return runTaskActivationFlight(taskId, () => activateRendererTaskOnce(taskId));
}

async function activateRendererTaskOnce(taskId: string): Promise<boolean> {
  const workbench = rendererWorkbenchStore.getState();
  const task = workbench.tasks[taskId];
  const workspace = task ? workbench.workspaces[task.workspaceId] : undefined;
  if (!task || !workspace || !workbench.selectTask(taskId)) return false;
  if (task.runtime.phase === "stopped" || task.lifecycle === "lost" || task.lifecycle === "stopped") {
    return task.conversation.kind === "session" ? resumeRendererTaskOnce(task.id) : true;
  }

  const projection = useSessionProjectionStore.getState().authority;
  const projectionFileIdentity = useSessionProjectionStore.getState().identity?.sessionFileIdentity;
  const appState = useAppStore.getState();
  if (
    projection.phase === "active"
    && projection.sessionId === task.sessionId
    && projectionFileIdentity === task.sessionFileIdentity
    && projection.sessionGeneration === task.sessionGeneration
    && appState.workspace === workspace.identity.canonicalPath
  ) {
    clearTaskConversationAttention(task.id);
    return true;
  }

  useAppStore.setState({
    workspace: workspace.identity.canonicalPath,
    trust: workspace.trust,
    sessionTransitionPending: true,
    runtime: { phase: "recovering", detail: `正在切换任务：${task.title}`, recoverable: true }
  });
  try {
    const registered = await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
    if (!registered) throw new Error("目标工作区当前不可用。");
    const identity = await ensureAgentConnection();
    if (!isSelectedRendererTask(task)) return false;
    const recovery = await resynchronizeRendererProjection(useAppStore.getState, useAppStore.setState, {
      hostEpoch: identity.hostEpoch,
      context: workbenchProtocolContextForTask(task),
      recoveringDetail: `正在恢复任务：${task.title}`,
      readyDetail: `已切换到任务：${task.title}`,
      failureTitle: "无法切换任务",
      deferRuntimeNotReady: true
    });
    if (recovery === "committed") {
      clearTaskConversationAttention(task.id);
      return true;
    }
    if (recovery !== "runtime-not-ready" || !isSelectedRendererTask(task)) return false;
    return reopenRendererTask(task, workspace);
  } catch (error) {
    if (!isSelectedRendererTask(task)) return false;
    useAppStore.setState({ sessionTransitionPending: false });
    publishNotification({
      level: "error",
      title: "无法切换任务",
      message: error instanceof Error ? error.message : "未知错误"
    });
    return false;
  }
}

export function resumeRendererTask(taskId: string): Promise<boolean> {
  return runTaskActivationFlight(taskId, () => resumeRendererTaskOnce(taskId));
}

async function resumeRendererTaskOnce(taskId: string): Promise<boolean> {
  const workbench = rendererWorkbenchStore.getState();
  const task = workbench.tasks[taskId];
  const workspace = task ? workbench.workspaces[task.workspaceId] : undefined;
  if (
    !task
    || !workspace
    || task.conversation.kind !== "session"
    || !task.sessionFileIdentity
    || task.sessionFileIdentity !== task.conversation.sessionFileIdentity
    || !workbench.selectTask(taskId)
  ) return false;
  workbench.updateTask(task.id, {
    lifecycle: "initializing",
    runtime: { phase: "starting", detail: `正在恢复任务：${task.title}`, recoverable: true }
  });
  useAppStore.setState({
    workspace: workspace.identity.canonicalPath,
    trust: workspace.trust
  });
  try {
    const registered = await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
    if (!registered) throw new Error("目标工作区当前不可用。");
    const identity = await ensureAgentConnection();
    const sameHost = task.recoveryHostInstanceId === identity.hostInstanceId
      && task.recoveryHostEpoch === identity.hostEpoch;
    if (sameHost) {
      const recovery = await resynchronizeRendererProjection(useAppStore.getState, useAppStore.setState, {
        hostEpoch: identity.hostEpoch,
        context: workbenchProtocolContextForTask(task),
        recoveringDetail: `正在重新连接任务：${task.title}`,
        readyDetail: "Pi SDK 已就绪",
        failureTitle: "无法恢复任务",
        deferRuntimeNotReady: true
      });
      if (recovery === "committed") {
        workbench.updateTask(task.id, {
          recoveryHostInstanceId: undefined,
          recoveryHostEpoch: undefined
        });
        clearTaskConversationAttention(task.id);
        return true;
      }
      if (recovery !== "runtime-not-ready") {
        if (recovery === "failed") markTaskRecoveryFailed(task.id);
        return false;
      }
    }
    return reopenRendererTask(task, workspace);
  } catch (error) {
    markTaskRecoveryFailed(task.id, error);
    return false;
  }
}

function runTaskActivationFlight(
  taskId: string,
  operation: () => Promise<boolean>
): Promise<boolean> {
  const existing = taskActivationFlights.get(taskId);
  if (existing) return existing;
  const flight = operation();
  taskActivationFlights.set(taskId, flight);
  void flight.finally(() => {
    if (taskActivationFlights.get(taskId) === flight) taskActivationFlights.delete(taskId);
  }).catch(() => undefined);
  return flight;
}

async function reopenRendererTask(
  task: RendererWorkbenchTask,
  workspace: Parameters<typeof openRendererWorkspaceDescriptor>[0]
): Promise<boolean> {
  const replacement = rotateRendererTaskForSessionOpen(task);
  if (!replacement) return false;
  return openRendererWorkspaceDescriptor(
    workspace,
    replacement.conversation.kind === "session" ? replacement.conversation.sessionPath : undefined,
    replacement.sessionFileIdentity
  );
}

function isSelectedRendererTask(task: RendererWorkbenchTask): boolean {
  const selected = selectedWorkbenchTask(rendererWorkbenchStore.getState());
  return selected?.id === task.id && selected.taskGeneration === task.taskGeneration;
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

function clearTaskConversationAttention(taskId: string): void {
  const task = rendererWorkbenchStore.getState().tasks[taskId];
  if (task?.conversation.kind === "session") {
    clearConversationAttention(task.workspaceId, task.conversation.sessionFileIdentity);
  }
}
