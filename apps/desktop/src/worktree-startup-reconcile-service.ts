import { randomUUID } from "node:crypto";
import type {
  EnvironmentCreationState,
  EnvironmentMutationRecoveryRecord
} from "@pi67/protocol";
import type { WorkspaceDescriptor } from "./workspace-identity.js";
import {
  createAppOwnedWorkspaceDescriptor
} from "./workspace-identity.js";
import type { WorkbenchStateV5 } from "./workbench-state.js";
import {
  advanceEnvironmentMutation,
  finalizeRolledBackWorktreeWorkspace,
  registerCreatedWorktreeWorkspace
} from "./workbench-state-mutations.js";
import {
  observePhysicalDirectoryIdentity,
  repositoryGroupId,
  workspaceMatchesPhysicalDirectory,
  type PhysicalDirectoryIdentity
} from "./repository-identity.js";
import {
  RepositoryMutationAdmissionError,
  RepositoryMutationScheduler
} from "./repository-mutation-scheduler.js";
import type {
  GitWorktreeRecord,
  RepositoryMutationGitRunner
} from "./worktree-git-runner.js";
import {
  recoverWorktreeProfilePath,
  type RecoveredWorktreeProfilePath
} from "./worktree-profile-root.js";

interface WorkbenchStateAuthority {
  load(): Promise<{ state: WorkbenchStateV5 }>;
  update(mutator: (current: WorkbenchStateV5) => WorkbenchStateV5): Promise<WorkbenchStateV5>;
}

export interface WorktreeStartupReconcileServiceOptions {
  userData: string;
  runner: RepositoryMutationGitRunner;
  scheduler: RepositoryMutationScheduler;
  workbenchState: WorkbenchStateAuthority;
  now?: () => number;
  platform?: NodeJS.Platform;
  recoverProfilePath?: (
    userData: string,
    repositoryGroupId: string,
    worktreeToken: string
  ) => Promise<RecoveredWorktreeProfilePath>;
  observeIdentity?: (path: string) => Promise<PhysicalDirectoryIdentity>;
  createWorkspace?: (path: string) => Promise<WorkspaceDescriptor>;
  createWorkspaceId?: () => string;
}

export interface WorktreeStartupReconcileResult {
  inspected: number;
  resumed: number;
  failed: number;
  committed: number;
  rolledBack: number;
  protected: number;
  indeterminate: number;
  skipped: number;
}

export class WorktreeStartupReconcileService {
  readonly #userData: string;
  readonly #runner: RepositoryMutationGitRunner;
  readonly #scheduler: RepositoryMutationScheduler;
  readonly #workbenchState: WorkbenchStateAuthority;
  readonly #now: () => number;
  readonly #platform: NodeJS.Platform;
  readonly #recoverProfilePath: NonNullable<WorktreeStartupReconcileServiceOptions["recoverProfilePath"]>;
  readonly #observeIdentity: NonNullable<WorktreeStartupReconcileServiceOptions["observeIdentity"]>;
  readonly #createWorkspace: NonNullable<WorktreeStartupReconcileServiceOptions["createWorkspace"]>;

  constructor(options: WorktreeStartupReconcileServiceOptions) {
    this.#userData = options.userData;
    this.#runner = options.runner;
    this.#scheduler = options.scheduler;
    this.#workbenchState = options.workbenchState;
    this.#now = options.now ?? Date.now;
    this.#platform = options.platform ?? process.platform;
    this.#recoverProfilePath = options.recoverProfilePath ?? recoverWorktreeProfilePath;
    this.#observeIdentity = options.observeIdentity ?? observePhysicalDirectoryIdentity;
    this.#createWorkspace = options.createWorkspace
      ?? ((path) => createAppOwnedWorkspaceDescriptor(path, {
        id: (options.createWorkspaceId ?? randomUUID)(),
        now: this.#now
      }));
  }

