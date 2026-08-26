import { randomBytes, randomUUID } from "node:crypto";
import { basename } from "node:path";
import type {
  EnvironmentMutationRecoveryRecord,
  WorktreeCreationAdvanceReceipt,
  WorktreeCreationAdvanceRequest,
  WorktreeCreationAdvanceResult,
  WorktreeCreationActivity,
  WorktreeCreationActivityRequest,
  WorktreeCreationActivityResult,
  WorktreeCreationCancelRequest,
  WorktreeCreationCancelResult,
  WorktreeCreationRequest,
  WorktreeCreationResult,
  WorktreeCreationRollbackRequest,
  WorktreeCreationRollbackResult
} from "@pi67/protocol";
import {
  createAppOwnedWorkspaceDescriptor,
  type WorkspaceDescriptor
} from "./workspace-identity.js";
import {
  advanceEnvironmentMutation,
  registerCreatedWorktreeWorkspace,
  reserveEnvironmentMutation
} from "./workbench-state-mutations.js";
import {
  type RepositoryMutationGitRunner
} from "./worktree-git-runner.js";
import {
  materializeLocalSubmodules,
  observeRepositorySubmodules
} from "./worktree-submodule-materialization.js";
import {
  RepositoryMutationAdmissionError,
  RepositoryMutationScheduler
} from "./repository-mutation-scheduler.js";
import {
  observePhysicalDirectoryIdentity,
  repositoryGroupId,
  type PhysicalDirectoryIdentity
} from "./repository-identity.js";
import {
  prepareWorktreeProfilePath,
  recoverWorktreeProfilePath,
  type PreparedWorktreeProfilePath,
  type RecoveredWorktreeProfilePath
} from "./worktree-profile-root.js";
import { WorktreeCreationRollbackService } from "./worktree-creation-rollback-service.js";
import { rollbackFailedWorktreeCreation } from "./worktree-creation-failure-rollback.js";
import {
  PROGRESS_STATES,
  WorktreeCreationServiceError,
  creationRequestFingerprint,
  existingCreationResult,
  isProgressState,
  mapGitPreflightError,
  pathsEqual,
  progressReceipt,
  rejected,
  serviceError,
  type RepositoryEnvironmentAuthority,
  type WorkbenchStateAuthority
} from "./worktree-creation-service-support.js";

export interface WorktreeCreationServiceOptions {
  userData: string;
  runner: RepositoryMutationGitRunner;
  scheduler: RepositoryMutationScheduler;
  workbenchState: WorkbenchStateAuthority;
  inspection: RepositoryEnvironmentAuthority;
  now?: () => number;
  createToken?: () => string;
  createWorkspaceId?: () => string;
  platform?: NodeJS.Platform;
  recoverProfilePath?: (
    userData: string,
    repositoryGroupId: string,
    worktreeToken: string
  ) => Promise<RecoveredWorktreeProfilePath>;
  observeIdentity?: (path: string) => Promise<PhysicalDirectoryIdentity>;
}

interface CreationFlight {
  fingerprint: string;
  promise: Promise<WorktreeCreationResult>;
  controller: AbortController;
  activity: WorktreeCreationActivity;
}

const CREATION_STAGE_BUDGETS = {
  preflight: 30_000,
  checkout: 300_000,
  submodules: 120_000,
  verifying: 30_000,
  "workspace-registering": 30_000
} as const;

export class WorktreeCreationService {
  readonly #userData: string;
  readonly #runner: RepositoryMutationGitRunner;
  readonly #scheduler: RepositoryMutationScheduler;
  readonly #workbenchState: WorkbenchStateAuthority;
  readonly #inspection: RepositoryEnvironmentAuthority;
  readonly #now: () => number;
  readonly #createToken: () => string;
  readonly #createWorkspaceId: () => string;
  readonly #platform: NodeJS.Platform;
  readonly #recoverProfilePath: NonNullable<WorktreeCreationServiceOptions["recoverProfilePath"]>;
  readonly #observeIdentity: NonNullable<WorktreeCreationServiceOptions["observeIdentity"]>;
  readonly #rollbackService: WorktreeCreationRollbackService;
  readonly #flights = new Map<string, CreationFlight>();

