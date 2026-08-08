import { createMessageId, ProtocolRequestError } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { messages } from "../localization/message-catalog.js";
import { useAppStore } from "../app/app-store.js";
import type { AppState } from "../app/app-store.types.js";
import { runSessionBootstrapTransition } from "../app/session-transition.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  type RendererTaskEnvironmentIntent,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { workbenchProtocolContextForTask } from "../workbench/workbench-protocol-context.js";
import {
  commitWorktreeSessionEnvironment,
  prepareWorktreeSessionEnvironment
} from "../worktree/worktree-session-environment-controller.js";
import {
  ensureRendererSessionCreationAuthority,
  selectPendingRendererSessionCreation
} from "./session-creation-authority.js";
import { markRendererSessionCreationUnconfirmed } from "./session-creation-lifecycle.js";
import { reportSessionError, sessionErrorMessage } from "./session-controller-error.js";
import { beginPendingTask } from "./pending-session-task.js";

type StoreGet = () => AppState;
type StoreSet = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export type RendererSessionMaterializationResult =
  | { status: "materialized" }
  | { status: "failed" | "unconfirmed"; error: string };

export function beginRendererSessionIntent(
  workspaceId?: string,
  options: { environmentIntent?: RendererTaskEnvironmentIntent } = {}
): string | undefined {
  const state = useAppStore.getState();
  if (state.sessionTransitionPending || state.workspaceOpenPending) return undefined;
  if (selectPendingRendererSessionCreation()) return undefined;
  const workbench = rendererWorkbenchStore.getState();
  const targetWorkspaceId = workspaceId ?? workbench.currentWorkspaceId;
  if (!targetWorkspaceId || !workbench.workspaces[targetWorkspaceId]) return undefined;
  const selected = selectedWorkbenchTask(workbench);
  const selectedDraft = selected ? useTaskDraftStore.getState().drafts[selected.id] : undefined;
  if (
    selected?.workspaceId === targetWorkspaceId
    && selected.conversation.kind === "provisional"
    && selected.creationStatus === undefined
    && !selectedDraft?.text.trim()
    && (selectedDraft?.attachments.length ?? 0) === 0
    && (selectedDraft?.workspaceFiles.length ?? 0) === 0
  ) return selected.id;
  return beginPendingTask(undefined, {
    workspaceId: targetWorkspaceId,
    intent: true,
    ...(options.environmentIntent ? { environmentIntent: options.environmentIntent } : {})
  })?.id;
}

export async function createRendererSession(): Promise<void> {
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  if (!get().workspace || get().sessionTransitionPending || get().workspaceOpenPending) return;
  if (selectPendingRendererSessionCreation()) return;
  const workspace = get().workspace;
  const workspaceId = rendererWorkbenchStore.getState().currentWorkspaceId;
  if (!workspaceId) return;
  try {
    await ensureRendererSessionCreationAuthority();
  } catch (error) {
    if (get().workspace === workspace) {
      reportSessionError(error, set, messages.runtime.session.createFailed);
    }
    return;
  }
  if (
    get().workspace !== workspace
    || get().sessionTransitionPending
    || get().workspaceOpenPending
    || rendererWorkbenchStore.getState().currentWorkspaceId !== workspaceId
    || selectPendingRendererSessionCreation()
  ) return;
  const creationId = createMessageId("session-creation");
  const task = beginPendingTask(undefined, { creationId });
  if (!task) return;
  await runRendererSessionCreation(task, creationId, get, set);
}

