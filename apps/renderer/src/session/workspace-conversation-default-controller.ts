import type { ConversationScopeChoice } from "@pi67/domain";
import { rendererWorkbenchStore, selectedWorkbenchTask } from "../workbench/workbench-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { persistRendererWorkbenchCheckpoint } from "../workbench/workbench-controller.js";
import { beginRendererSessionIntent } from "./session-creation-controller.js";

/** Explicit action only. A populated draft is never reclassified. */
export function selectDraftConversationScope(taskId: string, choice: ConversationScopeChoice): string | undefined {
  const task = selectedWorkbenchTask(rendererWorkbenchStore.getState());
  if (!task || task.id !== taskId || task.conversation.kind !== "provisional" || task.lifecycle !== "draft"
    || task.creationStatus !== undefined || task.environmentCreationState === "creating") return undefined;
  const teamScope = choice.kind === "team" ? { teamId: choice.teamId, projectId: choice.projectId } : undefined;
  if (JSON.stringify(task.scopeChoice) === JSON.stringify(choice)) return taskId;
  const draft = useTaskDraftStore.getState().drafts[taskId];
  if (!draft?.text.trim() && !draft?.attachments.length && !draft?.workspaceFiles.length
    && !draft?.reviewComments.length && !draft?.promptStash.length) {
    rendererWorkbenchStore.getState().updateTask(taskId, { teamScope, scopeChoice: { ...choice } });
    return taskId;
  }
  return beginRendererSessionIntent(task.workspaceId, { scopeChoice: choice, useWorkspaceDefault: false,
    ...(task.environmentIntent ? { environmentIntent: task.environmentIntent } : {}) });
}

export async function saveWorkspaceConversationDefault(workspaceId: string, choice: ConversationScopeChoice): Promise<void> {
  const state = rendererWorkbenchStore.getState();
  if (!state.workspaces[workspaceId]) throw new Error("工作区已关闭，无法保存默认归属。");
  const previous = state.conversationDefaults ?? [];
  const next = [...previous.filter(item => item.workspaceId !== workspaceId), { workspaceId, choice: { ...choice } }];
  rendererWorkbenchStore.setState({ conversationDefaults: next });
  try { await persistRendererWorkbenchCheckpoint(); }
  catch (error) {
    if (rendererWorkbenchStore.getState().conversationDefaults === next) rendererWorkbenchStore.setState({ conversationDefaults: previous });
    throw error;
  }
}
