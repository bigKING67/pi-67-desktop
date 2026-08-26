import type {
  AppOwnedWorktreeRecoveryRequest,
  AppOwnedWorktreeRecoveryResult,
  RepositorySubmoduleInitializationRequest,
  RepositorySubmoduleInitializationResult,
  RepositorySubmoduleObservation,
  WorkspaceDescriptor
} from "@pi67/protocol";
import {
  observePhysicalDirectoryIdentity,
  repositoryGroupId,
  workspaceIdentityFingerprint,
  type PhysicalDirectoryIdentity
} from "./repository-identity.js";
import {
  RepositoryMutationAdmissionError,
  RepositoryMutationScheduler
} from "./repository-mutation-scheduler.js";
import type { WorkbenchStateV5 } from "./workbench-state.js";
import { restoreAppOwnedWorktreeWorkspace } from "./workbench-state-mutations.js";
import { createAppOwnedWorkspaceDescriptor } from "./workspace-identity.js";
import {
  GitInspectionError,
  type RepositoryMutationGitRunner
} from "./worktree-git-runner.js";
import {
  prepareWorktreeProfilePath,
  recoverWorktreeProfilePath
} from "./worktree-profile-root.js";
import {
  pathsEqual,
  type RepositoryEnvironmentAuthority,
  type WorkbenchStateAuthority
} from "./worktree-creation-service-support.js";

export interface RepositoryWorktreeActionServiceOptions {
  userData: string;
  runner: RepositoryMutationGitRunner;
  scheduler: RepositoryMutationScheduler;
  workbenchState: WorkbenchStateAuthority;
  inspection: RepositoryEnvironmentAuthority;
  now?: () => number;
  platform?: NodeJS.Platform;
  observeIdentity?: (path: string) => Promise<PhysicalDirectoryIdentity>;
}

export class RepositoryWorktreeActionService {
  readonly #now: () => number;
  readonly #platform: NodeJS.Platform;
  readonly #observeIdentity: (path: string) => Promise<PhysicalDirectoryIdentity>;

  constructor(private readonly options: RepositoryWorktreeActionServiceOptions) {
    this.#now = options.now ?? Date.now;
    this.#platform = options.platform ?? process.platform;
    this.#observeIdentity = options.observeIdentity ?? observePhysicalDirectoryIdentity;
  }

  async initializeSubmodules(
    request: RepositorySubmoduleInitializationRequest
  ): Promise<RepositorySubmoduleInitializationResult> {
    try {
      const initial = (await this.options.workbenchState.load()).state;
      const workspace = initial.workspaces.find((candidate) => candidate.id === request.workspaceId);
      if (!workspace || workspace.availability !== "available" || workspace.trust !== "trusted") {
        return { status: "rejected", error: "workspace-unavailable" };
      }
      const snapshot = await this.options.inspection.inspect({ workspaceId: workspace.id });
      if (snapshot.status !== "ready" || snapshot.stale || !snapshot.repository) {
        return { status: "rejected", error: "repository-stale" };
      }
      const fingerprint = workspaceIdentityFingerprint(workspace);
      return await this.options.scheduler.run(snapshot.repository.repositoryGroupId, async () => {
        const current = (await this.options.workbenchState.load()).state.workspaces.find((candidate) => (
          candidate.id === workspace.id
        ));
        if (
          !current
          || current.availability !== "available"
          || current.trust !== "trusted"
          || workspaceIdentityFingerprint(current) !== fingerprint
        ) return { status: "rejected", error: "repository-stale" } as const;

        const before = submoduleObservation(await this.options.runner.inspectSubmodules(
          current.identity.canonicalPath
        ));
        if (!before.networkActionRequired) {
          return before.status === "complete" || before.status === "not-configured"
            ? { status: "initialized", submodules: before } as const
            : { status: "incomplete", submodules: before } as const;
        }
        try {
          await this.options.runner.initializeSubmodules(current.identity.canonicalPath, "network-explicit");
        } catch (error) {
          if (!(error instanceof GitInspectionError && error.code === "process-failed")) throw error;
        }
        const after = submoduleObservation(await this.options.runner.inspectSubmodules(
          current.identity.canonicalPath
        ));
        return after.status === "complete" || after.status === "not-configured"
          ? { status: "initialized", submodules: after }
          : { status: "incomplete", submodules: after };
      });
    } catch (error) {
      if (error instanceof RepositoryMutationAdmissionError) {
        return { status: "rejected", error: "repository-stale" };
      }
      return { status: "rejected", error: error instanceof GitInspectionError ? "git-failed" : "internal" };
    }
  }

