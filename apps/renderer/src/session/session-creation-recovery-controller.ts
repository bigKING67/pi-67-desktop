import type { SessionCreationResolution } from "@pi67/protocol";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { messages } from "../localization/message-catalog.js";
import { findSessionForRecovery } from "../navigation/session-catalog-controller.js";
import { publishNotification } from "../notifications/notification-store.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask
} from "../workbench/workbench-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";

export type RendererSessionCreationRecheckResult =
  | "materialized"
  | "still-unconfirmed"
  | "unavailable";

export async function recheckUnconfirmedRendererSession(
  taskId: string,
  options: { notify?: boolean } = {}
): Promise<RendererSessionCreationRecheckResult> {
  const task = rendererWorkbenchStore.getState().tasks[taskId];
  if (
    !task
    || task.creationStatus !== "unconfirmed"
    || task.conversation.kind !== "provisional"
    || !task.creationId
  ) return "unavailable";

  let resolution: SessionCreationResolution;
  try {
    resolution = await agentConnectionController.request(
      "session.creation.resolve",
      { creationId: task.creationId },
      [],
      { context: { scope: "workspace", workspaceId: task.workspaceId } }
    );
  } catch {
    notifyUnavailable(options.notify);
    return "unavailable";
  }
  if (resolution.status === "unavailable") {
    notifyUnavailable(options.notify);
    return "unavailable";
  }
  if (resolution.status !== "materialized") {
    notifyUnresolved(options.notify);
    return "still-unconfirmed";
  }

  const catalog = await findSessionForRecovery(
    task.workspaceId,
    resolution.sessionId,
    resolution.sessionPath
  );
  if (catalog.status === "unavailable") {
    notifyUnavailable(options.notify);
    return "unavailable";
  }
  if (catalog.status === "missing") {
    notifyUnresolved(options.notify);
    return "still-unconfirmed";
  }

  const workbench = rendererWorkbenchStore.getState();
  const current = workbench.tasks[taskId];
  const existingOwner = Object.values(workbench.tasks).find((candidate) => (
    candidate.id !== taskId
    && candidate.workspaceId === task.workspaceId
    && (
      candidate.sessionId === resolution.sessionId
      || candidate.sessionPath === resolution.sessionPath
    )
  ));
  if (
    existingOwner
    || !current
    || current.taskGeneration !== task.taskGeneration
    || current.creationId !== task.creationId
    || current.creationStatus !== "unconfirmed"
    || current.conversation.kind !== "provisional"
  ) {
    notifyUnresolved(options.notify);
    return "still-unconfirmed";
  }
  const materializedRuntime = {
    phase: "stopped" as const,
    detail: messages.runtime.workbench.sessionPendingOpen,
    recoverable: true
  };
  workbench.updateTask(taskId, {
    conversation: {
      kind: "session",
      workspaceId: task.workspaceId,
      sessionPath: resolution.sessionPath
    },
    sessionId: resolution.sessionId,
    sessionPath: resolution.sessionPath,
    lifecycle: "stopped",
    runtime: materializedRuntime,
    title: catalog.session.name,
    titleSource: catalog.session.nameSource,
    creationId: undefined,
    creationStatus: undefined
  });
  if (selectedWorkbenchTask(rendererWorkbenchStore.getState())?.id === taskId) {
    useAppStore.setState({
      sessionTransitionPending: false,
      sessionBootstrapTransitionPending: false,
      runtime: materializedRuntime
    });
  }
  if (options.notify !== false) {
    publishNotification({
      level: "success",
      title: messages.runtime.session.creationRecheckMatched,
      message: messages.runtime.session.creationRecheckMatchedDetail
    });
  }
  return "materialized";
}

export async function reconcileUnconfirmedRendererSessions(
  workspaceId?: string
): Promise<void> {
  const taskIds = Object.values(rendererWorkbenchStore.getState().tasks)
    .filter((task) => (
      task.creationStatus === "unconfirmed"
      && task.creationId !== undefined
      && (workspaceId === undefined || task.workspaceId === workspaceId)
    ))
    .map((task) => task.id);
  for (const taskId of taskIds) {
    await recheckUnconfirmedRendererSession(taskId, { notify: false });
  }
}

export function dismissUnconfirmedRendererSession(taskId: string): boolean {
  const workbench = rendererWorkbenchStore.getState();
  const task = workbench.tasks[taskId];
  if (!task || task.creationStatus !== "unconfirmed" || task.conversation.kind !== "provisional") return false;
  const draft = useTaskDraftStore.getState().drafts[taskId];
  if (
    task.hasDraft
    || task.attachmentCount > 0
    || Boolean(draft && (draft.text.trim().length > 0 || draft.attachments.length > 0))
  ) {
    publishNotification({
      level: "warning",
      title: messages.runtime.session.creationDismissBlocked,
      message: messages.runtime.session.creationDismissBlockedDetail
    });
    return false;
  }
  const wasSelected = selectedWorkbenchTask(workbench)?.id === taskId;
  if (!workbench.removeRuntimeTask(taskId)) return false;
  useTaskDraftStore.getState().discard(taskId);
  if (wasSelected) {
    const nextTask = selectedWorkbenchTask(rendererWorkbenchStore.getState());
    useAppStore.setState({
      sessionTransitionPending: false,
      sessionBootstrapTransitionPending: false,
      runtime: nextTask?.runtime ?? {
        phase: "stopped",
        detail: messages.runtime.workbench.workspaceRestored,
        recoverable: true
      }
    });
  }
  publishNotification({
    level: "info",
    title: messages.runtime.session.creationDismissed,
    message: messages.runtime.session.creationDismissedDetail
  });
  return true;
}

function notifyUnavailable(notify = true): void {
  if (!notify) return;
  publishNotification({
    level: "warning",
    title: messages.runtime.session.creationRecheckUnavailable,
    message: messages.runtime.session.creationRecheckUnavailableDetail
  });
}

function notifyUnresolved(notify = true): void {
  if (!notify) return;
  publishNotification({
    level: "warning",
    title: messages.runtime.session.creationRecheckUnresolved,
    message: messages.runtime.session.creationRecheckUnresolvedDetail
  });
}