  constructor(options: WorktreeCreationServiceOptions) {
    this.#userData = options.userData;
    this.#runner = options.runner;
    this.#scheduler = options.scheduler;
    this.#workbenchState = options.workbenchState;
    this.#inspection = options.inspection;
    this.#now = options.now ?? Date.now;
    this.#createToken = options.createToken ?? (() => randomBytes(8).toString("hex"));
    this.#createWorkspaceId = options.createWorkspaceId ?? randomUUID;
    this.#platform = options.platform ?? process.platform;
    this.#recoverProfilePath = options.recoverProfilePath ?? recoverWorktreeProfilePath;
    this.#observeIdentity = options.observeIdentity ?? observePhysicalDirectoryIdentity;
    this.#rollbackService = new WorktreeCreationRollbackService({
      userData: this.#userData,
      runner: this.#runner,
      scheduler: this.#scheduler,
      workbenchState: this.#workbenchState,
      now: this.#now,
      platform: this.#platform,
      recoverProfilePath: this.#recoverProfilePath,
      observeIdentity: this.#observeIdentity
    });
  }

  create(request: WorktreeCreationRequest): Promise<WorktreeCreationResult> {
    const fingerprint = creationRequestFingerprint(request);
    const existing = this.#flights.get(request.creationId);
    if (existing) {
      return existing.fingerprint === fingerprint
        ? existing.promise
        : Promise.resolve(rejected("request", "invalid-request", false));
    }
    const controller = new AbortController();
    const startedAt = this.#now();
    const flight = {
      fingerprint,
      controller,
      activity: {
        creationId: request.creationId,
        stage: "preflight" as const,
        startedAt,
        updatedAt: startedAt,
        budgetMs: CREATION_STAGE_BUDGETS.preflight,
        cancellable: true as const
      }
    } as CreationFlight;
    const promise = this.#create(request, fingerprint, flight).catch((error: unknown) => (
      error instanceof WorktreeCreationServiceError
        ? { status: "rejected" as const, error: error.view }
        : rejected("state", "internal", true)
    )).finally(() => {
      if (this.#flights.get(request.creationId)?.promise === promise) this.#flights.delete(request.creationId);
    });
    flight.promise = promise;
    this.#flights.set(request.creationId, flight);
    return promise;
  }

  activity(request: WorktreeCreationActivityRequest): WorktreeCreationActivityResult {
    const flight = this.#flights.get(request.creationId);
    return flight
      ? { status: "active", activity: { ...flight.activity } }
      : { status: "inactive" };
  }

  cancel(request: WorktreeCreationCancelRequest): WorktreeCreationCancelResult {
    const flight = this.#flights.get(request.creationId);
    if (!flight) return { status: "inactive" };
    flight.controller.abort();
    return { status: "cancel-requested" };
  }

  dispose(): void {
    for (const flight of this.#flights.values()) flight.controller.abort();
  }

  async advance(request: WorktreeCreationAdvanceRequest): Promise<WorktreeCreationAdvanceResult> {
    try {
      let receipt: WorktreeCreationAdvanceReceipt | undefined;
      await this.#workbenchState.update((current) => {
        const record = current.environmentMutations.find((candidate) => (
          candidate.creationId === request.creationId
        ));
        if (!record || !record.workspaceId || !isProgressState(record.state)) {
          throw serviceError("state", "recovery-required", true);
        }
        const currentIndex = PROGRESS_STATES.indexOf(record.state);
        const targetIndex = PROGRESS_STATES.indexOf(request.targetState);
        if (targetIndex > currentIndex + 1) {
          throw serviceError("state", "recovery-required", true);
        }
        if (
          request.targetState === "session-bound"
          && currentIndex >= targetIndex
          && record.sessionFileIdentity !== request.sessionFileIdentity
        ) {
          throw serviceError("request", "invalid-request", false);
        }
        const next = targetIndex <= currentIndex
          ? current
          : advanceEnvironmentMutation(
              current,
              request.creationId,
              request.targetState,
              Math.max(this.#now(), record.updatedAt),
              request.targetState === "session-bound"
                ? { sessionFileIdentity: request.sessionFileIdentity }
                : {}
            );
        const advanced = next.environmentMutations.find((candidate) => (
          candidate.creationId === request.creationId
        ));
        if (!advanced || !advanced.workspaceId || !isProgressState(advanced.state)) {
          throw serviceError("state", "recovery-required", true);
        }
        receipt = progressReceipt(advanced);
        return next;
      });
      if (!receipt) return rejected("state", "state-unavailable", true);
      return { status: "advanced", receipt };
    } catch (error) {
      return error instanceof WorktreeCreationServiceError
        ? { status: "rejected", error: error.view }
        : rejected("state", "state-unavailable", true);
    }
  }

  async rollback(request: WorktreeCreationRollbackRequest): Promise<WorktreeCreationRollbackResult> {
    return this.#rollbackService.rollback(request);
  }

  async #create(
    request: WorktreeCreationRequest,
    fingerprint: string,
    flight: CreationFlight
  ): Promise<WorktreeCreationResult> {
    const signal = flight.controller.signal;
    if (signal.aborted) return rejected("preflight", "cancelled", true);
    const initial = (await this.#workbenchState.load()).state;
    const replay = existingCreationResult(initial, request, fingerprint);
    if (replay?.status === "created") {
      const submodules = observeRepositorySubmodules(await this.#runner.inspectSubmodules(
        replay.receipt.workspace.identity.canonicalPath,
        signal
      ));
      return { ...replay, receipt: { ...replay.receipt, submodules } };
    }
    if (replay) return replay;
    const source = initial.workspaces.find((workspace) => workspace.id === request.sourceWorkspaceId);
    if (!source) throw serviceError("preflight", "workspace-not-found", false);
    if (source.availability !== "available") throw serviceError("preflight", "workspace-unavailable", true);
    if (source.trust !== "trusted") throw serviceError("preflight", "workspace-untrusted", true);

    const snapshot = await this.#inspection.inspect({ workspaceId: source.id });
    if (signal.aborted) return rejected("preflight", "cancelled", true);
    if (snapshot.status !== "ready" || !snapshot.repository) {
      throw serviceError("preflight", "repository-not-ready", true);
    }
    if (snapshot.stale) throw serviceError("preflight", "repository-stale", true);
    if (snapshot.error?.stage === "state") throw serviceError("state", "state-unavailable", true);
    const current = snapshot.worktrees.find((worktree) => (
      worktree.worktreeId === snapshot.repository?.currentWorktreeId
    ));
    if (!current || current.status !== "ready" || !current.headSha) {
      throw serviceError("preflight", "repository-not-ready", true);
    }

    let exactHeadSha: string;
    try {
      exactHeadSha = await this.#runner.resolveHeadSha(source.identity.canonicalPath, signal);
    } catch (error) {
      throw mapGitPreflightError(error);
    }
    if (exactHeadSha !== current.headSha) throw serviceError("preflight", "repository-stale", true);
    const filters = await this.#runner.inspectFilters(source.identity.canonicalPath, signal).catch((error: unknown) => {
      throw mapGitPreflightError(error);
    });
    if (filters.unknownFilterNames.length > 0) throw serviceError("preflight", "custom-filter", true);

    const prepared = await this.#reserveProfilePath(snapshot.repository.repositoryGroupId);
    const createdAt = this.#now();
    const worktreeToken = basename(prepared.targetPath);
    const record: EnvironmentMutationRecoveryRecord = {
      kind: "worktree-creation",
      requestId: request.requestId,
      creationId: request.creationId,
      requestFingerprint: fingerprint,
      sourceWorkspaceId: request.sourceWorkspaceId,
      repositoryGroupId: snapshot.repository.repositoryGroupId,
      worktreeToken,
      branchName: `pi67/task-${worktreeToken}`,
      headSha: exactHeadSha,
      state: "reserved",
      createdAt,
      updatedAt: createdAt
    };

    try {
      this.#setStage(flight, "queued");
      return await this.#scheduler.run(record.repositoryGroupId, () => (
        this.#materialize(request, record, source, prepared, flight)
      ), signal);
    } catch (error) {
      if (error instanceof RepositoryMutationAdmissionError) {
        if (error.code === "queue-full") return rejected("preflight", "queue-full", true);
        if (error.code === "cancelled") return rejected("preflight", "cancelled", true);
        return rejected("preflight", "repository-indeterminate", true);
      }
      throw error;
    }
  }

  async #materialize(
    request: WorktreeCreationRequest,
    record: EnvironmentMutationRecoveryRecord,
    source: WorkspaceDescriptor,
    prepared: PreparedWorktreeProfilePath,
    flight: CreationFlight
  ): Promise<WorktreeCreationResult> {
    const signal = flight.controller.signal;
    if (signal.aborted) return rejected("preflight", "cancelled", true);
    try {
      await this.#workbenchState.update((state) => reserveEnvironmentMutation(state, record));
      await this.#workbenchState.update((state) => (
        advanceEnvironmentMutation(state, record.creationId, "git-materializing", this.#now())
      ));
    } catch {
      return rejected("state", "state-unavailable", true);
    }

    let gitStarted = false;
    try {
      this.#setStage(flight, "checkout");
      gitStarted = true;
      await this.#runner.addWorktree({
        cwd: source.identity.canonicalPath,
        targetPath: prepared.targetPath,
        branchName: record.branchName,
        headSha: record.headSha,
        hooksPath: prepared.hooksPath
      }, signal);
      await this.#workbenchState.update((state) => (
        advanceEnvironmentMutation(state, record.creationId, "git-materialized", this.#now())
      ));
      this.#setStage(flight, "submodules");
      const submodules = await materializeLocalSubmodules(this.#runner, prepared.targetPath, signal);
      this.#setStage(flight, "verifying");
      await this.#verifyMaterializedWorktree(source.identity.canonicalPath, prepared.targetPath, record, signal);
      this.#setStage(flight, "workspace-registering");
      const workspace = await createAppOwnedWorkspaceDescriptor(prepared.targetPath, {
        id: this.#createWorkspaceId(),
        now: this.#now
      });
      const state = await this.#workbenchState.update((current) => (
        registerCreatedWorktreeWorkspace(current, record.creationId, workspace, this.#now())
      ));
      const registeredRecord = state.environmentMutations.find((candidate) => candidate.creationId === record.creationId);
      const registeredWorkspace = registeredRecord?.workspaceId
        ? state.workspaces.find((candidate) => candidate.id === registeredRecord.workspaceId)
        : undefined;
      if (!registeredRecord || !registeredWorkspace || registeredRecord.state !== "workspace-registered") {
        throw new Error("Created Worktree receipt is unavailable.");
      }
      return {
        status: "created",
        receipt: {
          requestId: request.requestId,
          creationId: request.creationId,
          sourceWorkspaceId: request.sourceWorkspaceId,
          repositoryGroupId: record.repositoryGroupId,
          state: "workspace-registered",
          workspace: registeredWorkspace,
          submodules
        }
      };
    } catch (error) {
      if (!gitStarted) return rejected("state", "state-unavailable", true);
      return rollbackFailedWorktreeCreation({
        runner: this.#runner,
        scheduler: this.#scheduler,
        workbenchState: this.#workbenchState,
        now: this.#now,
        platform: this.#platform
      }, source.identity.canonicalPath, prepared.targetPath, record, error);
    }
  }

  async #verifyMaterializedWorktree(
    sourcePath: string,
    targetPath: string,
    record: EnvironmentMutationRecoveryRecord,
    signal?: AbortSignal
  ): Promise<void> {
    const [commonDirectory, worktrees, status] = await Promise.all([
      this.#runner.resolveCommonDirectory(targetPath, signal),
      this.#runner.listWorktrees(sourcePath, signal),
      this.#runner.statusPorcelain(targetPath, signal)
    ]);
    const commonIdentity = await this.#observeIdentity(commonDirectory);
    if (repositoryGroupId(commonIdentity) !== record.repositoryGroupId) {
      throw new Error("Created Worktree Repository identity does not match its reservation.");
    }
    const worktree = worktrees.find((candidate) => pathsEqual(candidate.path, targetPath, this.#platform));
    if (
      !worktree
      || worktree.branchName !== record.branchName
      || worktree.headSha !== record.headSha
      || worktree.detached
      || worktree.locked
      || worktree.prunable
      || status.length !== 0
    ) throw new Error("Created Worktree does not match its reservation.");
  }

  async #reserveProfilePath(repositoryId: string): Promise<PreparedWorktreeProfilePath> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const token = this.#createToken();
      if (!/^[a-z0-9]{16}$/u.test(token)) throw serviceError("identity", "identity-collision", false);
      try {
        return await prepareWorktreeProfilePath(this.#userData, repositoryId, token);
      } catch (error) {
        if (error instanceof Error && error.message === "Worktree target already exists.") continue;
        throw serviceError("identity", "identity-collision", false);
      }
    }
    throw serviceError("identity", "identity-collision", true);
  }

  #setStage(flight: CreationFlight, stage: WorktreeCreationActivity["stage"]): void {
    const updatedAt = Math.max(this.#now(), flight.activity.updatedAt);
    const budgetMs = stage === "queued" ? undefined : CREATION_STAGE_BUDGETS[stage];
    flight.activity = {
      creationId: flight.activity.creationId,
      stage,
      startedAt: updatedAt,
      updatedAt,
      ...(budgetMs ? { budgetMs } : {}),
      cancellable: true
    };
  }
}
