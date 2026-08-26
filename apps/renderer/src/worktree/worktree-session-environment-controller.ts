import type {
  WorkbenchStateV5,
  WorkspaceDescriptor
} from "@pi67/domain";
import {
  createMessageId,
  type WorktreeCreationAdvanceRequest,
  type WorktreeCreationAdvanceResult,
  type WorktreeCreationActivityResult,
  type WorktreeCreationCancelResult,
  type WorktreeCreationProgressState,
  type WorktreeCreationRequest,
  type WorktreeCreationResult
} from "@pi67/protocol";
import { useAppStore } from "../app/app-store.js";
import { messages } from "../localization/message-catalog.js";
import {
  persistRendererWorkbenchCheckpoint
} from "../workbench/workbench-controller.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import {
  registerRendererWorkspaceWithHost
} from "../workbench/workspace-host-registration-controller.js";
import {
  markCancelledWorktreeTask,
  trackWorktreeCreationActivity
} from "./worktree-session-environment-activity.js";

export type WorktreeSessionEnvironmentResult =
  | {
      status: "prepared";
      creationId: string;
      task: RendererWorkbenchTask;
    }
  | {
      status: "failed" | "unconfirmed";
      error: string;
    };

export type WorktreeSessionEnvironmentCommitResult =
  | { status: "committed" }
  | { status: "unconfirmed"; error: string };

export interface WorktreeSessionEnvironmentDependencies {
  createId(): string;
  create(request: WorktreeCreationRequest): Promise<WorktreeCreationResult>;
  advance(request: WorktreeCreationAdvanceRequest): Promise<WorktreeCreationAdvanceResult>;
  activity?(this: void, creationId: string): Promise<WorktreeCreationActivityResult>;
  cancel?(this: void, creationId: string): Promise<WorktreeCreationCancelResult>;
  loadWorkbenchState(): Promise<WorkbenchStateV5>;
  persistCheckpoint(): Promise<void>;
  registerWorkspace(workspace: WorkspaceDescriptor): Promise<boolean>;
}

const DEFAULT_DEPENDENCIES: WorktreeSessionEnvironmentDependencies = {
  createId: () => createMessageId("environment-creation"),
  create: (request) => window.pi67.system.createWorktreeEnvironment(request),
  advance: (request) => window.pi67.system.advanceWorktreeEnvironment(request),
  activity: (creationId) => window.pi67.system.getWorktreeCreationActivity({ creationId }),
  cancel: (creationId) => window.pi67.system.cancelWorktreeCreation({ creationId }),
  loadWorkbenchState: () => window.pi67.system.loadWorkbenchState(),
  persistCheckpoint: persistRendererWorkbenchCheckpoint,
  registerWorkspace: (workspace) => registerRendererWorkspaceWithHost(workspace, { queryCatalog: false })
};

