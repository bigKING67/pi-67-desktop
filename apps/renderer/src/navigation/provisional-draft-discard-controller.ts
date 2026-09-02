import { publishNotification } from "../notifications/notification-store.js";
import { persistTaskDraftStateCheckpoint } from "../workbench/task-draft-persistence.js";
import {
  taskDraftHasUserContent,
  useTaskDraftStore,
  type TaskDraft
} from "../workbench/task-draft-store.js";
import {
  rendererWorkbenchStore,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import { useConversationDialogStore } from "./conversation-dialog-store.js";

export type ProvisionalDraftDiscardDisposition = "discard" | "confirm" | "blocked";

export function provisionalDraftDiscardDisposition(
  task: RendererWorkbenchTask | undefined,
  draft: TaskDraft | undefined
): ProvisionalDraftDiscardDisposition {
  if (
    !task
    || task.conversation.kind !== "provisional"
    || task.lifecycle !== "draft"
    || task.runtime.phase !== "stopped"
    || task.creationStatus !== undefined
  ) return "blocked";
  if (draft) return taskDraftHasUserContent(draft) ? "confirm" : "discard";
  return task.hasDraft || task.attachmentCount > 0 ? "confirm" : "discard";
}

export function requestProvisionalDraftDiscard(taskId: string, title: string): void {
  const task = rendererWorkbenchStore.getState().tasks[taskId];
  const draft = useTaskDraftStore.getState().drafts[taskId];
  const disposition = provisionalDraftDiscardDisposition(task, draft);
  if (disposition === "blocked") return;
  if (disposition === "confirm") {
    useConversationDialogStore.getState().openDraftDiscard({ taskId, title });
    return;
  }
  void discardProvisionalDraft(taskId);
}

export async function discardProvisionalDraft(taskId: string): Promise<boolean> {
  const task = rendererWorkbenchStore.getState().tasks[taskId];
  const draft = useTaskDraftStore.getState().drafts[taskId];
  if (provisionalDraftDiscardDisposition(task, draft) === "blocked") return false;
  if (!rendererWorkbenchStore.getState().removeRuntimeTask(taskId)) return false;
  useTaskDraftStore.getState().discard(taskId);
  try {
    await persistTaskDraftStateCheckpoint();
    publishNotification({
      level: "info",
      title: "草稿已丢弃",
      message: "没有创建或删除任何 Pi Session。"
    });
  } catch {
    publishNotification({
      level: "warning",
      title: "草稿已从当前窗口移除",
      message: "安全存储未能确认更新；重启后它可能重新出现。没有删除任何 Pi Session。"
    });
  }
  return true;
}
