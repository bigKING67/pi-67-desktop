import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { createMessageId } from "@pi67/protocol";
import { publishNotification } from "../notifications/notification-store.js";
import { messages } from "../localization/message-catalog.js";
import { useAppStore } from "../app/app-store.js";
import type { AppState } from "../app/app-store.types.js";
import {
  runIncrementalSessionTransition,
  runSessionBootstrapTransition
} from "../app/session-transition.js";
import { activateRendererTask } from "../workbench/task-activation-controller.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { submitRendererPrompt } from "../composer/prompt-submission-controller.js";
import { currentRendererSessionAuthority } from "./session-authority.js";
import { isActiveOperationLifecycle } from "../operation/operation-lifecycle.js";
import { resynchronizeRendererProjection } from "../connection/projection-recovery-controller.js";
import { workbenchProtocolContextForTask } from "../workbench/workbench-protocol-context.js";

type StoreGet = () => AppState;
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export async function createRendererSession(): Promise<void> {
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  if (!get().workspace || get().sessionTransitionPending) return;
  const task = beginPendingTask();
  if (!task) return;
  await runSessionBootstrapTransition(get, set, {
    detail: messages.runtime.session.creating,
    refreshSessionCatalogFor: task.workspaceId,
    onError: (error) => {
      rendererWorkbenchStore.getState().updateTask(task.id, {
        lifecycle: "failed",
        runtime: { phase: "failed", detail: messages.runtime.session.createFailed, recoverable: true }
      });
      reportSessionError(error, set, messages.runtime.session.createFailed);
    },
    request: () => agentConnectionController.request("session.create", {})
  });
}

export async function openRendererSession(
  path: string
): Promise<void> {
  const existing = Object.values(rendererWorkbenchStore.getState().tasks).find((task) => task.sessionPath === path);
  if (existing) {
    await activateRendererTask(existing.id);
    return;
  }
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  if (get().sessionTransitionPending) return;
  const task = beginPendingTask(path);
  if (!task) return;
  const workspace = get().workspace;
  await runSessionBootstrapTransition(get, set, {
    detail: messages.runtime.connection.restoringSession,
    refreshSessionCatalogFor: task.workspaceId,
    onError: (error) => {
      rendererWorkbenchStore.getState().updateTask(task.id, {
        lifecycle: "failed",
        runtime: { phase: "failed", detail: messages.runtime.connection.restoreSessionFailed, recoverable: true }
      });
      reportSessionError(error, set, messages.runtime.connection.restoreSessionFailed);
    },
    request: () => agentConnectionController.request("session.open", {
      path,
      ...(workspace ? { cwdOverride: workspace } : {})
    })
  });
}

export function sessionForkActionBlockedReason(): string | undefined {
  const state = useAppStore.getState();
  if (state.sessionTransitionPending) return messages.transcript.actionWhileTransitioning;
  const authority = currentRendererSessionAuthority(state);
  const task = selectedWorkbenchTask(rendererWorkbenchStore.getState());
  if (
    !state.workspace
    || !authority
    || !task
    || !task.sessionPath
    || task.sessionId !== authority.sessionId
    || task.sessionGeneration !== authority.sessionGeneration
  ) return messages.transcript.actionUnavailable;
  if (
    state.operation
    && isActiveOperationLifecycle(state.operation.lifecycle)
    && state.operation.sessionId === authority.sessionId
    && state.operation.sessionGeneration === authority.sessionGeneration
  ) return messages.transcript.actionWhileRunning;
  return undefined;
}