export async function prepareWorktreeSessionEnvironment(
  taskId: string,
  dependencies: WorktreeSessionEnvironmentDependencies = DEFAULT_DEPENDENCIES
): Promise<WorktreeSessionEnvironmentResult> {
  const initial = rendererWorkbenchStore.getState().tasks[taskId];
  if (
    !initial
    || initial.conversation.kind !== "provisional"
    || initial.environmentIntent !== "worktree"
    || initial.creationStatus !== undefined
  ) return failed(messages.runtime.worktreeCreation.invalidTask);

  const creationId = initial.environmentCreationId ?? dependencies.createId();
  const sourceWorkspaceId = initial.environmentSourceWorkspaceId ?? initial.workspaceId;
  rendererWorkbenchStore.getState().updateTask(taskId, {
    environmentCreationId: creationId,
    environmentSourceWorkspaceId: sourceWorkspaceId,
    environmentCreationState: initial.environmentCreationState ?? "creating"
  });

  let materialized = progressFromTask(initial);
  if (!materialized) {
    let result: WorktreeCreationResult | undefined;
    const activity = dependencies.activity;
    const stopActivity = activity
      ? trackWorktreeCreationActivity(taskId, creationId, (currentCreationId) => activity(currentCreationId))
      : () => undefined;
    try {
      result = await dependencies.create({
        requestId: initial.id,
        creationId,
        sourceWorkspaceId
      });
    } catch {
      materialized = await recoverMaterializedEnvironment(
        initial.id,
        creationId,
        sourceWorkspaceId,
        dependencies
      );
      if (!materialized) return markRecoveryRequired(taskId);
    } finally {
      stopActivity();
    }
    if (!materialized && result?.status === "created") {
      materialized = {
        state: result.receipt.state,
        workspace: result.receipt.workspace
      };
    }
    if (!materialized && result?.status === "rejected") {
      if (result.error.code === "cancelled") return markCancelledWorktreeTask(taskId);
      if (requiresRecovery(result)) {
        materialized = await recoverMaterializedEnvironment(
          initial.id,
          creationId,
          sourceWorkspaceId,
          dependencies
        );
        if (!materialized) return markRecoveryRequired(taskId);
      } else {
        return markFailed(taskId);
      }
    }
  }
  if (!materialized) return markRecoveryRequired(taskId);
  if (materialized.state === "session-bound" || materialized.state === "committed") {
    return markRecoveryRequired(taskId);
  }

  const adopted = adoptCreatedWorkspace(
    taskId,
    initial.taskGeneration,
    creationId,
    sourceWorkspaceId,
    materialized.workspace,
    materialized.state
  );
  if (!adopted) return markRecoveryRequired(taskId);

  try {
    await dependencies.persistCheckpoint();
  } catch {
    return markRecoveryRequired(taskId);
  }

  const hostRegistering = await advanceCreation(
    creationId,
    "host-registering",
    materialized.workspace.id,
    dependencies
  );
  if (!hostRegistering) return markRecoveryRequired(taskId);
  updateCreationState(taskId, hostRegistering);
  if (hostRegistering === "session-bound" || hostRegistering === "committed") {
    return markRecoveryRequired(taskId);
  }

  try {
    if (!await dependencies.registerWorkspace(materialized.workspace)) {
      return markRecoveryRequired(taskId);
    }
  } catch {
    return markRecoveryRequired(taskId);
  }

  const hostRegistered = await advanceCreation(
    creationId,
    "host-registered",
    materialized.workspace.id,
    dependencies
  );
  if (!hostRegistered) return markRecoveryRequired(taskId);
  updateCreationState(taskId, hostRegistered);
  if (hostRegistered === "session-bound" || hostRegistered === "committed") {
    return markRecoveryRequired(taskId);
  }

  const sessionMaterializing = await advanceCreation(
    creationId,
    "session-materializing",
    materialized.workspace.id,
    dependencies
  );
  if (!sessionMaterializing || sessionMaterializing !== "session-materializing") {
    return markRecoveryRequired(taskId);
  }
  updateCreationState(taskId, sessionMaterializing);

  const task = rendererWorkbenchStore.getState().tasks[taskId];
  if (
    !task
    || task.taskGeneration !== initial.taskGeneration
    || task.workspaceId !== materialized.workspace.id
    || task.conversation.kind !== "provisional"
    || task.creationId !== creationId
    || task.creationStatus === undefined
  ) return markRecoveryRequired(taskId);
  return { status: "prepared", creationId, task };
}

export async function cancelWorktreeSessionEnvironment(
  taskId: string,
  dependencies: WorktreeSessionEnvironmentDependencies = DEFAULT_DEPENDENCIES
): Promise<boolean> {
  const task = rendererWorkbenchStore.getState().tasks[taskId];
  const creationId = task?.environmentCreationId;
  if (!task || task.environmentCreationState !== "creating" || !creationId || !dependencies.cancel) return false;
  rendererWorkbenchStore.getState().updateTask(taskId, {
    runtime: { phase: "starting", detail: messages.runtime.worktreeCreation.cancelling, recoverable: true }
  });
  try {
    const result = await dependencies.cancel(creationId);
    return result.status === "cancel-requested";
  } catch {
    return false;
  }
}

