import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useTaskDraftStore } from "./task-draft-store.js";
import { rendererWorkbenchStore } from "./workbench-store.js";
import { workbenchProtocolContextForTask } from "./workbench-protocol-context.js";

export async function stopRendererTask(taskId: string): Promise<boolean> {
  const task = rendererWorkbenchStore.getState().tasks[taskId];
  if (!task) return false;
  const runtimeMayExist = task.runtime.phase !== "stopped" && task.lifecycle !== "lost";
  if (runtimeMayExist && !agentConnectionController.identity) {
    publishNotification({
      level: "error",
      title: "无法停止任务",
      message: "Pi 运行服务尚未连接。会话和草稿已保留。"
    });
    return false;
  }
  if (runtimeMayExist) {
    try {
      await agentConnectionController.request(
        "task.close",
        { mode: "stop" },
        [],
        { context: workbenchProtocolContextForTask(task) }
      );
    } catch (error) {
      publishNotification({
        level: "error",
        title: "无法停止任务",
        message: `${error instanceof Error ? error.message : "未知错误"}。会话和草稿已保留。`
      });
      return false;
    }
  }
  useTaskDraftStore.getState().discard(task.id);
  return rendererWorkbenchStore.getState().removeRuntimeTask(task.id);
}
