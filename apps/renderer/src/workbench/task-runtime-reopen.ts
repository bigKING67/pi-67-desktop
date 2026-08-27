import { createMessageId, type AgentConnectionIdentity } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useTaskDraftStore } from "./task-draft-store.js";
import {
  rendererWorkbenchStore,
  type RendererWorkbenchTask
} from "./workbench-store.js";
import { rendererTaskTransitionDetail } from "./task-transition-detail.js";
import { workbenchProtocolContextForTask } from "./workbench-protocol-context.js";

export async function rotateRendererTaskForSessionReopen(
  task: RendererWorkbenchTask,
  options: { retireCurrentHostTask: boolean }
): Promise<RendererWorkbenchTask | undefined> {
  if (options.retireCurrentHostTask) {
    await agentConnectionController.request(
      "task.close",
      { mode: "dispose" },
      [],
      { context: workbenchProtocolContextForTask(task) }
    );
  }
  return rotateRendererTaskForSessionOpen(task);
}

export function rendererTaskBelongsToAgentHost(
  task: RendererWorkbenchTask,
  identity: AgentConnectionIdentity
): boolean {
  const hasRecoveryHostIdentity = task.recoveryHostInstanceId !== undefined
    || task.recoveryHostEpoch !== undefined;
  if (!hasRecoveryHostIdentity) {
    // A Task restored only from the encrypted Composer draft store has no
    // Agent Host ownership. Its synthetic pending Session id must not be used
    // for projection resync; reopen the physical JSONL Session instead. A
    // live projected Task is distinguishable by its authoritative Session
    // generation even though it does not retain recovery-only Host metadata.
    return task.sessionGeneration !== undefined;
  }
  return task.recoveryHostInstanceId === identity.hostInstanceId
    && task.recoveryHostEpoch === identity.hostEpoch;
}

function rotateRendererTaskForSessionOpen(
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
    runtime: { phase: "starting", detail: rendererTaskTransitionDetail(task, "restoring"), recoverable: true },
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
