import { createMessageId } from "@pi67/protocol";
import { messages } from "../localization/message-catalog.js";
import {
  rendererWorkbenchStore,
  type RendererTaskEnvironmentIntent,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";

export function beginPendingTask(
  sessionPath?: string,
  options: {
    workspaceId?: string;
    title?: string;
    creationId?: string;
    intent?: boolean;
    environmentIntent?: RendererTaskEnvironmentIntent;
  } = {}
): RendererWorkbenchTask | undefined {
  const workbench = rendererWorkbenchStore.getState();
  const workspaceId = options.workspaceId ?? workbench.currentWorkspaceId;
  if (!workspaceId || !workbench.workspaces[workspaceId]) return undefined;
  const taskId = createMessageId("task");
  const task: RendererWorkbenchTask = {
    id: taskId,
    conversation: { kind: "provisional", workspaceId, draftId: taskId },
    workspaceId,
    sessionId: `pending:${taskId}`,
    taskGeneration: 1,
    lifecycle: options.intent ? "draft" : "initializing",
    runtime: options.intent
      ? { phase: "stopped", detail: "首条消息尚未发送", recoverable: true }
      : { phase: "starting", detail: messages.runtime.session.starting, recoverable: true },
    title: options.title ?? messages.runtime.workbench.unnamedSession,
    ...(options.title ? { pendingTitle: options.title } : {}),
    ...(options.creationId ? { creationId: options.creationId } : {}),
    ...(options.environmentIntent && options.environmentIntent !== "local"
      ? { environmentIntent: options.environmentIntent }
      : {}),
    ...(sessionPath ? { sessionPath } : {}),
    hasDraft: false,
    attachmentCount: 0,
    toolMode: "auto",
    ...(options.creationId ? { creationStatus: "pending" as const } : {})
  };
  const result = workbench.openTask(task);
  return result === "workspace-missing" ? undefined : task;
}