export async function continueRendererSessionFrom(entryId: string): Promise<boolean> {
  const blockedReason = sessionForkActionBlockedReason();
  if (blockedReason) {
    return reportBlockedFork(messages.transcript.continueInNewTask, blockedReason);
  }
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  const workbench = rendererWorkbenchStore.getState();
  const sourceTask = selectedWorkbenchTask(workbench);
  const sourceAuthority = currentRendererSessionAuthority(get());
  if (
    !sourceTask
    || !sourceAuthority
    || sourceTask.sessionGeneration === undefined
    || sourceTask.sessionGeneration !== sourceAuthority.sessionGeneration
  ) {
    return reportBlockedFork(
      messages.transcript.continueInNewTask,
      messages.transcript.actionUnavailable
    );
  }
  const targetTask = beginPendingTask(undefined, {
    workspaceId: sourceTask.workspaceId,
    title: messages.transcript.continuedTaskTitle(sourceTask.title)
  });
  if (!targetTask) return false;
  let transitionError: unknown;
  const committed = await runSessionBootstrapTransition(get, set, {
    detail: messages.runtime.session.forking,
    refreshSessionCatalogFor: sourceTask.workspaceId,
    onError: (error) => {
      transitionError = error;
    },
    request: () => agentConnectionController.request("session.forkFromTask", {
      sourceTaskId: sourceTask.id,
      sourceTaskGeneration: sourceTask.taskGeneration,
      sourceSessionId: sourceAuthority.sessionId,
      sourceSessionGeneration: sourceAuthority.sessionGeneration,
      entryId
    }, [], { context: workbenchProtocolContextForTask(targetTask) })
  });
  if (committed) return true;

  const cleanupError = await disposeContinuationTarget(targetTask);
  const currentWorkbench = rendererWorkbenchStore.getState();
  currentWorkbench.removeRuntimeTask(targetTask.id);
  currentWorkbench.selectTask(sourceTask.id);
  await activateRendererTask(sourceTask.id);
  const failureDetail = transitionError === undefined
    ? messages.transcript.actionUnavailable
    : errorMessage(transitionError);
  publishNotification({
    level: "error",
    title: messages.transcript.continueFailed,
    message: cleanupError
      ? `${failureDetail} ${messages.transcript.continueCleanupFailed(cleanupError)}`
      : failureDetail
  });
  return false;
}

export type RendererUserMessageEditResult =
  | { status: "accepted" }
  | { status: "prepared"; error: string }
  | { status: "failed"; error: string };

export async function editRendererUserMessage(
  taskId: string,
  entryId: string,
  text: string
): Promise<RendererUserMessageEditResult> {
  const task = selectedWorkbenchTask(rendererWorkbenchStore.getState());
  if (!task || task.id !== taskId) {
    return blockedMessageEdit(messages.transcript.actionUnavailable);
  }
  const draft = useTaskDraftStore.getState().drafts[task.id];
  if (draft && (draft.text.trim().length > 0 || draft.attachments.length > 0)) {
    return blockedMessageEdit(messages.composer.editBlockedByDraft);
  }
  if (!text.trim()) {
    return blockedMessageEdit(messages.transcript.noCopyText);
  }
  const forked = await forkCurrentRendererSessionBefore(task, entryId);
  if (!forked) {
    return { status: "failed", error: messages.runtime.session.forkFailed };
  }
  return submitRendererEditedMessage(taskId, text);
}

export async function submitRendererEditedMessage(
  taskId: string,
  text: string
): Promise<RendererUserMessageEditResult> {
  const normalized = text.trim();
  if (!normalized) return blockedMessageEdit(messages.transcript.noCopyText);
  const task = selectedWorkbenchTask(rendererWorkbenchStore.getState());
  if (!task || task.id !== taskId) {
    return blockedMessageEdit(messages.transcript.actionUnavailable);
  }
  const draft = useTaskDraftStore.getState().drafts[task.id];
  if (draft && (draft.text.trim().length > 0 || draft.attachments.length > 0)) {
    return blockedMessageEdit(messages.composer.editBlockedByDraft);
  }
  let result: Awaited<ReturnType<typeof submitRendererPrompt>>;
  try {
    result = await submitRendererPrompt(
      normalized,
      "send",
      createMessageId("submission")
    );
  } catch (error) {
    return { status: "prepared", error: errorMessage(error) };
  }
  return result.accepted
    ? { status: "accepted" }
    : { status: "prepared", error: result.error };
}

export async function restoreRendererMessageEdit(
  taskId: string,
  sourceSessionPath: string
): Promise<boolean> {
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  const task = selectedWorkbenchTask(rendererWorkbenchStore.getState());
  if (!task || task.id !== taskId || get().sessionTransitionPending) return false;
  const workspace = get().workspace;
  let transitionError: unknown;
  const committed = await runSessionBootstrapTransition(get, set, {
    detail: messages.transcript.restoringEditedMessage,
    refreshSessionCatalogFor: task.workspaceId,
    preserveCurrentProjectionDuringRequest: true,
    onError: (error) => {
      transitionError = error;
    },
    request: () => agentConnectionController.request(
      "session.open",
      {
        path: sourceSessionPath,
        ...(workspace ? { cwdOverride: workspace } : {})
      },
      [],
      { context: workbenchProtocolContextForTask(task) }
    )
  });
  if (committed) return true;
  if (transitionError !== undefined) {
    publishNotification({
      level: "error",
      title: messages.transcript.restoreEditFailed,
      message: errorMessage(transitionError)
    });
  }
  return false;
}

