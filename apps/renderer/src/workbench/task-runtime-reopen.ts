import { createMessageId } from "@pi67/protocol";
import { useTaskDraftStore } from "./task-draft-store.js";
import {
  rendererWorkbenchStore,
  type RendererWorkbenchTask
} from "./workbench-store.js";

export function rotateRendererTaskForSessionOpen(
  task: RendererWorkbenchTask
): RendererWorkbenchTask | undefined {
  if (
    task.conversation.kind !== "session"
    || !task.sessionFileIdentity
    || task.sessionFileIdentity !== task.conversation.sessionFileIdentity
  ) return undefined;

  const workbench = rendererWorkbenchStore.getState();
  const current = workbench.tasks[task.id];
  if (!current || current.taskGeneration !== task.taskGeneration) return undefined;

  const replacementId = createMessageId("task");
  const replacement: RendererWorkbenchTask = {
    id: replacementId,
    conversation: task.conversation,
    workspaceId: task.workspaceId,
    sessionId: `pending:${replacementId}`,
    taskGeneration: 1,
    sessionFileIdentity: task.sessionFileIdentity,
    lifecycle: "initializing",
    runtime: { phase: "starting", detail: `正在恢复任务：${task.title}`, recoverable: true },
    title: task.title,
    ...(task.titleSource === undefined ? {} : { titleSource: task.titleSource }),
    ...(task.pendingTitle === undefined ? {} : { pendingTitle: task.pendingTitle }),
    ...(task.recentUserMessagePreview === undefined
      ? {}
      : { recentUserMessagePreview: task.recentUserMessagePreview }),
    sessionPath: task.conversation.sessionPath,
    hasDraft: task.hasDraft,
    attachmentCount: task.attachmentCount,
    toolMode: task.toolMode
  };

  if (!workbench.removeRuntimeTask(task.id)) return undefined;
  if (workbench.openTask(replacement) === "workspace-missing") {
    workbench.openTask(task);
    return undefined;
  }

  const transfer = useTaskDraftStore.getState().transfer(task.id, replacement.id);
  if (transfer !== "conflict") return replacement;

  workbench.removeRuntimeTask(replacement.id);
  workbench.openTask(task);
  throw new Error("无法安全转移当前对话草稿。");
}