export async function commitWorktreeSessionEnvironment(
  taskId: string,
  creationId: string,
  dependencies: WorktreeSessionEnvironmentDependencies = DEFAULT_DEPENDENCIES
): Promise<WorktreeSessionEnvironmentCommitResult> {
  const task = rendererWorkbenchStore.getState().tasks[taskId];
  if (
    !task
    || task.environmentIntent !== "worktree"
    || task.environmentCreationId !== creationId
    || task.conversation.kind !== "session"
    || !task.sessionFileIdentity
  ) return commitUnconfirmed(taskId);

  const sessionBound = await advanceCreation(
    creationId,
    "session-bound",
    task.workspaceId,
    dependencies,
    task.sessionFileIdentity
  );
  if (sessionBound !== "session-bound" && sessionBound !== "committed") {
    return commitUnconfirmed(taskId);
  }
  updateCreationState(taskId, sessionBound);

  const committed = await advanceCreation(
    creationId,
    "committed",
    task.workspaceId,
    dependencies
  );
  if (committed !== "committed") return commitUnconfirmed(taskId);
  updateCreationState(taskId, committed);
  try {
    await dependencies.persistCheckpoint();
  } catch {
    // Main has already committed the environment and Pi JSONL is authoritative.
  }
  return { status: "committed" };
}

function adoptCreatedWorkspace(
  taskId: string,
  taskGeneration: number,
  creationId: string,
  sourceWorkspaceId: string,
  workspace: WorkspaceDescriptor,
  state: WorktreeCreationProgressState
): boolean {
  const workbench = rendererWorkbenchStore.getState();
  const task = workbench.tasks[taskId];
  if (
    !task
    || task.taskGeneration !== taskGeneration
    || task.conversation.kind !== "provisional"
    || task.environmentCreationId !== creationId
    || task.environmentSourceWorkspaceId !== sourceWorkspaceId
  ) return false;
  if (
    task.workspaceId !== workspace.id
    && !workbench.transferProvisionalTaskToWorkspace(taskId, workspace)
  ) return false;
  const current = rendererWorkbenchStore.getState().tasks[taskId];
  if (!current || current.workspaceId !== workspace.id || current.conversation.kind !== "provisional") {
    return false;
  }
  const runtime = {
    phase: "starting" as const,
    detail: messages.runtime.worktreeCreation.registeringWorkspace,
    recoverable: true
  };
  rendererWorkbenchStore.getState().updateTask(taskId, {
    lifecycle: "initializing",
    runtime,
    creationId,
    creationStatus: "pending",
    environmentCreationState: state
  });
  if (selectedWorkbenchTask(rendererWorkbenchStore.getState())?.id === taskId) {
    useAppStore.setState({
      workspace: workspace.identity.canonicalPath,
      trust: workspace.trust,
      trustUpdating: false,
      runtime
    });
  }
  return true;
}

async function recoverMaterializedEnvironment(
  requestId: string,
  creationId: string,
  sourceWorkspaceId: string,
  dependencies: WorktreeSessionEnvironmentDependencies
): Promise<MaterializedEnvironment | undefined> {
  let state: WorkbenchStateV5;
  try {
    state = await dependencies.loadWorkbenchState();
  } catch {
    return undefined;
  }
  const record = state.environmentMutations.find((candidate) => (
    candidate.requestId === requestId
    && candidate.creationId === creationId
    && candidate.sourceWorkspaceId === sourceWorkspaceId
  ));
  if (!record || !isProgressState(record.state) || !record.workspaceId) return undefined;
  const workspace = state.workspaces.find((candidate) => candidate.id === record.workspaceId);
  return workspace ? { state: record.state, workspace } : undefined;
}