  async reconcile(): Promise<WorktreeStartupReconcileResult> {
    const result = emptyResult();
    const state = (await this.#workbenchState.load()).state;
    for (const record of state.environmentMutations) {
      if (record.state === "indeterminate" || record.state === "rollback-protected") {
        this.#scheduler.fence(record.repositoryGroupId);
        result[record.state === "indeterminate" ? "indeterminate" : "protected"] += 1;
        continue;
      }
      if (isTerminalState(record.state)) {
        result.skipped += 1;
        continue;
      }
      result.inspected += 1;
      try {
        const disposition = await this.#scheduler.run(record.repositoryGroupId, () => (
          this.#reconcileRecord(record.creationId)
        ));
        result[disposition] += 1;
      } catch (error) {
        if (
          error instanceof RepositoryMutationAdmissionError
          && error.code === "repository-indeterminate"
        ) {
          result.indeterminate += 1;
          continue;
        }
        await this.#markIndeterminate(record.creationId, record.repositoryGroupId);
        result.indeterminate += 1;
      }
    }
    return result;
  }

  async #reconcileRecord(
    creationId: string
  ): Promise<"resumed" | "failed" | "committed" | "rolledBack" | "protected" | "indeterminate"> {
    const current = (await this.#workbenchState.load()).state;
    const record = current.environmentMutations.find((candidate) => candidate.creationId === creationId);
    if (!record || isTerminalState(record.state)) return "resumed";
    const source = current.workspaces.find((candidate) => candidate.id === record.sourceWorkspaceId);
    const sourceBinding = current.workspaceEnvironments.find((candidate) => (
      candidate.workspaceId === record.sourceWorkspaceId
    ));
    if (
      !source
      || source.availability !== "available"
      || !sourceBinding
      || sourceBinding.repositoryGroupId !== record.repositoryGroupId
    ) return this.#markIndeterminate(record.creationId, record.repositoryGroupId);

    let observation: WorktreeArtifactObservation;
    try {
      observation = await this.#observeArtifact(record, source.identity.canonicalPath);
    } catch {
      return this.#markIndeterminate(record.creationId, record.repositoryGroupId);
    }

    switch (record.state) {
      case "reserved":
        if (observation.kind === "absent") {
          await this.#advance(record, "failed");
          return "failed";
        }
        return this.#markIndeterminate(record.creationId, record.repositoryGroupId);
      case "git-materializing":
        if (observation.kind === "absent") {
          await this.#advance(record, "failed");
          return "failed";
        }
        if (observation.kind !== "exact-clean") {
          return this.#markIndeterminate(record.creationId, record.repositoryGroupId);
        }
        await this.#advance(record, "git-materialized");
        await this.#registerWorkspace(record.creationId, observation.targetIdentity.canonicalPath);
        return "resumed";
      case "git-materialized":
        if (observation.kind !== "exact-clean") {
          return this.#markIndeterminate(record.creationId, record.repositoryGroupId);
        }
        await this.#registerWorkspace(record.creationId, observation.targetIdentity.canonicalPath);
        return "resumed";
      case "workspace-registered":
      case "host-registering":
      case "host-registered":
      case "session-materializing":
        return this.#bindingIsExact(current, record, observation)
          ? "resumed"
          : this.#markIndeterminate(record.creationId, record.repositoryGroupId);
      case "session-bound":
        if (!this.#bindingIsExact(current, record, observation) || !record.sessionFileIdentity) {
          return this.#markIndeterminate(record.creationId, record.repositoryGroupId);
        }
        await this.#advance(record, "committed");
        return "committed";
      case "rollback-pending":
        if (observation.kind === "absent") {
          if (record.workspaceId) {
            if (record.rollbackSafety !== "pre-host-confirmed") {
              return this.#markIndeterminate(record.creationId, record.repositoryGroupId);
            }
            await this.#workbenchState.update((state) => {
              const pending = state.environmentMutations.find((candidate) => (
                candidate.creationId === record.creationId
              ));
              if (!pending?.workspaceId) throw new Error("Worktree rollback Workspace receipt is unavailable.");
              return finalizeRolledBackWorktreeWorkspace(
                state,
                record.creationId,
                pending.workspaceId,
                Math.max(this.#now(), pending.updatedAt)
              );
            });
          } else {
            await this.#advance(record, "rolled-back");
          }
          return "rolledBack";
        }
        await this.#advance(record, "rollback-protected");
        this.#scheduler.fence(record.repositoryGroupId);
        return "protected";
      default:
        return "resumed";
    }
  }

  async #observeArtifact(
    record: EnvironmentMutationRecoveryRecord,
    sourcePath: string
  ): Promise<WorktreeArtifactObservation> {
    const [profile, worktrees, branchHead] = await Promise.all([
      this.#recoverProfilePath(this.#userData, record.repositoryGroupId, record.worktreeToken),
      this.#runner.listWorktrees(sourcePath),
      this.#runner.resolveBranchHead(sourcePath, record.branchName)
    ]);
    const worktree = worktrees.find((candidate) => (
      pathsEqual(candidate.path, profile.targetPath, this.#platform)
    ));
    if (!worktree && !profile.exists && branchHead === undefined) return { kind: "absent" };
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
      this.#runner.resolveHeadSha(profile.targetPath),
      this.#runner.resolveCommonDirectory(profile.targetPath),
      this.#runner.statusPorcelain(profile.targetPath),
      this.#observeIdentity(profile.targetPath)
    ]);
    const commonIdentity = await this.#observeIdentity(commonDirectory);
    if (
      headSha !== record.headSha
      || status.length !== 0
      || repositoryGroupId(commonIdentity) !== record.repositoryGroupId
    ) return { kind: "present-mismatch" };
    return { kind: "exact-clean", targetIdentity, worktree };
  }

  #bindingIsExact(
    state: WorkbenchStateV5,
    record: EnvironmentMutationRecoveryRecord,
    observation: WorktreeArtifactObservation
  ): observation is ExactWorktreeArtifactObservation {
    if (observation.kind !== "exact-clean" || !record.workspaceId) return false;
    const workspace = state.workspaces.find((candidate) => candidate.id === record.workspaceId);
    const binding = state.workspaceEnvironments.find((candidate) => candidate.workspaceId === record.workspaceId);
    return Boolean(
      workspace
      && workspaceMatchesPhysicalDirectory(workspace, observation.targetIdentity, this.#platform)
      && binding?.kind === "repository-worktree"
      && binding.ownership === "app"
      && binding.repositoryGroupId === record.repositoryGroupId
      && binding.creationId === record.creationId
    );
  }

  async #registerWorkspace(creationId: string, targetPath: string): Promise<void> {
    const workspace = await this.#createWorkspace(targetPath);
    await this.#workbenchState.update((state) => (
      registerCreatedWorktreeWorkspace(state, creationId, workspace, this.#now())
    ));
  }

  async #advance(
    record: EnvironmentMutationRecoveryRecord,
    state: EnvironmentCreationState
  ): Promise<void> {
    await this.#workbenchState.update((current) => (
      advanceEnvironmentMutation(
        current,
        record.creationId,
        state,
        Math.max(this.#now(), record.updatedAt)
      )
    ));
  }

  async #markIndeterminate(
    creationId: string,
    repositoryId: string
  ): Promise<"indeterminate"> {
    this.#scheduler.fence(repositoryId);
    await this.#workbenchState.update((state) => {
      const record = state.environmentMutations.find((candidate) => candidate.creationId === creationId);
      if (!record || record.state === "indeterminate" || isTerminalState(record.state)) return state;
      return advanceEnvironmentMutation(
        state,
        creationId,
        "indeterminate",
        Math.max(this.#now(), record.updatedAt)
      );
    }).catch(() => undefined);
    return "indeterminate";
  }
}

type WorktreeArtifactObservation =
  | { kind: "absent" }
  | { kind: "present-mismatch" }
  | ExactWorktreeArtifactObservation;

interface ExactWorktreeArtifactObservation {
  kind: "exact-clean";
  targetIdentity: PhysicalDirectoryIdentity;
  worktree: GitWorktreeRecord;
}

function isTerminalState(state: EnvironmentCreationState): boolean {
  return [
    "committed",
    "rolled-back",
    "rollback-protected",
    "failed",
    "indeterminate"
  ].includes(state);
}

function pathsEqual(left: string, right: string, platform: NodeJS.Platform): boolean {
  const normalize = (path: string) => {
    const trimmed = path.replace(/[\\/]+$/u, "");
    return platform === "win32" ? trimmed.toLowerCase() : trimmed;
  };
  return normalize(left) === normalize(right);
}

function emptyResult(): WorktreeStartupReconcileResult {
  return {
    inspected: 0,
    resumed: 0,
    failed: 0,
    committed: 0,
    rolledBack: 0,
    protected: 0,
    indeterminate: 0,
    skipped: 0
  };
}
