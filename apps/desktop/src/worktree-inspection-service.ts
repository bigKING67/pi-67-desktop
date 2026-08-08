import {
  nextRepositoryEnvironmentRevision,
  staleRepositoryEnvironmentSnapshot,
  type RepositoryEnvironmentError,
  type RepositoryEnvironmentInspectionRequest,
  type RepositoryEnvironmentSnapshot,
  type WorkspaceDescriptor
} from "@pi67/protocol";
import {
  observePhysicalDirectoryIdentity,
  repositoryGroupId,
  workspaceIdentityFingerprint,
  workspaceMatchesPhysicalDirectory,
  worktreeProjectionId,
  type PhysicalDirectoryIdentity
} from "./repository-identity.js";
import {
  GitInspectionError,
  type GitWorktreeRecord,
  type RepositoryReadOnlyGitRunner
} from "./worktree-git-runner.js";
import { recordObservedWorkspaceEnvironment } from "./workbench-state-mutations.js";
import type { WorkbenchStateV5 } from "./workbench-state.js";

interface WorkbenchStateReader {
  load(): Promise<{ state: WorkbenchStateV5 }>;
  update(mutator: (current: WorkbenchStateV5) => WorkbenchStateV5): Promise<WorkbenchStateV5>;
}

interface WorktreeCatalogProjection {
  load(workspaceId: string, workspaceFingerprint: string): Promise<RepositoryEnvironmentSnapshot | undefined>;
  replace(workspaceFingerprint: string, snapshot: RepositoryEnvironmentSnapshot): Promise<void>;
  removeWorkspace(workspaceId: string): Promise<void>;
}

interface InspectionFlight {
  latestRequest: RepositoryEnvironmentInspectionRequest;
  pending: boolean;
  promise: Promise<RepositoryEnvironmentSnapshot>;
}

const DEFAULT_DRAIN_DEADLINE_MS = 4_000;

export interface WorktreeInspectionServiceOptions {
  runner: RepositoryReadOnlyGitRunner;
  workbenchState: WorkbenchStateReader;
  catalog: WorktreeCatalogProjection;
  now?: () => number;
  platform?: NodeJS.Platform;
  observeIdentity?: (path: string) => Promise<PhysicalDirectoryIdentity>;
}

export class WorktreeInspectionService {
  readonly #runner: RepositoryReadOnlyGitRunner;
  readonly #workbenchState: WorkbenchStateReader;
  readonly #catalog: WorktreeCatalogProjection;
  readonly #now: () => number;
  readonly #platform: NodeJS.Platform;
  readonly #observeIdentity: (path: string) => Promise<PhysicalDirectoryIdentity>;
  readonly #flights = new Map<string, InspectionFlight>();
  #disposed = false;

  constructor(options: WorktreeInspectionServiceOptions) {
    this.#runner = options.runner;
    this.#workbenchState = options.workbenchState;
    this.#catalog = options.catalog;
    this.#now = options.now ?? Date.now;
    this.#platform = options.platform ?? process.platform;
    this.#observeIdentity = options.observeIdentity ?? observePhysicalDirectoryIdentity;
  }

