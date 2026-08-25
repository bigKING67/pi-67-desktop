import {
  selectConversationSessionSummary,
  useSessionCatalogStore
} from "../navigation/session-catalog-store.js";
import { conversationPrimaryTitle } from "./conversation-title.js";
import type { RendererWorkbenchTask } from "./workbench-store.js";

export type TaskTransitionPhase = "recovering" | "ready" | "restoring" | "reconnecting";

export function rendererTaskTransitionDetail(
  task: RendererWorkbenchTask,
  phase: TaskTransitionPhase
): string {
  const session = selectConversationSessionSummary(
    useSessionCatalogStore.getState(),
    task.conversation
  );
  const title = conversationPrimaryTitle(task, session).trim();
  const copy = {
    recovering: { titled: "正在切换至", untitled: "正在切换对话" },
    ready: { titled: "已切换至", untitled: "已切换到对话" },
    restoring: { titled: "正在恢复", untitled: "正在恢复对话" },
    reconnecting: { titled: "正在重新连接", untitled: "正在重新连接对话" }
  }[phase];
  if (title === "未命名会话" || title === "未命名任务" || title === "未命名对话") {
    return copy.untitled;
  }
  return `${copy.titled}「${title}」`;
}
