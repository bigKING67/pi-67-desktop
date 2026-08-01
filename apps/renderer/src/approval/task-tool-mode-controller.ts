import type { TaskToolMode } from "@pi67/domain";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import {
  rendererWorkbenchStore,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import { workbenchProtocolContextForTask } from "../workbench/workbench-protocol-context.js";

interface ToolModeFlight {
  mode: TaskToolMode;
  promise: Promise<boolean>;
}

const flights = new Map<string, ToolModeFlight>();

export function setTaskToolMode(taskId: string, mode: TaskToolMode): Promise<boolean> {
  const task = rendererWorkbenchStore.getState().tasks[taskId];
  if (!task) return Promise.resolve(false);
  if (task.toolMode === mode) return Promise.resolve(true);
  const existing = flights.get(taskId);
  if (existing) return existing.mode === mode ? existing.promise : Promise.resolve(false);

  let promise!: Promise<boolean>;
  promise = performToolModeChange(task, mode).finally(() => {
    if (flights.get(taskId)?.promise === promise) flights.delete(taskId);
  });
  flights.set(taskId, { mode, promise });
  return promise;
}

async function performToolModeChange(
  task: RendererWorkbenchTask,
  mode: TaskToolMode
): Promise<boolean> {
  if (task.sessionGeneration === undefined || task.sessionId.startsWith("pending:")) {
    publishNotification({
      level: "warning",
      title: "无法调整工具模式",
      message: "当前 Pi 会话尚未就绪。"
    });
    return false;
  }
  try {
    const result = await agentConnectionController.request(
      "task.toolMode.set",
      { mode },
      [],
      { context: workbenchProtocolContextForTask(task) }
    );
    const current = rendererWorkbenchStore.getState().tasks[task.id];
    if (!sameTaskAuthority(current, task)) return false;
    rendererWorkbenchStore.getState().updateTask(task.id, { toolMode: result.mode });
    return result.mode === mode;
  } catch (error) {
    publishNotification({
      level: "error",
      title: "无法调整工具模式",
      message: error instanceof Error ? error.message : "Pi 运行服务连接异常"
    });
    return false;
  }
}

function sameTaskAuthority(
  current: RendererWorkbenchTask | undefined,
  expected: RendererWorkbenchTask
): boolean {
  return current?.taskGeneration === expected.taskGeneration
    && current.sessionId === expected.sessionId
    && current.sessionGeneration === expected.sessionGeneration;
}
