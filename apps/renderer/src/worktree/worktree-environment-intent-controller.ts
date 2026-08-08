import { currentWorktreeObservation, type WorkspaceDescriptor } from "@pi67/domain";
import {
  rendererWorkbenchStore,
  type RendererTaskEnvironmentIntent,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import { persistTaskDraftStateCheckpoint } from "../workbench/task-draft-persistence.js";
import {
  repositoryEnvironmentRecord,
  type RepositoryEnvironmentRecord
} from "./repository-environment-store.js";

type WorktreeIntentAvailabilityCode =
  | "ready"
  | "creation-started"
  | "workspace-unavailable"
  | "workspace-untrusted"
  | "inspecting"
  | "inspection-failed"
  | "non-git"
  | "toolchain-unavailable"
  | "repository-stale"
  | "binding-unavailable"
  | "worktree-unavailable"
  | "repository-unavailable";

export interface WorktreeIntentAvailability {
  code: WorktreeIntentAvailabilityCode;
  status: "available" | "checking" | "unavailable" | "locked";
  retryable: boolean;
}

interface EnvironmentIntentDependencies {
  persistDraftCheckpoint(): Promise<void>;
}

const DEFAULT_DEPENDENCIES: EnvironmentIntentDependencies = {
  persistDraftCheckpoint: persistTaskDraftStateCheckpoint
};

export function worktreeIntentAvailability(
  task: RendererWorkbenchTask,
  workspace: WorkspaceDescriptor,
  record: RepositoryEnvironmentRecord | undefined
): WorktreeIntentAvailability {
  if (
    task.conversation.kind !== "provisional"
    || task.creationStatus !== undefined
    || task.environmentCreationId !== undefined
    || task.environmentCreationState !== undefined
  ) return availability("creation-started", "locked", false);
  if (workspace.availability !== "available") {
    return availability("workspace-unavailable", "unavailable", false);
  }
  if (workspace.trust !== "trusted") {
    return availability("workspace-untrusted", "unavailable", false);
  }
  if (!record || record.status === "idle" || record.status === "loading") {
    return availability("inspecting", "checking", false);
  }
  if (record.status === "error" || !record.snapshot) {
    return availability("inspection-failed", "unavailable", true);
  }
  const snapshot = record.snapshot;
  if (snapshot.stale) return availability("repository-stale", "unavailable", true);
  if (snapshot.error?.stage === "state") {
    return availability("binding-unavailable", "unavailable", true);
  }
  if (snapshot.status === "non-git") return availability("non-git", "unavailable", true);
  if (snapshot.status === "toolchain-unavailable") {
    return availability("toolchain-unavailable", "unavailable", true);
  }
  if (snapshot.status === "missing") return availability("workspace-unavailable", "unavailable", true);
  if (snapshot.status !== "ready" || !snapshot.repository) {
    return availability("repository-unavailable", "unavailable", true);
  }
  const current = currentWorktreeObservation(snapshot);
  if (!current || current.status !== "ready" || !current.headSha) {
    return availability("worktree-unavailable", "unavailable", true);
  }
  return availability("ready", "available", false);
}

export async function selectRendererTaskEnvironmentIntent(
  taskId: string,
  intent: RendererTaskEnvironmentIntent,
  dependencies: EnvironmentIntentDependencies = DEFAULT_DEPENDENCIES
): Promise<boolean> {
  const workbench = rendererWorkbenchStore.getState();
  const task = workbench.tasks[taskId];
  const workspace = task ? workbench.workspaces[task.workspaceId] : undefined;
  if (!task || !workspace) return false;
  const state = worktreeIntentAvailability(task, workspace, repositoryEnvironmentRecord(workspace.id));
  if (state.status === "locked" || (intent === "worktree" && state.status !== "available")) return false;
  if (!workbench.updateTask(taskId, { environmentIntent: intent })) return false;
  await dependencies.persistDraftCheckpoint();
  return true;
}

function availability(
  code: WorktreeIntentAvailabilityCode,
  status: WorktreeIntentAvailability["status"],
  retryable: boolean
): WorktreeIntentAvailability {
  return { code, status, retryable };
}
