import type {
  EnvironmentMutationRecoveryRecord,
  WorkbenchStateV5,
  WorkspaceDescriptor
} from "@pi67/domain";
import type { WorktreeCreationProgressState } from "@pi67/protocol";
import { messages } from "../localization/message-catalog.js";
import {
  rendererWorkbenchStore,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";

export function installRendererWorktreeRecoveryTasks(state: WorkbenchStateV5): void {
  for (const record of state.environmentMutations) {
    if (!isRecoverableProgress(record) || !record.workspaceId) continue;
    const workspace = state.workspaces.find((candidate) => candidate.id === record.workspaceId);
    if (!workspace) continue;
    installRecoveryTask(state, record, workspace);
  }
}

function installRecoveryTask(
  state: WorkbenchStateV5,
  record: RecoverableEnvironmentRecord,
  workspace: WorkspaceDescriptor
): void {
  const workbench = rendererWorkbenchStore.getState();
  const existing = workbench.tasks[record.requestId] ?? Object.values(workbench.tasks).find((task) => (
    task.environmentCreationId === record.creationId
    || task.creationId === record.creationId
  ));
  const requiresSessionResolution = [
    "session-materializing",
    "session-bound",
    "committed"
  ].includes(record.state);

  if (existing) {
    if (
      existing.conversation.kind === "provisional"
      && existing.workspaceId !== workspace.id
      && !workbench.transferProvisionalTaskToWorkspace(existing.id, workspace)
    ) return;
    workbench.updateTask(existing.id, {
      environmentIntent: "worktree",
      environmentCreationId: record.creationId,
      environmentSourceWorkspaceId: record.sourceWorkspaceId,
      environmentCreationState: record.state,
      ...(existing.conversation.kind === "provisional"
        ? requiresSessionResolution
          ? {
              creationId: record.creationId,
              creationStatus: "unconfirmed" as const,
              lifecycle: "draft" as const,
              runtime: recoveryRuntime()
            }
          : {
              creationId: undefined,
              creationStatus: undefined,
              lifecycle: "draft" as const,
              runtime: resumableRuntime()
            }
        : {})
    });
    restorePersistedSelection(state, existing.id, record);
    return;
  }

  const sessionRecovery = state.sessionCreationRecovery.find((candidate) => (
    candidate.taskId === record.requestId
    && candidate.creationId === record.creationId
    && candidate.workspaceId === workspace.id
  ));
  const task: RendererWorkbenchTask = {
    id: record.requestId,
    conversation: {
      kind: "provisional",
      workspaceId: workspace.id,
      draftId: record.requestId
    },
    workspaceId: workspace.id,
    sessionId: `pending:${record.requestId}`,
    taskGeneration: sessionRecovery?.taskGeneration ?? 1,
    lifecycle: "draft",
    runtime: requiresSessionResolution ? recoveryRuntime() : resumableRuntime(),
    title: messages.runtime.workbench.unnamedSession,
    titleSource: "fallback",
    hasDraft: false,
    attachmentCount: 0,
    toolMode: "auto",
    environmentIntent: "worktree",
    environmentCreationId: record.creationId,
    environmentSourceWorkspaceId: record.sourceWorkspaceId,
    environmentCreationState: record.state,
    ...(requiresSessionResolution
      ? { creationId: record.creationId, creationStatus: "unconfirmed" as const }
      : {})
  };
  if (!workbench.restoreTask(task)) return;
  restorePersistedSelection(state, task.id, record);
}

function restorePersistedSelection(
  state: WorkbenchStateV5,
  taskId: string,
  record: EnvironmentMutationRecoveryRecord
): void {
  const surface = state.selectedSurface;
  if (
    surface?.kind === "conversation"
    && surface.conversation.kind === "provisional"
    && surface.conversation.workspaceId === record.workspaceId
    && surface.conversation.draftId === record.requestId
  ) rendererWorkbenchStore.getState().selectTask(taskId);
}

function recoveryRuntime() {
  return {
    phase: "failed" as const,
    detail: messages.runtime.worktreeCreation.recoveryRequired,
    recoverable: true
  };
}

function resumableRuntime() {
  return {
    phase: "stopped" as const,
    detail: "隔离工作区已保留，发送草稿时将继续创建 Pi 会话。",
    recoverable: true
  };
}

function isRecoverableProgress(
  record: EnvironmentMutationRecoveryRecord
): record is RecoverableEnvironmentRecord {
  return record.workspaceId !== undefined && [
    "workspace-registered",
    "host-registering",
    "host-registered",
    "session-materializing",
    "session-bound",
    "committed"
  ].includes(record.state);
}

type RecoverableEnvironmentRecord = EnvironmentMutationRecoveryRecord & {
  state: WorktreeCreationProgressState;
  workspaceId: string;
};
