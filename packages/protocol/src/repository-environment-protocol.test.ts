import { describe, expect, it } from "vitest";
import { MAX_REPOSITORY_WORKTREES } from "@pi67/domain";
import {
  isAppOwnedWorktreeRecoveryResult,
  isRepositoryEnvironmentSnapshot,
  isRepositorySubmoduleInitializationResult,
  parseAppOwnedWorktreeRecoveryRequest,
  parseRepositoryEnvironmentInspectionRequest,
  parseRepositorySubmoduleInitializationRequest
} from "./repository-environment.js";
import { RepositoryEnvironmentSnapshotSchema } from "./repository-environment-schema.js";
import { Value } from "./typebox-schema.js";

describe("repository environment protocol", () => {
  it("accepts only a bounded workspace identity as inspection input", () => {
    expect(parseRepositoryEnvironmentInspectionRequest({ workspaceId: "workspace-a" }))
      .toEqual({ workspaceId: "workspace-a" });
    expect(parseRepositoryEnvironmentInspectionRequest({
      workspaceId: "workspace-a",
      cwd: "/private/repository"
    })).toBeUndefined();
    expect(parseRepositoryEnvironmentInspectionRequest({ workspaceId: "invalid id" }))
      .toBeUndefined();
  });

  it("accepts a bounded ready projection without exposing physical paths", () => {
    const snapshot = readySnapshot();
    expect(isRepositoryEnvironmentSnapshot(snapshot)).toBe(true);
    expect(isRepositoryEnvironmentSnapshot({
      ...snapshot,
      commonDir: "/private/repository/.git"
    })).toBe(false);
  });

  it("projects bounded Submodule completeness and explicit app-owned recovery without paths or URLs", () => {
    expect(isRepositoryEnvironmentSnapshot({
      ...readySnapshot(),
      submodules: {
        status: "incomplete",
        total: 2,
        uninitialized: 1,
        divergent: 0,
        conflicted: 0,
        networkActionRequired: true
      }
    })).toBe(true);
    const missing = {
      workspaceId: "workspace-a",
      status: "missing",
      revision: 0,
      observedAt: 1,
      stale: false,
      worktrees: [],
      recovery: {
        kind: "app-owned-worktree",
        action: "recreate-committed-state",
        unrecoverableData: "uncommitted-and-untracked"
      },
      error: { stage: "workspace", code: "workspace-unavailable", recoverable: true }
    } as const;
    expect(isRepositoryEnvironmentSnapshot(missing)).toBe(true);
    expect(isRepositoryEnvironmentSnapshot({
      ...missing,
      recovery: { ...missing.recovery, targetPath: "/private/worktree" }
    })).toBe(false);
  });

  it("accepts only exact explicit Submodule and Worktree recovery intents with bounded results", () => {
    expect(parseRepositorySubmoduleInitializationRequest({
      workspaceId: "workspace-a",
      mode: "network-explicit"
    })).toEqual({ workspaceId: "workspace-a", mode: "network-explicit" });
    expect(parseRepositorySubmoduleInitializationRequest({
      workspaceId: "workspace-a",
      mode: "local-only"
    })).toBeUndefined();
    expect(isRepositorySubmoduleInitializationResult({
      status: "incomplete",
      submodules: {
        status: "incomplete",
        total: 1,
        uninitialized: 1,
        divergent: 0,
        conflicted: 0,
        networkActionRequired: true
      }
    })).toBe(true);
    expect(parseAppOwnedWorktreeRecoveryRequest({
      workspaceId: "workspace-a",
      confirmation: "recreate-committed-state"
    })).toEqual({ workspaceId: "workspace-a", confirmation: "recreate-committed-state" });
    expect(parseAppOwnedWorktreeRecoveryRequest({
      workspaceId: "workspace-a",
      confirmation: "force"
    })).toBeUndefined();
    expect(isAppOwnedWorktreeRecoveryResult({
      status: "rejected",
      error: "identity-changed",
      recoverable: false
    })).toBe(true);
  });

  it("rejects duplicate Worktree identities and an unknown current Worktree", () => {
    const snapshot = readySnapshot();
    expect(isRepositoryEnvironmentSnapshot({
      ...snapshot,
      worktrees: [snapshot.worktrees[0], snapshot.worktrees[0]]
    })).toBe(false);
    expect(isRepositoryEnvironmentSnapshot({
      ...snapshot,
      repository: {
        ...snapshot.repository,
        currentWorktreeId: "wt_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    })).toBe(false);
  });

  it("requires typed failures and empty Worktree lists for unavailable states", () => {
    expect(isRepositoryEnvironmentSnapshot({
      workspaceId: "workspace-a",
      status: "toolchain-unavailable",
      revision: 0,
      observedAt: 1,
      stale: false,
      worktrees: [],
      error: { stage: "toolchain", code: "toolchain-unavailable", recoverable: true }
    })).toBe(true);
    expect(isRepositoryEnvironmentSnapshot({
      workspaceId: "workspace-a",
      status: "error",
      revision: 0,
      observedAt: 1,
      stale: false,
      worktrees: [{ path: "C:\\secret" }],
      error: { stage: "worktree-list", code: "process-failed", recoverable: true }
    })).toBe(false);
  });

  it("rejects malformed base, repository, Worktree, and error fields", () => {
    const snapshot = readySnapshot();
    const invalid = [
      undefined,
      [],
      {},
      { ...snapshot, workspaceId: "invalid id" },
      { ...snapshot, revision: -1 },
      { ...snapshot, observedAt: Number.MAX_SAFE_INTEGER + 1 },
      { ...snapshot, stale: "false" },
      { ...snapshot, status: "unknown" },
      { ...snapshot, repository: undefined },
      { ...snapshot, repository: { ...snapshot.repository, privatePath: "/secret" } },
      { ...snapshot, repository: { ...snapshot.repository, repositoryGroupId: "repo_invalid" } },
      { ...snapshot, repository: { ...snapshot.repository, assurance: "guessed" } },
      { ...snapshot, repository: { ...snapshot.repository, currentWorktreeId: "wt_invalid" } },
      { ...snapshot, worktrees: [{ ...snapshot.worktrees[0], path: "/secret" }] },
      { ...snapshot, worktrees: [{ ...snapshot.worktrees[0], workspaceId: "invalid id" }] },
      { ...snapshot, worktrees: [{ ...snapshot.worktrees[0], kind: "secondary" }] },
      { ...snapshot, worktrees: [{ ...snapshot.worktrees[0], status: "unknown" }] },
      { ...snapshot, worktrees: [{ ...snapshot.worktrees[0], branchName: "" }] },
      { ...snapshot, worktrees: [{ ...snapshot.worktrees[0], branchName: "x".repeat(513) }] },
      { ...snapshot, worktrees: [{ ...snapshot.worktrees[0], headSha: "A".repeat(40) }] },
      { ...snapshot, worktrees: [{ ...snapshot.worktrees[0], detached: "false" }] },
      { ...snapshot, worktrees: [{ ...snapshot.worktrees[0], locked: 0 }] },
      { ...snapshot, error: { stage: "unknown", code: "timeout", recoverable: true } },
      { ...snapshot, error: { stage: "catalog", code: "unknown-code", recoverable: true } },
      { ...snapshot, error: { stage: "catalog", code: "timeout", recoverable: "yes" } },
      {
        ...snapshot,
        error: { stage: "catalog", code: "timeout", recoverable: true, path: "/secret" }
      }
    ];

    for (const candidate of invalid) {
      expect(isRepositoryEnvironmentSnapshot(candidate)).toBe(false);
    }
  });

  it("enforces the bounded Worktree catalog and exact state-specific shapes", () => {
    const snapshot = readySnapshot();
    const worktrees = Array.from({ length: MAX_REPOSITORY_WORKTREES + 1 }, (_, index) => ({
      ...snapshot.worktrees[0],
      worktreeId: `wt_${index.toString(16).padStart(32, "0")}`
    }));
    expect(isRepositoryEnvironmentSnapshot({
      ...snapshot,
      repository: { ...snapshot.repository, currentWorktreeId: worktrees[0]?.worktreeId },
      worktrees
    })).toBe(false);

    const nonGit = {
      workspaceId: "workspace-a",
      status: "non-git",
      revision: 0,
      observedAt: 1,
      stale: false,
      worktrees: [],
      error: { stage: "repository-root", code: "not-a-repository", recoverable: true }
    } as const;
    expect(isRepositoryEnvironmentSnapshot(nonGit)).toBe(true);
    expect(isRepositoryEnvironmentSnapshot({ ...nonGit, repository: snapshot.repository })).toBe(false);
    expect(isRepositoryEnvironmentSnapshot({ ...nonGit, worktrees: snapshot.worktrees })).toBe(false);

    const failure = {
      workspaceId: "workspace-a",
      status: "missing",
      revision: 0,
      observedAt: 1,
      stale: true,
      worktrees: [],
      error: { stage: "workspace", code: "workspace-unavailable", recoverable: true }
    } as const;
    expect(isRepositoryEnvironmentSnapshot(failure)).toBe(true);
    const { error: _error, ...withoutError } = failure;
    expect(isRepositoryEnvironmentSnapshot(withoutError)).toBe(false);
    expect(isRepositoryEnvironmentSnapshot({ ...failure, repository: snapshot.repository })).toBe(false);
  });

  it("accepts every bounded optional Worktree field and a typed stale ready error", () => {
    const snapshot = readySnapshot();
    expect(isRepositoryEnvironmentSnapshot({
      ...snapshot,
      stale: true,
      error: { stage: "catalog", code: "catalog-unavailable", recoverable: true },
      repository: { ...snapshot.repository, assurance: "path-only" },
      worktrees: [{
        ...snapshot.worktrees[0],
        workspaceId: undefined,
        kind: "linked",
        status: "prunable",
        branchName: undefined,
        headSha: undefined,
        detached: true,
        locked: true
      }]
    })).toBe(true);
  });

  it("keeps the lightweight preload validator aligned with the TypeBox response shape", () => {
    const snapshot = readySnapshot();
    const candidates = [
      snapshot,
      { ...snapshot, unexpected: true },
      { ...snapshot, worktrees: [{ ...snapshot.worktrees[0], kind: "secondary" }] },
      {
        workspaceId: "workspace-a",
        status: "non-git",
        revision: 0,
        observedAt: 1,
        stale: false,
        worktrees: []
      },
      {
        workspaceId: "workspace-a",
        status: "error",
        revision: 0,
        observedAt: 1,
        stale: true,
        worktrees: [],
        error: { stage: "worktree-list", code: "timeout", recoverable: true }
      },
      {
        workspaceId: "workspace-a",
        status: "error",
        revision: 0,
        observedAt: 1,
        stale: true,
        worktrees: snapshot.worktrees,
        error: { stage: "worktree-list", code: "timeout", recoverable: true }
      }
    ];

    for (const candidate of candidates) {
      expect(isRepositoryEnvironmentSnapshot(candidate)).toBe(
        Value.Check(RepositoryEnvironmentSnapshotSchema, candidate)
      );
    }
  });
});

function readySnapshot() {
  return {
    workspaceId: "workspace-a",
    status: "ready",
    revision: 1,
    observedAt: 1,
    stale: false,
    repository: {
      repositoryGroupId: "repo_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      assurance: "filesystem",
      currentWorktreeId: "wt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    worktrees: [{
      worktreeId: "wt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workspaceId: "workspace-a",
      kind: "primary",
      status: "ready",
      branchName: "main",
      headSha: "a".repeat(40),
      detached: false,
      locked: false
    }]
  } as const;
}
