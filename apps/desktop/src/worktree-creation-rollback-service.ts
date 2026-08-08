import type {
  EnvironmentMutationRecoveryRecord,
  WorktreeCreationRollbackRequest,
  WorktreeCreationRollbackResult
} from "@pi67/protocol";
import {
  advanceEnvironmentMutation,
  finalizeRolledBackWorktreeWorkspace
} from "./workbench-state-mutations.js";
import type { RepositoryMutationGitRunner } from "./worktree-git-runner.js";
import {
  RepositoryMutationAdmissionError,
  RepositoryMutationScheduler
} from "./repository-mutation-scheduler.js";
import {
  repositoryGroupId,
  workspaceMatchesPhysicalDirectory,
  type PhysicalDirectoryIdentity
} from "./repository-identity.js";
import type { RecoveredWorktreeProfilePath } from "./worktree-profile-root.js";
import {
  isTerminalCreationState,
  matchingRollbackRecord,
  monotonicNow,
  pathsEqual,
  rejected,
  rolledBack,
  type RollbackArtifactObservation,
  type WorkbenchStateAuthority
} from "./worktree-creation-service-support.js";

export interface WorktreeCreationRollbackServiceOptions {
  userData: string;
  runner: RepositoryMutationGitRunner;
  scheduler: RepositoryMutationScheduler;
  workbenchState: WorkbenchStateAuthority;
  now: () => number;
  platform: NodeJS.Platform;
  recoverProfilePath(
    userData: string,
    repositoryGroupId: string,
    worktreeToken: string
  ): Promise<RecoveredWorktreeProfilePath>;
  observeIdentity(path: string): Promise<PhysicalDirectoryIdentity>;
}

export class WorktreeCreationRollbackService {
  constructor(private readonly options: WorktreeCreationRollbackServiceOptions) {}

  async rollback(request: WorktreeCreationRollbackRequest): Promise<WorktreeCreationRollbackResult> {
    let initial;
    try {
      initial = (await this.options.workbenchState.load()).state;
    } catch {
      return rejected("state", "state-unavailable", true);
    }
    const record = matchingRollbackRecord(initial, request);
    if (!record) return rejected("request", "invalid-request", false);
    if (record.state === "rolled-back") return rolledBack(record);
    if (record.state === "rollback-protected") {
      return rejected("rollback", "rollback-protected", false);
    }
    if (record.state === "indeterminate") {
      return rejected("git", "repository-indeterminate", true);
    }
    try {
      return await this.options.scheduler.run(record.repositoryGroupId, () => this.#rollback(request));
    } catch (error) {
      if (error instanceof RepositoryMutationAdmissionError) {
        return error.code === "queue-full"
          ? rejected("rollback", "queue-full", true)
          : rejected("git", "repository-indeterminate", true);
      }
      return rejected("state", "internal", true);
    }
  }

  async #rollback(request: WorktreeCreationRollbackRequest): Promise<WorktreeCreationRollbackResult> {
    const current = (await this.options.workbenchState.load()).state;
    const record = matchingRollbackRecord(current, request);
    if (!record) return rejected("request", "invalid-request", false);
    if (record.state === "rolled-back") return rolledBack(record);
    if (record.state === "rollback-protected") {
      return rejected("rollback", "rollback-protected", false);
    }
    if (record.state === "indeterminate") {
      return rejected("git", "repository-indeterminate", true);
    }
    if (
      (record.state !== "workspace-registered" && record.state !== "rollback-pending")
      || !record.workspaceId
      || (record.state === "rollback-pending" && record.rollbackSafety !== "pre-host-confirmed")
    ) return rejected("state", "recovery-required", true);

    const source = current.workspaces.find((candidate) => candidate.id === record.sourceWorkspaceId);
    const workspace = current.workspaces.find((candidate) => candidate.id === record.workspaceId);
    const sourceBinding = current.workspaceEnvironments.find((candidate) => (
      candidate.workspaceId === record.sourceWorkspaceId
    ));
    const binding = current.workspaceEnvironments.find((candidate) => candidate.workspaceId === record.workspaceId);
    if (
      !source
      || source.availability !== "available"
      || !workspace
      || workspace.availability !== "available"
      || !sourceBinding
      || sourceBinding.repositoryGroupId !== record.repositoryGroupId
      || binding?.kind !== "repository-worktree"
      || binding.ownership !== "app"
      || binding.repositoryGroupId !== record.repositoryGroupId
      || binding.creationId !== record.creationId
    ) return this.#markRollbackIndeterminate(record);
    if (
      current.runtimeRecovery.some((candidate) => candidate.conversation.workspaceId === record.workspaceId)
      || current.sessionCreationRecovery.some((candidate) => candidate.workspaceId === record.workspaceId)
    ) return rejected("state", "recovery-required", true);

    let observation: RollbackArtifactObservation;
    try {
      observation = await this.#observeRollbackArtifact(record, source.identity.canonicalPath);
    } catch {
      return this.#markRollbackIndeterminate(record);
    }
    if (observation.kind === "present-mismatch") return this.#protectExplicitRollback(record);
    if (
      observation.kind === "exact-clean"
      && !workspaceMatchesPhysicalDirectory(workspace, observation.targetIdentity, this.options.platform)
    ) return this.#protectExplicitRollback(record);

    try {
      if (record.state === "workspace-registered") {
        await this.options.workbenchState.update((state) => (
          advanceEnvironmentMutation(
            state,
            record.creationId,
            "rollback-pending",
            monotonicNow(this.options.now(), record.updatedAt),
            { rollbackSafety: "pre-host-confirmed" }
          )
        ));
      }
      if (observation.kind === "exact-clean") {
        await this.options.runner.removeWorktree(source.identity.canonicalPath, observation.targetPath);
      }
      if (observation.kind === "exact-clean" || observation.kind === "exact-branch-only") {
        await this.options.runner.deleteBranch(source.identity.canonicalPath, record.branchName);
      }
      const after = await this.#observeRollbackArtifact(record, source.identity.canonicalPath);
      if (after.kind !== "absent") return this.#protectExplicitRollback(record);
      await this.options.workbenchState.update((state) => {
        const pending = state.environmentMutations.find((candidate) => candidate.creationId === record.creationId);
        if (!pending || pending.state !== "rollback-pending" || !pending.workspaceId) {
          throw new Error("Worktree rollback receipt is unavailable.");
        }
        return finalizeRolledBackWorktreeWorkspace(
          state,
          record.creationId,
          pending.workspaceId,
          monotonicNow(this.options.now(), pending.updatedAt)
        );
      });
      return rolledBack(record);
    } catch {
      return this.#markRollbackIndeterminate(record);
    }
  }