async function forkCurrentRendererSessionBefore(
  task: RendererWorkbenchTask,
  entryId: string
): Promise<boolean> {
  const blockedReason = sessionForkActionBlockedReason();
  if (blockedReason) {
    return reportBlockedFork(messages.transcript.editMessage, blockedReason);
  }
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  const hostEpoch = get().hostEpoch;
  if (hostEpoch === undefined) return false;
  let transitionError: unknown;
  const committed = await runSessionBootstrapTransition(get, set, {
    detail: messages.runtime.session.forking,
    refreshSessionCatalogFor: task.workspaceId,
    preserveCurrentProjectionDuringRequest: true,
    onError: (error) => {
      transitionError = error;
    },
    request: () => agentConnectionController.request(
      "session.fork",
      { entryId, position: "before" },
      [],
      { context: workbenchProtocolContextForTask(task) }
    )
  });
  if (committed) return true;
  if (transitionError === undefined) return false;

  const detail = errorMessage(transitionError);
  const recovery = await resynchronizeRendererProjection(get, set, {
    hostEpoch,
    recoveringDetail: messages.runtime.connection.restoringSession,
    readyDetail: messages.runtime.connection.sessionRestored,
    failureTitle: messages.runtime.connection.restoreSessionFailed
  });
  publishNotification({
    level: "error",
    title: messages.runtime.session.forkFailed,
    message: recovery === "committed"
      ? `${detail} ${messages.runtime.session.forkRecovered}`
      : detail
  });
  return false;
}

function blockedMessageEdit(message: string): RendererUserMessageEditResult {
  reportBlockedFork(messages.transcript.editMessage, message);
  return { status: "failed", error: message };
}

function reportBlockedFork(title: string, message: string): false {
  publishNotification({ level: "warning", title, message });
  return false;
}

function beginPendingTask(
  sessionPath?: string,
  options: { workspaceId?: string; title?: string } = {}
): RendererWorkbenchTask | undefined {
  const workbench = rendererWorkbenchStore.getState();
  const workspaceId = options.workspaceId ?? workbench.currentWorkspaceId;
  if (!workspaceId || !workbench.workspaces[workspaceId]) return undefined;
  const taskId = createMessageId("task");
  const task: RendererWorkbenchTask = {
    id: taskId,
    conversation: sessionPath
      ? { kind: "session", workspaceId, sessionPath }
      : { kind: "provisional", workspaceId, draftId: taskId },
    workspaceId,
    sessionId: `pending:${taskId}`,
    taskGeneration: 1,
    lifecycle: "initializing",
    runtime: { phase: "starting", detail: messages.runtime.session.starting, recoverable: true },
    title: options.title ?? messages.runtime.workbench.unnamedSession,
    ...(options.title ? { pendingTitle: options.title } : {}),
    ...(sessionPath ? { sessionPath } : {}),
    hasDraft: false,
    attachmentCount: 0
  };
  const result = workbench.openTask(task);
  return result === "workspace-missing" ? undefined : task;
}

async function disposeContinuationTarget(task: RendererWorkbenchTask): Promise<string | undefined> {
  try {
    await agentConnectionController.request(
      "task.close",
      { mode: "dispose" },
      [],
      { context: workbenchProtocolContextForTask(task) }
    );
    return undefined;
  } catch (error) {
    return errorMessage(error);
  }
}

export async function rollbackRendererSession(entryId: string): Promise<void> {
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  await runIncrementalSessionTransition(get, set, {
    detail: messages.runtime.session.rollingBack,
    readyDetail: messages.runtime.session.rolledBack,
    refreshChanges: true,
    onError: (error) => reportSessionError(error, set, messages.runtime.session.rollbackFailed),
    request: () => agentConnectionController.request("session.rollback", { entryId })
  });
}

function reportSessionError(error: unknown, set: StoreSet, title: string): void {
  const detail = errorMessage(error);
  publishNotification({ level: "error", title, message: detail });
  set({ runtime: { phase: "failed", detail: `${title}：${detail}`, recoverable: true } });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : messages.runtime.unknownError;
}