  inspect(request: RepositoryEnvironmentInspectionRequest): Promise<RepositoryEnvironmentSnapshot> {
    if (this.#disposed) {
      return Promise.resolve(failureSnapshot(request.workspaceId, this.#now(), "error", {
        stage: "workspace",
        code: "workspace-unavailable",
        recoverable: true
      }));
    }
    const existing = this.#flights.get(request.workspaceId);
    if (existing) {
      existing.latestRequest = request;
      existing.pending = true;
      return existing.promise;
    }
    const flight = {} as InspectionFlight;
    flight.latestRequest = request;
    flight.pending = false;
    flight.promise = this.#runFlight(flight).finally(() => {
      if (this.#flights.get(request.workspaceId) === flight) this.#flights.delete(request.workspaceId);
    });
    this.#flights.set(request.workspaceId, flight);
    return flight.promise;
  }

  removeWorkspace(workspaceId: string): Promise<void> {
    return this.#catalog.removeWorkspace(workspaceId);
  }

  async drain(workspaceId?: string, deadlineMs = DEFAULT_DRAIN_DEADLINE_MS): Promise<void> {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 0) {
      throw new RangeError("Worktree inspection drain deadline must be a non-negative integer.");
    }
    const flights = workspaceId === undefined
      ? [...this.#flights.values()]
      : this.#flights.has(workspaceId) ? [this.#flights.get(workspaceId)!] : [];
    if (flights.length === 0) return;
    const settled = Promise.allSettled(flights.map((flight) => flight.promise)).then(() => undefined);
    if (deadlineMs === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      settled,
      new Promise<void>((resolve) => { timer = setTimeout(resolve, deadlineMs); })
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#runner.dispose();
  }

  async #runFlight(flight: InspectionFlight): Promise<RepositoryEnvironmentSnapshot> {
    let result = await this.#inspect(flight.latestRequest.workspaceId);
    while (!this.#disposed && flight.pending) {
      flight.pending = false;
      result = await this.#inspect(flight.latestRequest.workspaceId);
    }
    return result;
  }

  async #inspect(workspaceId: string): Promise<RepositoryEnvironmentSnapshot> {
    const workbench = await this.#workbenchState.load();
    const workspace = workbench.state.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) {
      return failureSnapshot(workspaceId, this.#now(), "error", {
        stage: "workspace",
        code: "workspace-not-found",
        recoverable: false
      });
    }
    const fingerprint = workspaceIdentityFingerprint(workspace);
    let cached: RepositoryEnvironmentSnapshot | undefined;
    let catalogUnavailable = false;
    try {
      cached = await this.#catalog.load(workspaceId, fingerprint);
    } catch {
      catalogUnavailable = true;
    }
    if (workspace.availability !== "available") {
      return failureSnapshot(workspaceId, this.#now(), "missing", {
        stage: "workspace",
        code: "workspace-unavailable",
        recoverable: true
      });
    }

    try {
      const repositoryRoot = await this.#runner.resolveRepositoryRoot(workspace.identity.canonicalPath);
      const controller = new AbortController();
      let commonDirectory: string;
      let records: GitWorktreeRecord[];
      try {
        [commonDirectory, records] = await Promise.all([
          this.#runner.resolveCommonDirectory(repositoryRoot, controller.signal),
          this.#runner.listWorktrees(repositoryRoot, controller.signal)
        ]);
      } catch (error) {
        controller.abort();
        throw error;
      }
      const snapshot = await this.#projectReadySnapshot({
        workspace,
        registeredWorkspaces: workbench.state.workspaces,
        commonDirectory,
        records,
        previous: cached
      });
      const latestWorkbench = await this.#workbenchState.load();
      const latestWorkspace = latestWorkbench.state.workspaces.find((candidate) => candidate.id === workspaceId);
      if (
        !latestWorkspace
        || latestWorkspace.availability !== "available"
        || workspaceIdentityFingerprint(latestWorkspace) !== fingerprint
      ) {
        return cached
          ? staleRepositoryEnvironmentSnapshot(cached, {
              stage: "workspace",
              code: "workspace-unavailable",
              recoverable: true
            })
          : failureSnapshot(workspaceId, this.#now(), "missing", {
              stage: "workspace",
              code: "workspace-unavailable",
              recoverable: true
            });
      }
      const currentWorktree = snapshot.worktrees.find((worktree) => (
        worktree.worktreeId === snapshot.repository?.currentWorktreeId
      ));
      if (!currentWorktree) throw new GitInspectionError("worktree-list", "invalid-output");
      let stateUnavailable = false;
      try {
        await this.#workbenchState.update((state) => recordObservedWorkspaceEnvironment(state, {
          workspaceId,
          kind: currentWorktree.kind === "primary" ? "repository-primary" : "repository-worktree",
          repositoryGroupId: snapshot.repository!.repositoryGroupId
        }));
      } catch {
        stateUnavailable = true;
      }
      try {
        await this.#catalog.replace(fingerprint, snapshot);
      } catch {
        return {
          ...snapshot,
          error: stateUnavailable
            ? { stage: "state", code: "state-unavailable", recoverable: true }
            : { stage: "catalog", code: "catalog-unavailable", recoverable: true }
        };
      }
      return stateUnavailable
        ? {
            ...snapshot,
            error: { stage: "state", code: "state-unavailable", recoverable: true }
          }
        : catalogUnavailable
        ? {
            ...snapshot,
            error: { stage: "catalog", code: "catalog-unavailable", recoverable: true }
          }
        : snapshot;
    } catch (error) {
      if (error instanceof GitInspectionError && error.code === "not-a-repository") {
        const snapshot: RepositoryEnvironmentSnapshot = {
          workspaceId,
          status: "non-git",
          revision: nextRepositoryEnvironmentRevision(cached),
          observedAt: this.#now(),
          stale: false,
          worktrees: [],
          ...(catalogUnavailable
            ? { error: { stage: "catalog" as const, code: "catalog-unavailable" as const, recoverable: true } }
            : {})
        };
        await this.#catalog.replace(fingerprint, snapshot).catch(() => undefined);
        return snapshot;
      }
      const mapped = mapInspectionError(error);
      return cached
        ? staleRepositoryEnvironmentSnapshot(cached, mapped)
        : failureSnapshot(
            workspaceId,
            this.#now(),
            mapped.code === "toolchain-unavailable" ? "toolchain-unavailable" : "error",
            mapped
          );
    }
  }

  async #projectReadySnapshot(options: {
    workspace: WorkspaceDescriptor;
    registeredWorkspaces: WorkspaceDescriptor[];
    commonDirectory: string;
    records: GitWorktreeRecord[];
    previous: RepositoryEnvironmentSnapshot | undefined;
  }): Promise<RepositoryEnvironmentSnapshot> {
    const [commonIdentity, currentIdentity, observedWorktrees] = await Promise.all([
      this.#observeIdentity(options.commonDirectory),
      this.#observeIdentity(options.workspace.identity.canonicalPath),
      Promise.all(options.records.map(async (record) => {
        try {
          return { record, identity: await this.#observeIdentity(record.path), exists: true };
        } catch (error) {
          if (isNodeError(error, "ENOENT") || isNodeError(error, "ENOTDIR")) {
            return {
              record,
              identity: {
                canonicalPath: record.path,
                assurance: "path-only" as const
              },
              exists: false
            };
          }
          throw error;
        }
      }))
    ]);
    const current = observedWorktrees.find(({ identity }) => (
      workspaceMatchesPhysicalDirectory(options.workspace, identity, this.#platform)
      || workspaceMatchesIdentity(currentIdentity, identity, this.#platform)
    ));
    if (!current) throw new GitInspectionError("worktree-list", "invalid-output");

    const ids = new Set<string>();
    const worktrees = observedWorktrees.map(({ record, identity, exists }, index) => {
      const worktreeId = worktreeProjectionId(identity);
      if (ids.has(worktreeId)) throw new GitInspectionError("worktree-list", "invalid-output");
      ids.add(worktreeId);
      const registered = options.registeredWorkspaces.find((workspace) => (
        workspaceMatchesPhysicalDirectory(workspace, identity, this.#platform)
      ));
      return {
        worktreeId,
        ...(registered ? { workspaceId: registered.id } : {}),
        kind: index === 0 ? "primary" as const : "linked" as const,
        status: record.prunable ? "prunable" as const : exists ? "ready" as const : "missing" as const,
        ...(record.branchName ? { branchName: record.branchName } : {}),
        ...(record.headSha ? { headSha: record.headSha } : {}),
        detached: record.detached,
        locked: record.locked
      };
    });
    const currentWorktreeId = worktreeProjectionId(current.identity);
    if (!ids.has(currentWorktreeId)) throw new GitInspectionError("worktree-list", "invalid-output");
    return {
      workspaceId: options.workspace.id,
      status: "ready",
      revision: nextRepositoryEnvironmentRevision(options.previous),
      observedAt: this.#now(),
      stale: false,
      repository: {
        repositoryGroupId: repositoryGroupId(commonIdentity),
        assurance: commonIdentity.assurance,
        currentWorktreeId
      },
      worktrees
    };
  }
}

function mapInspectionError(error: unknown): RepositoryEnvironmentError {
  if (error instanceof GitInspectionError) {
    const stage = inspectionFailureStage(error.stage);
    if (!stage) return { stage: "identity", code: "unknown", recoverable: false };
    return {
      stage,
      code: error.code === "cancelled" ? "unknown" : error.code,
      recoverable: error.code !== "invalid-output"
    };
  }
  return { stage: "identity", code: "identity-unavailable", recoverable: true };
}

function inspectionFailureStage(
  stage: GitInspectionError["stage"]
): RepositoryEnvironmentError["stage"] | undefined {
  return stage === "repository-root" || stage === "common-dir" || stage === "worktree-list"
    ? stage
    : undefined;
}

function failureSnapshot(
  workspaceId: string,
  observedAt: number,
  status: "toolchain-unavailable" | "missing" | "error",
  error: RepositoryEnvironmentError
): RepositoryEnvironmentSnapshot {
  return {
    workspaceId,
    status,
    revision: 0,
    observedAt,
    stale: false,
    worktrees: [],
    error
  };
}

function workspaceMatchesIdentity(
  left: PhysicalDirectoryIdentity,
  right: PhysicalDirectoryIdentity,
  platform: NodeJS.Platform
): boolean {
  if (left.assurance === "filesystem" && right.assurance === "filesystem") {
    return left.device === right.device
      && left.inode === right.inode
      && left.birthtimeNs === right.birthtimeNs;
  }
  const normalize = (path: string) => {
    const trimmed = path.replace(/[\\/]+$/u, "");
    return platform === "win32" ? trimmed.toLowerCase() : trimmed;
  };
  return normalize(left.canonicalPath) === normalize(right.canonicalPath);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
