import { describe, expect, it } from "vitest";
import type { RepositoryEnvironmentSnapshot } from "@pi67/protocol";
import { repositoryEnvironmentPresentation } from "./RepositoryEnvironmentStatus.js";

describe("repository environment presentation", () => {
  it("distinguishes primary, linked, non-Git, stale, and unavailable states", () => {
    expect(repositoryEnvironmentPresentation({
      requestRevision: 1,
      status: "ready",
      snapshot: ready("primary")
    })).toMatchObject({ kind: "primary", label: "主工作树", tone: "success" });
    expect(repositoryEnvironmentPresentation({
      requestRevision: 1,
      status: "ready",
      snapshot: ready("linked")
    })).toMatchObject({ kind: "linked", label: "链接工作树", tone: "success" });
    const nonGit = repositoryEnvironmentPresentation({
      requestRevision: 1,
      status: "ready",
      snapshot: { workspaceId: "workspace-a", status: "non-git", revision: 1, observedAt: 1, stale: false, worktrees: [] }
    });
    expect(nonGit).toMatchObject({ kind: "non-git", label: "非 Git 目录" });
    expect(nonGit.description).not.toContain("重新检查");
    expect(repositoryEnvironmentPresentation({
      requestRevision: 1,
      status: "ready",
      snapshot: { ...ready("primary"), stale: true }
    })).toMatchObject({ kind: "stale", tone: "warning" });
    expect(repositoryEnvironmentPresentation({
      requestRevision: 1,
      status: "ready",
      snapshot: {
        workspaceId: "workspace-a",
        status: "toolchain-unavailable",
        revision: 0,
        observedAt: 1,
        stale: false,
        worktrees: [],
        error: { stage: "toolchain", code: "toolchain-unavailable", recoverable: true }
      }
    })).toMatchObject({ kind: "toolchain-unavailable", tone: "warning" });
  });
});

function ready(kind: "primary" | "linked"): RepositoryEnvironmentSnapshot {
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
      kind,
      status: "ready",
      branchName: "main",
      headSha: "a".repeat(40),
      detached: false,
      locked: false
    }]
  };
}