async function advanceCreation(
  creationId: string,
  targetState: WorktreeCreationProgressState,
  workspaceId: string,
  dependencies: WorktreeSessionEnvironmentDependencies,
  sessionFileIdentity?: string
): Promise<WorktreeCreationProgressState | undefined> {
  let request: WorktreeCreationAdvanceRequest;
  if (targetState === "session-bound") {
    if (!sessionFileIdentity) return undefined;
    request = { creationId, targetState, sessionFileIdentity };
  } else {
    request = { creationId, targetState };
  }
  let result: WorktreeCreationAdvanceResult;
  try {
    result = await dependencies.advance(request);
  } catch {
    return undefined;
  }
  if (
    result.status !== "advanced"
    || result.receipt.creationId !== creationId
    || result.receipt.workspaceId !== workspaceId
  ) return undefined;
  if (
    targetState === "session-bound"
    && result.receipt.sessionFileIdentity !== sessionFileIdentity
  ) return undefined;
  return result.receipt.state;
}

function progressFromTask(task: RendererWorkbenchTask): MaterializedEnvironment | undefined {
  if (!isProgressState(task.environmentCreationState)) return undefined;
  const workspace = rendererWorkbenchStore.getState().workspaces[task.workspaceId];
  return workspace ? { state: task.environmentCreationState, workspace } : undefined;
}

function updateCreationState(taskId: string, state: WorktreeCreationProgressState): void {
  rendererWorkbenchStore.getState().updateTask(taskId, {
    environmentCreationState: state,
    runtime: {
      phase: "starting",
      detail: state === "session-materializing"
        ? messages.runtime.worktreeCreation.creatingSession
        : messages.runtime.worktreeCreation.registeringWorkspace,
      recoverable: true
    }
  });
}

function markFailed(taskId: string): WorktreeSessionEnvironmentResult {
  const error = messages.runtime.worktreeCreation.failed;
  markTaskFailure(taskId, "failed", error);
  return failed(error);
}

function markRecoveryRequired(taskId: string): WorktreeSessionEnvironmentResult {
  const error = messages.runtime.worktreeCreation.recoveryRequired;
  markTaskFailure(taskId, "recovery-required", error);
  return { status: "unconfirmed", error };
}

function commitUnconfirmed(taskId: string): WorktreeSessionEnvironmentCommitResult {
  const error = messages.runtime.worktreeCreation.recoveryRequired;
  markTaskFailure(taskId, "recovery-required", error);
  return { status: "unconfirmed", error };
}

function markTaskFailure(
  taskId: string,
  state: "failed" | "recovery-required",
  detail: string
): void {
  const runtime = { phase: "failed" as const, detail, recoverable: true };
  rendererWorkbenchStore.getState().updateTask(taskId, {
    lifecycle: "draft",
    environmentCreationState: state,
    runtime
  });
  if (selectedWorkbenchTask(rendererWorkbenchStore.getState())?.id === taskId) {
    useAppStore.setState({
      sessionTransitionPending: false,
      sessionBootstrapTransitionPending: false,
      runtime
    });
  }
}

function requiresRecovery(result: Extract<WorktreeCreationResult, { status: "rejected" }>): boolean {
  return [
    "state-unavailable",
    "repository-indeterminate",
    "rollback-protected",
    "recovery-required",
    "internal"
  ].includes(result.error.code);
}

function isProgressState(value: unknown): value is WorktreeCreationProgressState {
  return typeof value === "string" && [
    "workspace-registered",
    "host-registering",
    "host-registered",
    "session-materializing",
    "session-bound",
    "committed"
  ].includes(value);
}

function failed(error: string): WorktreeSessionEnvironmentResult {
  return { status: "failed", error };
}

interface MaterializedEnvironment {
  state: WorktreeCreationProgressState;
  workspace: WorkspaceDescriptor;
}
