import type { SessionSummary } from "@pi67/domain";
import type { RendererWorkbenchTask } from "./workbench-store.js";

export function conversationPrimaryTitle(
  task: RendererWorkbenchTask,
  session: SessionSummary | undefined
): string {
  if (task.pendingTitle) return task.pendingTitle;
  if (task.titleSource === "explicit") return task.title;
  if (session && session.nameSource !== "fallback") return session.name;
  return task.recentUserMessagePreview ?? conversationStableTitle(task, session);
}

export function conversationStableTitle(
  task: RendererWorkbenchTask,
  session: SessionSummary | undefined
): string {
  if (task.titleSource === "explicit") return task.title;
  if (session && session.nameSource !== "fallback") return session.name;
  return isUnnamedConversationTitle(task.title) && session
    ? session.name
    : task.title;
}

/** Desktop Task placeholders plus Pi's Catalog fallback name; none identifies a conversation. */
export function isUnnamedConversationTitle(title: string): boolean {
  return title === "未命名会话" || title === "未命名任务" || title === "未命名对话";
}
