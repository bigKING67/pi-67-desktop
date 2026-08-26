import {
  conversationArchiveBlocker,
  type WorkspaceId
} from "@pi67/domain";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import {
  rendererWorkbenchStore,
  taskForConversation,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";

export interface RendererSessionLocator {
  fileIdentity: string;
  path: string;
}

export function taskForSession(
  workspaceId: WorkspaceId,
  session: RendererSessionLocator
): RendererWorkbenchTask | undefined {
  return taskForConversation(rendererWorkbenchStore.getState().tasks, {
    kind: "session",
    workspaceId,
    sessionFileIdentity: session.fileIdentity,
    sessionPath: session.path
  });
}

export function hasTaskDraft(task: RendererWorkbenchTask): boolean {
  const draft = useTaskDraftStore.getState().drafts[task.id];
  return task.hasDraft
    || task.attachmentCount > 0
    || Boolean(draft && (
      draft.text.trim()
      || draft.attachments.length > 0
      || draft.workspaceFiles.length > 0
    ));
}

export function archiveBlockerMessage(
  blocker: NonNullable<ReturnType<typeof conversationArchiveBlocker>>
): string {
  if (blocker === "active-task") return "任务仍在运行或等待输入，请先完成或停止任务。";
  if (blocker === "initializing") return "对话仍在初始化，请稍后再试。";
  if (blocker === "draft") return "输入框中仍有未发送内容，请发送或清空草稿。";
  return "尚未保存的新对话不能归档。";
}

export function snoozeBlockerMessage(
  blocker: NonNullable<ReturnType<typeof conversationArchiveBlocker>>
): string {
  if (blocker === "active-task") return "任务仍在运行、等待批准或等待扩展输入，请先处理或停止任务。";
  if (blocker === "initializing") return "对话仍在初始化，请稍后再试。";
  if (blocker === "draft") return "输入框中仍有未发送内容，请先发送、暂存或清空草稿。";
  return "尚未保存的新对话不能稍后处理。";
}

export function formatSnoozeUntil(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}

export function conversationOrganizationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Pi 运行服务未能完成操作。";
}