  async #observeRollbackArtifact(
    record: EnvironmentMutationRecoveryRecord,
    sourcePath: string
  ): Promise<RollbackArtifactObservation> {
    const [profile, worktrees, branchHead] = await Promise.all([
      this.options.recoverProfilePath(
        this.options.userData,
        record.repositoryGroupId,
        record.worktreeToken
      ),
      this.options.runner.listWorktrees(sourcePath),
      this.options.runner.resolveBranchHead(sourcePath, record.branchName)
    ]);
    const worktree = worktrees.find((candidate) => (
      pathsEqual(candidate.path, profile.targetPath, this.options.platform)
    ));
    if (!worktree && !profile.exists && branchHead === undefined) return { kind: "absent" };
    if (!worktree && !profile.exists && branchHead === record.headSha) {
      return { kind: "exact-branch-only" };
    }
    if (
      !worktree
      || !profile.exists
      || branchHead !== record.headSha
      || worktree.branchName !== record.branchName
      || worktree.headSha !== record.headSha
      || worktree.detached
      || worktree.locked
      || worktree.prunable
    ) return { kind: "present-mismatch" };

    const [headSha, commonDirectory, status, targetIdentity] = await Promise.all([
      this.options.runner.resolveHeadSha(profile.targetPath),
      this.options.runner.resolveCommonDirectory(profile.targetPath),
      this.options.runner.statusPorcelain(profile.targetPath),
      this.options.observeIdentity(profile.targetPath)
    ]);
    const commonIdentity = await this.options.observeIdentity(commonDirectory);
    if (
      headSha !== record.headSha
      || status.length !== 0
      || repositoryGroupId(commonIdentity) !== record.repositoryGroupId
    ) return { kind: "present-mismatch" };
    return {
      kind: "exact-clean",
      targetPath: targetIdentity.canonicalPath,
      targetIdentity
    };
  }

  async #protectExplicitRollback(
    record: EnvironmentMutationRecoveryRecord
  ): Promise<WorktreeCreationRollbackResult> {
    try {
      const current = (await this.options.workbenchState.load()).state.environmentMutations.find((candidate) => (
        candidate.creationId === record.creationId
      ));
      if (!current) return rejected("state", "recovery-required", true);
      if (current.state === "rolled-back") return rolledBack(current);
      if (current.state === "workspace-registered") {
        await this.options.workbenchState.update((state) => (
          advanceEnvironmentMutation(
            state,
            record.creationId,
            "rollback-pending",
            monotonicNow(this.options.now(), current.updatedAt),
            { rollbackSafety: "pre-host-confirmed" }
          )
        ));
      }
      const pending = (await this.options.workbenchState.load()).state.environmentMutations.find((candidate) => (
        candidate.creationId === record.creationId
      ));
      if (pending?.state === "rollback-pending") {
        await this.options.workbenchState.update((state) => (
          advanceEnvironmentMutation(
            state,
            record.creationId,
            "rollback-protected",
            monotonicNow(this.options.now(), pending.updatedAt)
          )
        ));
      }
    } catch {
      return this.#markRollbackIndeterminate(record);
    }
    this.options.scheduler.fence(record.repositoryGroupId);
    return rejected("rollback", "rollback-protected", false);
  }

  async #markRollbackIndeterminate(
    record: EnvironmentMutationRecoveryRecord
  ): Promise<WorktreeCreationRollbackResult> {
    await this.#markIndeterminate(record);
    return rejected("git", "repository-indeterminate", true);
  }

  async #markIndeterminate(record: EnvironmentMutationRecoveryRecord): Promise<void> {
    this.options.scheduler.fence(record.repositoryGroupId);
    await this.options.workbenchState.update((state) => {
      const current = state.environmentMutations.find((candidate) => candidate.creationId === record.creationId);
      if (!current || current.state === "indeterminate" || isTerminalCreationState(current.state)) return state;
      return advanceEnvironmentMutation(
        state,
        record.creationId,
        "indeterminate",
        monotonicNow(this.options.now(), current.updatedAt)
      );
    }).catch(() => undefined);
  }
}
