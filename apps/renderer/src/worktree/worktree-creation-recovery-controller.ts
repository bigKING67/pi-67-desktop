import type {
  EnvironmentMutationRecoveryRecord,
  WorkbenchStateV5,
  WorkspaceDescriptor
} from "@pi67/domain";
import type {
  WorktreeCreationAdvanceResult,
  WorktreeCreationProgressState
} from "@pi67/protocol";
import { messages } from "../localization/message-catalog.js";
import {
  reconcileUnconfirmedRendererSessions
} from "../session/session-creation-recovery-controller.js";
import {
  rendererWorkbenchStore,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import {
  registerRendererWorkspaceWithHost
} from "../workbench/workspace-host-registration-controller.js";
import {
  commitWorktreeSessionEnvironment
} from "./worktree-session-environment-controller.js";

export interface RendererWorktreeRecoveryDependencies {
  loadWorkbenchState(): Promise<WorkbenchStateV5>;
  advance(
    creationId: string,
    targetState: "host-registering" | "host-registered"
  ): Promise<WorktreeCreationAdvanceResult>;
  registerWorkspace(workspace: WorkspaceDescriptor): Promise<boolean>;
  reconcileSessions(): Promise<void>;
  commitSession(taskId: string, creationId: string): Promise<{ status: "committed" } | { status: "unconfirmed" }>;
}

const DEFAULT_DEPENDENCIES: RendererWorktreeRecoveryDependencies = {
  loadWorkbenchState: () => window.pi67.system.loadWorkbenchState(),
  advance: (creationId, targetState) => window.pi67.system.advanceWorktreeEnvironment({
    creationId,
    targetState
  }),
  registerWorkspace: (workspace) => registerRendererWorkspaceWithHost(workspace, { queryCatalog: false }),
  reconcileSessions: reconcileUnconfirmedRendererSessions,
  commitSession: async (taskId, creationId) => commitWorktreeSessionEnvironment(taskId, creationId)
};

export async function reconcileRendererWorktreeCreations(
  dependencies: RendererWorktreeRecoveryDependencies = DEFAULT_DEPENDENCIES
): Promise<void> {
  let state: WorkbenchStateV5;
  try {
    state = await dependencies.loadWorkbenchState();
  } catch {
    await dependencies.reconcileSessions();
    return;
  }

  const records = state.environmentMutations.filter(isProgressRecord);
  for (const record of records) {
    const workspace = record.workspaceId
      ? state.workspaces.find((candidate) => candidate.id === record.workspaceId)
      : undefined;
    if (!workspace) continue;
    await replayHostRegistration(record, workspace, dependencies);
  }

  await dependencies.reconcileSessions();

  for (const record of records) {
    const task = worktreeTaskForRecord(record);
    if (!task || task.conversation.kind !== "session") continue;
    if (
      record.sessionFileIdentity !== undefined
      && task.sessionFileIdentity !== record.sessionFileIdentity
    ) {
      markRecoveryRequired(task.id);
      continue;
    }
    const result = await dependencies.commitSession(task.id, record.creationId);
    if (result.status !== "committed") markRecoveryRequired(task.id);
  }
}

async function replayHostRegistration(
  record: EnvironmentMutationRecoveryRecord,
  workspace: WorkspaceDescriptor,
  dependencies: RendererWorktreeRecoveryDependencies
): Promise<void> {
  const hostRegistering = await advance(record, workspace.id, "host-registering", dependencies);
  if (!hostRegistering) {
    markRecoveryRequired(record.requestId);
    return;
  }
  updateTaskProgress(record, hostRegistering);
  try {
    if (!await dependencies.registerWorkspace(workspace)) {
      markRecoveryRequired(record.requestId);
      return;
    }
  } catch {
    markRecoveryRequired(record.requestId);
    return;
  }
  const hostRegistered = await advance(record, workspace.id, "host-registered", dependencies);
  if (!hostRegistered) {
    markRecoveryRequired(record.requestId);
    return;
  }
  updateTaskProgress(record, hostRegistered);
}

async function advance(
  record: EnvironmentMutationRecoveryRecord,
  workspaceId: string,
  targetState: "host-registering" | "host-registered",
  dependencies: RendererWorktreeRecoveryDependencies
): Promise<WorktreeCreationProgressState | undefined> {
  let result: WorktreeCreationAdvanceResult;
  try {
    result = await dependencies.advance(record.creationId, targetState);
  } catch {
    return undefined;
  }
  if (
    result.status !== "advanced"
    || result.receipt.creationId !== record.creationId
    || result.receipt.workspaceId !== workspaceId
  ) return undefined;
  return result.receipt.state;
}

function updateTaskProgress(
  record: EnvironmentMutationRecoveryRecord,
  state: WorktreeCreationProgressState
): void {
  const task = worktreeTaskForRecord(record);
  if (!task) return;
  rendererWorkbenchStore.getState().updateTask(task.id, {
    environmentCreationState: state,
    runtime: state === "session-materializing" || state === "session-bound" || state === "committed"
      ? task.runtime
      : {
          phase: "stopped",
          detail: "隔离工作区已在新的 Pi Host 中恢复。发送草稿时将继续创建会话。",
          recoverable: true
        }
  });
}

function markRecoveryRequired(taskId: string): void {
  rendererWorkbenchStore.getState().updateTask(taskId, {
    environmentCreationState: "recovery-required",
    runtime: {
      phase: "failed",
      detail: messages.runtime.worktreeCreation.recoveryRequired,
      recoverable: true
    }
  });
}

function worktreeTaskForRecord(
  record: EnvironmentMutationRecoveryRecord
): RendererWorkbenchTask | undefined {
  const workbench = rendererWorkbenchStore.getState();
  return workbench.tasks[record.requestId] ?? Object.values(workbench.tasks).find((task) => (
    task.environmentCreationId === record.creationId
  ));
}

function isProgressRecord(
  record: EnvironmentMutationRecoveryRecord
): boolean {
  return [
    "workspace-registered",
    "host-registering",
    "host-registered",
    "session-materializing",
    "session-bound",
    "committed"
  ].includes(record.state);
}
