import { describe, expect, it, vi } from "vitest";
import { createEmptyWorkbenchState, type WorkbenchStateV5 } from "./workbench-state.js";
import {
  RepositoryWorkingTreeService,
  parseGitStatusPorcelainV2
} from "./repository-working-tree-service.js";
import type { RepositoryWorkingTreeGitRunner } from "./worktree-git-contract.js";

describe("Git status porcelain v2 parser", () => {
  it("projects ordinary, rename, unmerged, and untracked records without paths leaving Main", () => {
    const raw = [
      `1 M. N... 100644 100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} src/staged.ts`,
      `1 .D N... 100644 100644 000000 ${"c".repeat(40)} ${"0".repeat(40)} src/deleted.ts`,
      `2 R. N... 100644 100644 100644 ${"d".repeat(40)} ${"e".repeat(40)} R100 src/new.ts`,
      "src/old.ts",
      `u UU N... 100644 100644 100644 100644 ${"1".repeat(40)} ${"2".repeat(40)} ${"3".repeat(40)} src/conflict.ts`,
      "? docs/new file.md",
      ""
    ].join("\0");

    expect(parseGitStatusPorcelainV2(raw).changes).toEqual([
      {
        path: "docs/new file.md",
        kind: "untracked",
        staged: false,
        unstaged: true,
        conflicted: false
      },
      {
        path: "src/conflict.ts",
        kind: "conflict",
        staged: true,
        unstaged: true,
        conflicted: true
      },
      {
        path: "src/deleted.ts",
        kind: "deleted",
        staged: false,
        unstaged: true,
        conflicted: false
      },
      {
        path: "src/new.ts",
        previousPath: "src/old.ts",
        kind: "renamed",
        staged: true,
        unstaged: false,
        conflicted: false
      },
      {
        path: "src/staged.ts",
        kind: "modified",
        staged: true,
        unstaged: false,
        conflicted: false
      }
    ]);
  });

  it("rejects malformed or escaping status paths", () => {
    expect(() => parseGitStatusPorcelainV2("? ../secret\0"))
      .toThrow("outside the supported boundary");
    expect(() => parseGitStatusPorcelainV2("? C:\\secret.txt\0"))
      .toThrow("outside the supported boundary");
    expect(() => parseGitStatusPorcelainV2("2 R. incomplete\0old.ts\0"))
      .toThrow("incomplete");
    expect(() => parseGitStatusPorcelainV2("x unknown\0"))
      .toThrow("unsupported status record");
  });
});

describe("RepositoryWorkingTreeService", () => {
  it("fences opaque change identities by Workspace, revision, and status fingerprint", async () => {
    let state = workbenchFixture("/workspace-a");
    let status = `1 MM N... 100644 100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} src/current.ts\0`;
    const diffPath = vi.fn<RepositoryWorkingTreeGitRunner["diffPath"]>(
      async (_cwd, _path, mode) => `${mode} patch`
    );
    const runner = runnerFixture(() => status, { diffPath });
    const service = new RepositoryWorkingTreeService({
      runner,
      workbenchState: { load: async () => ({ state }) },
      now: () => 42
    });

    const snapshot = await service.inspect({ workspaceId: "workspace-a" });
    expect(snapshot).toMatchObject({
      workspaceId: "workspace-a",
      revision: 1,
      observedAt: 42,
      headSha: "a".repeat(40),
      changes: [{ displayPath: "src/current.ts", staged: true, unstaged: true }]
    });
    expect(snapshot.changes[0]?.changeId).toMatch(/^chg_[0-9a-f]{32}$/u);

    const detail = await service.detail({
      workspaceId: "workspace-a",
      revision: snapshot.revision,
      changeId: snapshot.changes[0]!.changeId
    });
    expect(detail).toMatchObject({
      stagedPatch: "staged patch",
      unstagedPatch: "unstaged patch",
      truncated: false
    });
    expect(detail.contentFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(diffPath).toHaveBeenNthCalledWith(1, "/workspace-a", "src/current.ts", "staged");
    expect(diffPath).toHaveBeenNthCalledWith(2, "/workspace-a", "src/current.ts", "unstaged");

    await expect(service.detail({
      workspaceId: "workspace-a",
      revision: snapshot.revision + 1,
      changeId: snapshot.changes[0]!.changeId
    })).rejects.toThrow("stale");
    await expect(service.detail({
      workspaceId: "workspace-a",
      revision: snapshot.revision,
      changeId: `chg_${"f".repeat(32)}`
    })).rejects.toThrow("stale or unknown");

    status = `? src/new.ts\0`;
    await expect(service.detail({
      workspaceId: "workspace-a",
      revision: snapshot.revision,
      changeId: snapshot.changes[0]!.changeId
    })).rejects.toThrow("Repository changed after the snapshot");

    status = `1 MM N... 100644 100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} src/current.ts\0`;
    state = workbenchFixture("/workspace-replaced");
    await expect(service.detail({
      workspaceId: "workspace-a",
      revision: snapshot.revision,
      changeId: snapshot.changes[0]!.changeId
    })).rejects.toThrow("Workspace identity changed");
  });

  it("drops authority on removal and shutdown", async () => {
    const runner = runnerFixture(() => "? new.ts\0");
    const service = new RepositoryWorkingTreeService({
      runner,
      workbenchState: { load: async () => ({ state: workbenchFixture("/workspace-a") }) }
    });
    await service.inspect({ workspaceId: "workspace-a" });
    expect(service.diagnostics()).toEqual({ cachedSnapshotCount: 1, disposed: false });
    service.removeWorkspace("workspace-a");
    expect(service.diagnostics()).toEqual({ cachedSnapshotCount: 0, disposed: false });
    service.dispose();
    expect(service.diagnostics()).toEqual({ cachedSnapshotCount: 0, disposed: true });
    await expect(service.inspect({ workspaceId: "workspace-a" })).rejects.toThrow("shutting down");
  });
});

function workbenchFixture(canonicalPath: string): WorkbenchStateV5 {
  return {
    ...createEmptyWorkbenchState(),
    workspaces: [{
      id: "workspace-a",
      displayName: "Workspace A",
      identity: { canonicalPath, assurance: "path-only" },
      trust: "trusted",
      trustProvenance: "restored",
      availability: "available"
    }],
    workspaceOrder: ["workspace-a"]
  };
}

function runnerFixture(
  status: () => string,
  overrides: Partial<RepositoryWorkingTreeGitRunner> = {}
): RepositoryWorkingTreeGitRunner {
  return {
    resolveRepositoryRoot: vi.fn(async (cwd: string) => cwd),
    resolveCommonDirectory: vi.fn(async (cwd: string) => `${cwd}/.git`),
    listWorktrees: vi.fn(async () => []),
    resolveHeadSha: vi.fn(async () => "a".repeat(40)),
    statusPorcelain: vi.fn(async () => status()),
    diffPath: vi.fn(async (_cwd, _path, mode) => `${mode} patch`),
    diagnostics: vi.fn(() => ({ activeProcessCount: 0, disposed: false })),
    dispose: vi.fn(),
    ...overrides
  };
}
