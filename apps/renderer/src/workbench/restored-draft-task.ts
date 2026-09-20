import type { ComposerDraftRecord } from "@pi67/domain";
import { createMessageId } from "@pi67/protocol";
import type { RendererWorkbenchTask } from "./workbench-store.js";

export function restoredTask(record: ComposerDraftRecord): RendererWorkbenchTask {
  const conversation = record.conversation;
  const taskId = conversation.kind === "provisional" ? conversation.draftId : createMessageId("draft-task");
  return {
    id: taskId,
    conversation,
    workspaceId: conversation.workspaceId,
    sessionId: `pending:${taskId}`,
    taskGeneration: 1,
    ...(conversation.kind === "session"
      ? { sessionFileIdentity: conversation.sessionFileIdentity, sessionPath: conversation.sessionPath }
      : {}),
    lifecycle: conversation.kind === "provisional" ? "draft" : "stopped",
    runtime: {
      phase: "stopped",
      detail: conversation.kind === "provisional" ? "首条消息尚未发送" : "对话草稿等待恢复",
      recoverable: true
    },
    title: "未命名会话",
    titleSource: "fallback",
    ...(record.environmentIntent ? { environmentIntent: record.environmentIntent } : {}),
    ...(record.teamScope ? { teamScope: { ...record.teamScope } } : {}),
    hasDraft: true,
    attachmentCount: 0,
    toolMode: "auto"
  };
}