  async recoverAppOwnedWorktree(
    request: AppOwnedWorktreeRecoveryRequest
  ): Promise<AppOwnedWorktreeRecoveryResult> {
    try {
      const initial = (await this.options.workbenchState.load()).state;
      const authority = recoveryAuthority(initial, request.workspaceId);
      if (!authority) return rejectedRecovery("not-app-owned", false);
      const { workspace, source, record } = authority;
      if (workspace.availability === "available") return rejectedRecovery("not-recoverable", false);
      if (source.availability !== "available" || source.trust !== "trusted") {
        return rejectedRecovery("not-recoverable", true);
      }
      const recovered = await recoverWorktreeProfilePath(
        this.options.userData,
        record.repositoryGroupId,
        record.worktreeToken
      );
      if (
        !pathsEqual(workspace.identity.canonicalPath, recovered.targetPath, this.#platform)
      ) return rejectedRecovery("identity-changed", false);

      return await this.options.scheduler.run(record.repositoryGroupId, async () => {
        const latest = (await this.options.workbenchState.load()).state;
        const currentAuthority = recoveryAuthority(latest, request.workspaceId);
        if (!currentAuthority || currentAuthority.record.creationId !== record.creationId) {
          return rejectedRecovery("identity-changed", false);
        }
        const profile = await recoverWorktreeProfilePath(
          this.options.userData,
          record.repositoryGroupId,
          record.worktreeToken
        );
        if (
          !pathsEqual(profile.targetPath, recovered.targetPath, this.#platform)
          || !pathsEqual(currentAuthority.workspace.identity.canonicalPath, profile.targetPath, this.#platform)
        ) return rejectedRecovery("identity-changed", false);

        const commonDirectory = await this.options.runner.resolveCommonDirectory(
          currentAuthority.source.identity.canonicalPath
        );
        const commonIdentity = await this.#observeIdentity(commonDirectory);
        if (repositoryGroupId(commonIdentity) !== record.repositoryGroupId) {
          return rejectedRecovery("identity-changed", false);
        }
        const [worktrees, branchHead] = await Promise.all([
          this.options.runner.listWorktrees(currentAuthority.source.identity.canonicalPath),
          this.options.runner.resolveBranchHead(currentAuthority.source.identity.canonicalPath, record.branchName)
        ]);
        if (!branchHead) return rejectedRecovery("not-recoverable", false);
        const exactRegistration = worktrees.find((candidate) => (
          pathsEqual(candidate.path, profile.targetPath, this.#platform)
        ));
        const branchElsewhere = worktrees.some((candidate) => (
          !pathsEqual(candidate.path, profile.targetPath, this.#platform)
          && candidate.branchName === record.branchName
        ));
        if (branchElsewhere) return rejectedRecovery("identity-changed", false);
        if (profile.exists) {
          if (
            !exactRegistration
            || exactRegistration.prunable
            || exactRegistration.locked
            || exactRegistration.detached
            || exactRegistration.branchName !== record.branchName
            || exactRegistration.headSha !== branchHead
          ) return rejectedRecovery("identity-changed", false);
          await this.#verifyRecoveredWorktree(
            currentAuthority.source.identity.canonicalPath,
            profile.targetPath,
            record.repositoryGroupId,
            record.branchName,
            branchHead
          );
          return this.#registerRecoveredWorkspace(request.workspaceId, record.creationId, profile.targetPath);
        }
        if (exactRegistration && (
          !exactRegistration.prunable
          || exactRegistration.locked
          || exactRegistration.detached
          || exactRegistration.branchName !== record.branchName
          || exactRegistration.headSha !== branchHead
        )) return rejectedRecovery("identity-changed", false);

        if (exactRegistration) {
          await this.options.runner.removeWorktree(
            currentAuthority.source.identity.canonicalPath,
            profile.targetPath
          );
        }
        const prepared = await prepareWorktreeProfilePath(
          this.options.userData,
          record.repositoryGroupId,
          record.worktreeToken
        );
        await this.options.runner.restoreWorktree({
          cwd: currentAuthority.source.identity.canonicalPath,
          targetPath: prepared.targetPath,
          branchName: record.branchName,
          hooksPath: prepared.hooksPath
        });
        await this.#verifyRecoveredWorktree(
          currentAuthority.source.identity.canonicalPath,
          prepared.targetPath,
          record.repositoryGroupId,
          record.branchName,
          branchHead
        );
        return this.#registerRecoveredWorkspace(request.workspaceId, record.creationId, prepared.targetPath);
      });
    } catch (error) {
      if (error instanceof RepositoryMutationAdmissionError) {
        return rejectedRecovery("not-recoverable", true);
      }
      return rejectedRecovery(error instanceof GitInspectionError ? "git-failed" : "internal", true);
    }
  }

  async #registerRecoveredWorkspace(
    workspaceId: string,
    creationId: string,
    targetPath: string
  ): Promise<Extract<AppOwnedWorktreeRecoveryResult, { status: "recovered" }>> {
    const restoredWorkspace = await createAppOwnedWorkspaceDescriptor(targetPath, {
      id: workspaceId,
      now: this.#now
    });
    await this.options.workbenchState.update((state) => (
      restoreAppOwnedWorktreeWorkspace(state, creationId, restoredWorkspace)
    ));
    return { status: "recovered", workspace: restoredWorkspace };
  }

  async #verifyRecoveredWorktree(
    sourcePath: string,
    targetPath: string,
    expectedRepositoryGroupId: string,
    branchName: string,
    headSha: string
  ): Promise<void> {
    const [commonDirectory, worktrees, status] = await Promise.all([
      this.options.runner.resolveCommonDirectory(targetPath),
      this.options.runner.listWorktrees(sourcePath),
      this.options.runner.statusPorcelain(targetPath)
    ]);
    if (repositoryGroupId(await this.#observeIdentity(commonDirectory)) !== expectedRepositoryGroupId) {
      throw new Error("Recovered Worktree Repository identity changed.");
    }
    const exact = worktrees.find((candidate) => pathsEqual(candidate.path, targetPath, this.#platform));
    if (
      !exact
      || exact.branchName !== branchName
      || exact.headSha !== headSha
      || exact.detached
      || exact.locked
      || exact.prunable
      || status.length !== 0
    ) throw new Error("Recovered Worktree identity is not exact and clean.");
  }
}

function recoveryAuthority(state: WorkbenchStateV5, workspaceId: string): {
  workspace: WorkspaceDescriptor;
  source: WorkspaceDescriptor;
  record: WorkbenchStateV5["environmentMutations"][number];
} | undefined {
  const workspace = state.workspaces.find((candidate) => candidate.id === workspaceId);
  const binding = state.workspaceEnvironments.find((candidate) => candidate.workspaceId === workspaceId);
  if (
    !workspace
    || binding?.kind !== "repository-worktree"
    || binding.ownership !== "app"
    || !binding.creationId
  ) return undefined;
  const record = state.environmentMutations.find((candidate) => (
    candidate.creationId === binding.creationId
    && candidate.workspaceId === workspaceId
    && candidate.state === "committed"
    && candidate.repositoryGroupId === binding.repositoryGroupId
  ));
  if (!record) return undefined;
  const source = state.workspaces.find((candidate) => candidate.id === record.sourceWorkspaceId);
  return source ? { workspace, source, record } : undefined;
}

function submoduleObservation(
  inspection: Awaited<ReturnType<RepositoryMutationGitRunner["inspectSubmodules"]>>
): RepositorySubmoduleObservation {
  return {
    ...inspection,
    networkActionRequired: inspection.status === "incomplete"
      && inspection.uninitialized > 0
      && inspection.divergent === 0
      && inspection.conflicted === 0
  };
}

function rejectedRecovery(
  error: Extract<AppOwnedWorktreeRecoveryResult, { status: "rejected" }>["error"],
  recoverable: boolean
): Extract<AppOwnedWorktreeRecoveryResult, { status: "rejected" }> {
  return { status: "rejected", error, recoverable };
}
