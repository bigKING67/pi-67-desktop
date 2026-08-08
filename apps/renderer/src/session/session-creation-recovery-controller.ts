import type { SessionCreationResolution } from "@pi67/protocol";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useSessionProjectionStore } from "./session-projection-store.js";
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
  options: {
    notify?: boolean;
    activateTask?: (taskId: string) => Promise<boolean>;
  } = {}
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

  const workbench = rendererWorkbenchStore.getState();
  const current = workbench.tasks[taskId];
  if (
    !current
    || current.taskGeneration !== task.taskGeneration
    || current.creationId !== task.creationId
    || current.creationStatus !== "unconfirmed"
    || current.conversation.kind !== "provisional"
  ) {
    notifyUnresolved(options.notify);
    return "still-unconfirmed";
  }
  const identityConflict = Object.values(workbench.tasks).find((candidate) => (
    candidate.id !== taskId
    && candidate.workspaceId === task.workspaceId
    && (
      (
        candidate.sessionFileIdentity === resolution.sessionFileIdentity
        && candidate.sessionId !== resolution.sessionId
      )
      || (
        candidate.sessionPath === resolution.sessionPath
        && candidate.sessionFileIdentity !== undefined
        && candidate.sessionFileIdentity !== resolution.sessionFileIdentity
      )
    )
  ));
  if (identityConflict) {
    notifyUnresolved(options.notify);
    return "still-unconfirmed";
  }
  const existingOwner = Object.values(workbench.tasks).find((candidate) => (
    candidate.id !== taskId
    && candidate.workspaceId === task.workspaceId
    && candidate.sessionFileIdentity === resolution.sessionFileIdentity
    && candidate.sessionId === resolution.sessionId
  ));
  if (existingOwner) {
    const wasSelected = selectedWorkbenchTask(workbench)?.id === current.id;
    const ownerIsStopped = existingOwner.runtime.phase === "stopped"
      || existingOwner.lifecycle === "stopped";
    const projection = useSessionProjectionStore.getState().authority;
    const projectionFileIdentity = useSessionProjectionStore.getState().identity?.sessionFileIdentity;
    const ownerProjectionIsActive = projection.phase === "active"
      && projection.sessionId === existingOwner.sessionId
      && projection.sessionGeneration === existingOwner.sessionGeneration
      && projectionFileIdentity === existingOwner.sessionFileIdentity;
    if (wasSelected && !ownerIsStopped && !ownerProjectionIsActive && !options.activateTask) {
      notifyUnresolved(options.notify);
      return "still-unconfirmed";
    }
    const transfer = useTaskDraftStore.getState().transfer(current.id, existingOwner.id);
    const sourceHasContent = current.hasDraft || current.attachmentCount > 0;
    if (transfer === "conflict" || (transfer === "empty" && sourceHasContent)) {
      if (options.notify !== false) {
        publishNotification({
          level: "warning",
          title: messages.runtime.session.creationRecheckMatched,
          message: messages.runtime.session.creationMergeConflict
        });
      }
      return "still-unconfirmed";
    }
    if (transfer === "moved") {
      const moved = useTaskDraftStore.getState().drafts[existingOwner.id];
      workbench.updateTask(existingOwner.id, {
        hasDraft: Boolean(moved?.text.trim()),
        attachmentCount: moved?.attachments.length ?? 0
      });
    }
    workbench.removeRuntimeTask(current.id);
    if (wasSelected) {
      workbench.selectTask(existingOwner.id);
      if (ownerIsStopped || ownerProjectionIsActive) {
        useAppStore.setState({
          sessionTransitionPending: false,
          sessionBootstrapTransitionPending: false,
          runtime: existingOwner.runtime
        });
      } else {
        await options.activateTask!(existingOwner.id);
      }
    }
    notifyMaterialized(options.notify);
    return "materialized";
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
      sessionFileIdentity: resolution.sessionFileIdentity,
      sessionPath: resolution.sessionPath
    },
    sessionId: resolution.sessionId,
    sessionFileIdentity: resolution.sessionFileIdentity,
    sessionPath: resolution.sessionPath,
    lifecycle: "stopped",
    runtime: materializedRuntime,
    creationId: undefined,
    creationStatus: undefined,
    sessionMetadataStatus: "indexing"
  });
  if (selectedWorkbenchTask(rendererWorkbenchStore.getState())?.id === taskId) {
    useAppStore.setState({
      sessionTransitionPending: false,
      sessionBootstrapTransitionPending: false,
      runtime: materializedRuntime
    });
  }
  notifyMaterialized(options.notify);
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
    || Boolean(draft && (
      draft.text.trim().length > 0
      || draft.attachments.length > 0
      || draft.workspaceFiles.length > 0
    ))
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

function notifyMaterialized(notify = true): void {
  if (!notify) return;
  publishNotification({
    level: "success",
    title: messages.runtime.session.creationRecheckMatched,
    message: messages.runtime.session.creationRecheckMatchedDetail
  });
}
