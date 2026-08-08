import type { RepositoryEnvironmentSnapshot, WorkspaceDescriptor } from "@pi67/protocol";
import type { PhysicalDirectoryIdentity } from "./repository-identity.js";
import type {
  GitWorktreeRecord,
  RepositoryReadOnlyGitRunner
} from "./worktree-git-runner.js";
import { createEmptyWorkbenchState, type WorkbenchStateV5 } from "./workbench-state.js";

export class MemoryCatalog {
  #snapshot: RepositoryEnvironmentSnapshot | undefined;

  constructor(snapshot?: RepositoryEnvironmentSnapshot) {
    this.#snapshot = snapshot;
  }

  async load(_workspaceId: string, _fingerprint: string) {
    return this.#snapshot ? structuredClone(this.#snapshot) : undefined;
  }

  async replace(_fingerprint: string, snapshot: RepositoryEnvironmentSnapshot) {
    this.#snapshot = structuredClone(snapshot);
  }

  async removeWorkspace(workspaceId: string) {
    if (this.#snapshot?.workspaceId === workspaceId) this.#snapshot = undefined;
  }
}

export function runner(options: {
  root?: string;
  commonDirectory?: string;
  records?: GitWorktreeRecord[];
  rootError?: Error;
}): RepositoryReadOnlyGitRunner {
  return {
    async resolveRepositoryRoot() {
      if (options.rootError) throw options.rootError;
      return options.root ?? "/repo";
    },
    async resolveCommonDirectory() { return options.commonDirectory ?? "/repo/.git"; },
    async listWorktrees() { return options.records ?? [worktree("/repo", "a", "main")]; },
    dispose() {}
  };
}

export function workbench(workspaces: WorkspaceDescriptor[]) {
  let state: WorkbenchStateV5 = {
    ...createEmptyWorkbenchState(),
    workspaces,
    workspaceOrder: workspaces.map((workspace) => workspace.id),
    expandedWorkspaceIds: workspaces.map((workspace) => workspace.id),
    workspaceEnvironments: workspaces.map((workspace) => ({
      workspaceId: workspace.id,
      kind: "plain",
      ownership: "user"
    }))
  };
  return {
    async load() { return { state: structuredClone(state) }; },
    async update(mutator: (current: WorkbenchStateV5) => WorkbenchStateV5) {
      state = mutator(structuredClone(state));
      return structuredClone(state);
    }
  };
}

export function workspace(id: string, canonicalPath: string): WorkspaceDescriptor {
  return {
    id,
    displayName: id,
    identity: { canonicalPath, assurance: "path-only" },
    trust: "trusted",
    trustProvenance: "native-picker",
    availability: "available"
  };
}

export function identity(path: string, inode: string): PhysicalDirectoryIdentity {
  return {
    canonicalPath: path,
    device: "1",
    inode,
    birthtimeNs: "1",
    assurance: "filesystem"
  };
}

export function identityObserver(values: Record<string, PhysicalDirectoryIdentity>) {
  return async (path: string) => {
    const value = values[path];
    if (!value) throw new Error(`Missing identity fixture for ${path}`);
    return value;
  };
}

export function worktree(path: string, sha: string, branchName: string): GitWorktreeRecord {
  return {
    path,
    headSha: sha.repeat(40),
    branchName,
    detached: false,
    locked: false,
    prunable: false
  };
}

export function readySnapshot(workspaceId: string): RepositoryEnvironmentSnapshot {
  return {
    workspaceId,
    status: "ready",
    revision: 4,
    observedAt: 10,
    stale: false,
    repository: {
      repositoryGroupId: "repo_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      assurance: "filesystem",
      currentWorktreeId: "wt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    worktrees: [{
      worktreeId: "wt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workspaceId,
      kind: "primary",
      status: "ready",
      headSha: "a".repeat(40),
      detached: false,
      locked: false
    }]
  };
}
