import type {
  EnvironmentMutationRecoveryRecord,
  WorktreeCreationResult
} from "@pi67/protocol";
import { advanceEnvironmentMutation } from "./workbench-state-mutations.js";
import type { RepositoryMutationScheduler } from "./repository-mutation-scheduler.js";
import {
  GitInspectionError,
  type RepositoryMutationGitRunner
} from "./worktree-git-runner.js";
import {
  isTerminalCreationState,
  monotonicNow,
  pathsEqual,
  rejected,
  type WorkbenchStateAuthority
} from "./worktree-creation-service-support.js";

export interface WorktreeCreationFailureRollbackOptions {
  runner: RepositoryMutationGitRunner;
  scheduler: RepositoryMutationScheduler;
  workbenchState: WorkbenchStateAuthority;
  now: () => number;
  platform: NodeJS.Platform;
}

export async function rollbackFailedWorktreeCreation(
  options: WorktreeCreationFailureRollbackOptions,
  sourcePath: string,
  targetPath: string,
  record: EnvironmentMutationRecoveryRecord,
  originalError: unknown
): Promise<WorktreeCreationResult> {
  if (originalError instanceof GitInspectionError && originalError.details.cleanupConfirmed === false) {
    await markIndeterminate(options, record);
    return rejected("git", "repository-indeterminate", true);
  }
  try {
    const [worktrees, branchHead] = await Promise.all([
      options.runner.listWorktrees(sourcePath),
      options.runner.resolveBranchHead(sourcePath, record.branchName)
    ]);
    const worktree = worktrees.find((candidate) => pathsEqual(candidate.path, targetPath, options.platform));
    if (worktree) {
      const clean = await options.runner.statusPorcelain(targetPath);
      if (
        worktree.branchName !== record.branchName
        || worktree.headSha !== record.headSha
        || branchHead !== record.headSha
        || clean.length !== 0
      ) return markRollbackProtected(options, record);
    } else if (branchHead !== undefined && branchHead !== record.headSha) {
      return markRollbackProtected(options, record);
    }

    await options.workbenchState.update((state) => (
      advanceEnvironmentMutation(state, record.creationId, "rollback-pending", options.now())
    ));
    if (worktree) await options.runner.removeWorktree(sourcePath, targetPath);
    if (branchHead === record.headSha) await options.runner.deleteBranch(sourcePath, record.branchName);
    await options.workbenchState.update((state) => (
      advanceEnvironmentMutation(state, record.creationId, "rolled-back", options.now())
    ));
    return originalError instanceof GitInspectionError && originalError.code === "cancelled"
      ? rejected("git", "cancelled", true)
      : rejected("git", "git-failed", true);
  } catch {
    await markIndeterminate(options, record);
    return rejected("git", "repository-indeterminate", true);
  }
}

async function markRollbackProtected(
  options: WorktreeCreationFailureRollbackOptions,
  record: EnvironmentMutationRecoveryRecord
): Promise<WorktreeCreationResult> {
  try {
    await options.workbenchState.update((state) => (
      advanceEnvironmentMutation(state, record.creationId, "rollback-pending", options.now())
    ));
    await options.workbenchState.update((state) => (
      advanceEnvironmentMutation(state, record.creationId, "rollback-protected", options.now())
    ));
  } catch {
    await markIndeterminate(options, record);
    return rejected("git", "repository-indeterminate", true);
  }
  options.scheduler.fence(record.repositoryGroupId);
  return rejected("rollback", "rollback-protected", false);
}

async function markIndeterminate(
  options: WorktreeCreationFailureRollbackOptions,
  record: EnvironmentMutationRecoveryRecord
): Promise<void> {
  options.scheduler.fence(record.repositoryGroupId);
  await options.workbenchState.update((state) => {
    const current = state.environmentMutations.find((candidate) => candidate.creationId === record.creationId);
    if (!current || current.state === "indeterminate" || isTerminalCreationState(current.state)) return state;
    return advanceEnvironmentMutation(
      state,
      record.creationId,
      "indeterminate",
      monotonicNow(options.now(), current.updatedAt)
    );
  }).catch(() => undefined);
}