export async function materializeRendererSessionIntent(
  taskId: string
): Promise<RendererSessionMaterializationResult> {
  const get: StoreGet = useAppStore.getState;
  const set: StoreSet = useAppStore.setState;
  const before = rendererWorkbenchStore.getState().tasks[taskId];
  if (
    !before
    || before.conversation.kind !== "provisional"
    || before.creationStatus !== undefined
    || selectedWorkbenchTask(rendererWorkbenchStore.getState())?.id !== taskId
  ) {
    return { status: "failed", error: "当前新对话草稿已失效，请重新选择后再发送。" };
  }
  try {
    await ensureRendererSessionCreationAuthority();
  } catch (error) {
    if (rendererWorkbenchStore.getState().tasks[taskId]?.taskGeneration === before.taskGeneration) {
      reportSessionError(error, set, messages.runtime.session.createFailed);
    }
    return { status: "failed", error: sessionErrorMessage(error) };
  }
  const workbench = rendererWorkbenchStore.getState();
  const current = workbench.tasks[taskId];
  if (
    !current
    || current.taskGeneration !== before.taskGeneration
    || current.conversation.kind !== "provisional"
    || current.creationStatus !== undefined
    || selectedWorkbenchTask(workbench)?.id !== taskId
    || get().sessionTransitionPending
    || get().workspaceOpenPending
  ) {
    return { status: "failed", error: "当前新对话草稿已变化，请重新确认后再发送。" };
  }
  if (current.environmentIntent === "worktree") {
    const prepared = await prepareWorktreeSessionEnvironment(taskId);
    if (prepared.status !== "prepared") return prepared;
    const materialized = await runRendererSessionCreation(
      prepared.task,
      prepared.creationId,
      get,
      set
    );
    if (materialized.status !== "materialized") return materialized;
    const committed = await commitWorktreeSessionEnvironment(taskId, prepared.creationId);
    return committed.status === "committed"
      ? materialized
      : { status: "unconfirmed", error: committed.error };
  }
  const creationId = createMessageId("session-creation");
  const startingRuntime = {
    phase: "starting" as const,
    detail: messages.runtime.session.starting,
    recoverable: true
  };
  workbench.updateTask(taskId, {
    lifecycle: "initializing",
    creationId,
    creationStatus: "pending",
    runtime: startingRuntime
  });
  const pending = rendererWorkbenchStore.getState().tasks[taskId];
  if (!pending) return { status: "failed", error: messages.runtime.session.createFailed };
  return runRendererSessionCreation(pending, creationId, get, set);
}

async function runRendererSessionCreation(
  task: RendererWorkbenchTask,
  creationId: string,
  get: StoreGet,
  set: StoreSet
): Promise<RendererSessionMaterializationResult> {
  let outcome: RendererSessionMaterializationResult | undefined;
  const committed = await runSessionBootstrapTransition(get, set, {
    detail: messages.runtime.session.creating,
    refreshSessionCatalogFor: task.workspaceId,
    onError: (error) => {
      if (error instanceof ProtocolRequestError && error.code === "REQUEST_OUTCOME_UNKNOWN") {
        markRendererSessionCreationUnconfirmed(task, creationId);
        set({
          runtime: {
            phase: "failed",
            detail: messages.runtime.session.creationOutcomeUnknown,
            recoverable: true
          }
        });
        outcome = { status: "unconfirmed", error: messages.runtime.session.creationOutcomeUnknown };
        return;
      }
      const draft = useTaskDraftStore.getState().drafts[task.id];
      if (task.environmentIntent === "worktree") {
        rendererWorkbenchStore.getState().updateTask(task.id, {
          lifecycle: "draft",
          creationId: undefined,
          creationStatus: undefined,
          environmentCreationState: "recovery-required",
          runtime: { phase: "failed", detail: messages.runtime.session.createFailed, recoverable: true }
        });
      } else if (!draft || (
        draft.text.trim().length === 0
        && draft.attachments.length === 0
        && draft.workspaceFiles.length === 0
      )) {
        useTaskDraftStore.getState().discard(task.id);
        rendererWorkbenchStore.getState().removeRuntimeTask(task.id);
      } else {
        rendererWorkbenchStore.getState().updateTask(task.id, {
          lifecycle: "draft",
          creationId: undefined,
          creationStatus: undefined,
          runtime: { phase: "failed", detail: messages.runtime.session.createFailed, recoverable: true }
        });
      }
      reportSessionError(error, set, messages.runtime.session.createFailed);
      outcome = { status: "failed", error: sessionErrorMessage(error) };
    },
    onMissingBootstrap: () => {
      markRendererSessionCreationUnconfirmed(task, creationId);
      outcome = { status: "unconfirmed", error: messages.runtime.session.creationOutcomeUnknown };
    },
    onStale: () => {
      markRendererSessionCreationUnconfirmed(task, creationId);
      outcome = { status: "unconfirmed", error: messages.runtime.session.creationOutcomeUnknown };
    },
    request: () => agentConnectionController.request("session.create", { creationId }, [], {
      context: workbenchProtocolContextForTask(task),
      onAcknowledgementDelayed: () => {
        const current = rendererWorkbenchStore.getState().tasks[task.id];
        if (
          current?.taskGeneration !== task.taskGeneration
          || current.creationId !== creationId
          || current.creationStatus !== "pending"
        ) return;
        rendererWorkbenchStore.getState().updateTask(task.id, {
          creationStatus: "confirming",
          runtime: {
            phase: "starting",
            detail: messages.runtime.session.confirmingCreation,
            recoverable: true
          }
        });
        set({
          runtime: {
            phase: "starting",
            detail: messages.runtime.session.confirmingCreation,
            recoverable: true
          }
        });
      }
    })
  });
  return committed
    ? { status: "materialized" }
    : outcome ?? { status: "failed", error: messages.runtime.session.createFailed };
}
