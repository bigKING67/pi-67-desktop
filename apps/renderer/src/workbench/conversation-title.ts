import type { SessionSummary } from "@pi67/domain";
import type { RendererWorkbenchTask } from "./workbench-store.js";

export function conversationPrimaryTitle(
  task: RendererWorkbenchTask,
  session: SessionSummary | undefined
): string {
  return task.pendingTitle ?? task.recentUserMessagePreview ?? conversationStableTitle(task, session);
}

export function conversationStableTitle(
  task: RendererWorkbenchTask,
  session: SessionSummary | undefined
): string {
  return ["未命名会话", "未命名任务"].includes(task.title) && session
    ? session.name
    : task.title;
}
