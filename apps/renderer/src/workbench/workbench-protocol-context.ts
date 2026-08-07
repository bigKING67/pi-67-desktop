import {
  APP_PROTOCOL_CONTEXT,
  type ProtocolContext,
  type TaskProtocolContext
} from "@pi67/protocol";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  type RendererWorkbenchTask
} from "./workbench-store.js";

export function currentWorkbenchProtocolContext(): ProtocolContext {
  const workbench = rendererWorkbenchStore.getState();
  const task = selectedWorkbenchTask(workbench);
  if (task) return workbenchProtocolContextForTask(task);
  return workbench.currentWorkspaceId
    ? { scope: "workspace", workspaceId: workbench.currentWorkspaceId }
    : APP_PROTOCOL_CONTEXT;
}

export function workbenchProtocolContextForTask(
  task: RendererWorkbenchTask
): TaskProtocolContext {
  const hasSessionAuthority = !task.sessionId.startsWith("pending:")
    && task.sessionFileIdentity !== undefined
    && task.sessionGeneration !== undefined;
  return {
    scope: "task",
    workspaceId: task.workspaceId,
    taskId: task.id,
    taskGeneration: task.taskGeneration,
    ...(hasSessionAuthority
      ? {
          sessionId: task.sessionId,
          sessionFileIdentity: task.sessionFileIdentity,
          sessionGeneration: task.sessionGeneration
        }
      : {})
  };
}
