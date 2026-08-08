import { describe, expect, it } from "vitest";
import {
  currentWorktreeObservation,
  nextRepositoryEnvironmentRevision,
  staleRepositoryEnvironmentSnapshot,
  type RepositoryEnvironmentSnapshot
} from "./repository-environment.js";

describe("repository environment policy", () => {
  it("increments observation revisions without exceeding the safe integer range", () => {
    expect(nextRepositoryEnvironmentRevision(undefined)).toBe(1);
    expect(nextRepositoryEnvironmentRevision(snapshot(4))).toBe(5);
    expect(nextRepositoryEnvironmentRevision(snapshot(Number.MAX_SAFE_INTEGER)))
      .toBe(Number.MAX_SAFE_INTEGER);
  });

  it("preserves the last usable projection while marking a failed refresh stale", () => {
    const ready = snapshot(7);
    const stale = staleRepositoryEnvironmentSnapshot(ready, {
      stage: "worktree-list",
      code: "timeout",
      recoverable: true
    });

    expect(stale).toMatchObject({
      status: "ready",
      revision: 7,
      stale: true,
      error: { stage: "worktree-list", code: "timeout", recoverable: true }
    });
    expect(stale).not.toBe(ready);
    expect(stale.repository).not.toBe(ready.repository);
    expect(stale.worktrees[0]).not.toBe(ready.worktrees[0]);
  });

  it("resolves the selected physical Worktree from the repository projection", () => {
    expect(currentWorktreeObservation(snapshot(1))).toMatchObject({
      worktreeId: "wt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      kind: "primary"
    });
  });

  it("preserves a non-repository projection and reports no selected Worktree", () => {
    const withoutRepository: RepositoryEnvironmentSnapshot = {
      workspaceId: "workspace-a",
      status: "non-git",
      revision: 2,
      observedAt: 10,
      stale: false,
      worktrees: []
    };
    const stale = staleRepositoryEnvironmentSnapshot(withoutRepository, {
      stage: "repository-root",
      code: "not-a-repository",
      recoverable: true
    });

    expect(stale.repository).toBeUndefined();
    expect(currentWorktreeObservation(stale)).toBeUndefined();
  });
});

function snapshot(revision: number): RepositoryEnvironmentSnapshot {
  return {
    workspaceId: "workspace-a",
    status: "ready",
    revision,
    observedAt: 10,
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
  };
}
