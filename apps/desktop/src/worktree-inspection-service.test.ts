import { describe, expect, it } from "vitest";
import {
  GitInspectionError,
  type GitWorktreeRecord,
  type RepositoryReadOnlyGitRunner
} from "./worktree-git-runner.js";
import { WorktreeInspectionService } from "./worktree-inspection-service.js";
import {
  identity,
  identityObserver,
  MemoryCatalog,
  readySnapshot,
  runner,
  workbench,
  workspace,
  worktree
} from "./worktree-inspection-service-test-fixture.js";

describe("WorktreeInspectionService", () => {
  it("groups primary and linked Workspaces by common-dir identity", async () => {
    const primary = workspace("workspace-primary", "/repo");
    const linked = workspace("workspace-linked", "/repo-task");
    const catalog = new MemoryCatalog();
    const workbenchState = workbench([primary, linked]);
    const service = new WorktreeInspectionService({
      runner: runner({
        root: "/repo",
        commonDirectory: "/repo/.git",
        records: [
          worktree("/repo", "a", "main"),
          worktree("/repo-task", "b", "feature/task")
        ]
      }),
      workbenchState,
      catalog,
      now: () => 20,
      observeIdentity: identityObserver({
        "/repo": identity("/repo", "10"),
        "/repo-task": identity("/repo-task", "11"),
        "/repo/.git": identity("/repo/.git", "12")
      })
    });

    const primarySnapshot = await service.inspect({ workspaceId: primary.id });
    const linkedSnapshot = await service.inspect({ workspaceId: linked.id });

    expect(primarySnapshot).toMatchObject({
      status: "ready",
      revision: 1,
      repository: { assurance: "filesystem" },
      worktrees: [
        { workspaceId: primary.id, kind: "primary", branchName: "main" },
        { workspaceId: linked.id, kind: "linked", branchName: "feature/task" }
      ]
    });
    expect(linkedSnapshot.repository?.repositoryGroupId)
      .toBe(primarySnapshot.repository?.repositoryGroupId);
    expect(linkedSnapshot.repository?.currentWorktreeId)
      .toBe(linkedSnapshot.worktrees[1]?.worktreeId);
    await expect(workbenchState.load()).resolves.toMatchObject({
      state: {
        workspaceEnvironments: [
          {
            workspaceId: primary.id,
            kind: "repository-primary",
            ownership: "user",
            repositoryGroupId: primarySnapshot.repository?.repositoryGroupId
          },
          {
            workspaceId: linked.id,
            kind: "repository-worktree",
            ownership: "user",
            repositoryGroupId: primarySnapshot.repository?.repositoryGroupId
          }
        ]
      }
    });
    expect(JSON.stringify(primarySnapshot)).not.toContain("/repo");
  });

  it("returns a typed non-Git state without blocking the Workspace or Session path", async () => {
    const service = new WorktreeInspectionService({
      runner: runner({ rootError: new GitInspectionError("repository-root", "not-a-repository") }),
      workbenchState: workbench([workspace("workspace-a", "/plain")]),
      catalog: new MemoryCatalog(),
      now: () => 30,
      observeIdentity: identityObserver({})
    });

    await expect(service.inspect({ workspaceId: "workspace-a" })).resolves.toEqual({
      workspaceId: "workspace-a",
      status: "non-git",
      revision: 1,
      observedAt: 30,
      stale: false,
      worktrees: []
    });
  });

  it("preserves the last usable projection as stale after a bounded Git timeout", async () => {
    const cached = readySnapshot("workspace-a");
    const catalog = new MemoryCatalog(cached);
    const service = new WorktreeInspectionService({
      runner: runner({ rootError: new GitInspectionError("repository-root", "timeout") }),
      workbenchState: workbench([workspace("workspace-a", "/repo")]),
      catalog,
      now: () => 40,
      observeIdentity: identityObserver({})
    });

    await expect(service.inspect({ workspaceId: "workspace-a" })).resolves.toMatchObject({
      status: "ready",
      revision: 4,
      stale: true,
      error: { stage: "repository-root", code: "timeout", recoverable: true }
    });
  });

  it("serializes one Workspace while allowing another Workspace to finish independently", async () => {
    let releaseA: (() => void) | undefined;
    let rootCalls = 0;
    const waitA = new Promise<void>((resolvePromise) => { releaseA = resolvePromise; });
    const git: RepositoryReadOnlyGitRunner = {
      async resolveRepositoryRoot(cwd) {
        rootCalls += 1;
        if (cwd === "/repo-a") await waitA;
        return cwd;
      },
      async resolveCommonDirectory(cwd) { return `${cwd}/.git`; },
      async listWorktrees(cwd) { return [worktree(cwd, cwd.endsWith("a") ? "a" : "b", "main")]; },
      dispose() {}
    };
    const service = new WorktreeInspectionService({
      runner: git,
      workbenchState: workbench([
        workspace("workspace-a", "/repo-a"),
        workspace("workspace-b", "/repo-b")
      ]),
      catalog: new MemoryCatalog(),
      observeIdentity: async (path) => identity(path, path.includes("repo-a") ? "1" : "2")
    });

    const firstA = service.inspect({ workspaceId: "workspace-a" });
    const secondA = service.inspect({ workspaceId: "workspace-a" });
    expect(secondA).toBe(firstA);
    await expect(service.inspect({ workspaceId: "workspace-b" }))
      .resolves.toMatchObject({ status: "ready", workspaceId: "workspace-b" });
    releaseA?.();
    await expect(firstA).resolves.toMatchObject({ status: "ready", workspaceId: "workspace-a" });
    expect(rootCalls).toBe(3);
  });

  it("coalesces refreshes to one latest pass instead of returning only the active observation", async () => {
    let releaseFirst: (() => void) | undefined;
    let rootCalls = 0;
    const firstPass = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const service = new WorktreeInspectionService({
      runner: {
        async resolveRepositoryRoot(cwd) {
          rootCalls += 1;
          if (rootCalls === 1) await firstPass;
          return cwd;
        },
        async resolveCommonDirectory(cwd) { return `${cwd}/.git`; },
        async listWorktrees(cwd) { return [worktree(cwd, rootCalls === 1 ? "a" : "b", "main")]; },
        dispose() {}
      },
      workbenchState: workbench([workspace("workspace-a", "/repo")]),
      catalog: new MemoryCatalog(),
      now: () => rootCalls,
      observeIdentity: async (path) => identity(path, path.endsWith(".git") ? "2" : "1")
    });

    const active = service.inspect({ workspaceId: "workspace-a" });
    const latest = service.inspect({ workspaceId: "workspace-a" });
    expect(latest).toBe(active);
    releaseFirst?.();

    await expect(latest).resolves.toMatchObject({
      observedAt: 2,
      worktrees: [{ headSha: "b".repeat(40) }]
    });
    expect(rootCalls).toBe(2);
  });

  it("does not commit an inspection after the registered Workspace identity changes", async () => {
    let releaseRoot: (() => void) | undefined;
    const rootReady = new Promise<void>((resolve) => { releaseRoot = resolve; });
    const state = workbench([workspace("workspace-a", "/repo-old")]);
    const catalog = new MemoryCatalog();
    const service = new WorktreeInspectionService({
      runner: {
        async resolveRepositoryRoot(cwd) { await rootReady; return cwd; },
        async resolveCommonDirectory() { return "/repo-old/.git"; },
        async listWorktrees() { return [worktree("/repo-old", "a", "main")]; },
        dispose() {}
      },
      workbenchState: state,
      catalog,
      observeIdentity: async (path) => identity(path, path.endsWith(".git") ? "2" : "1")
    });

    const inspection = service.inspect({ workspaceId: "workspace-a" });
    await state.update((current) => ({
      ...current,
      workspaces: [workspace("workspace-a", "/repo-new")]
    }));
    releaseRoot?.();

    await expect(inspection).resolves.toMatchObject({
      status: "missing",
      error: { stage: "workspace", code: "workspace-unavailable" }
    });
    await expect(catalog.load("workspace-a", "unused")).resolves.toBeUndefined();
  });

  it("drains active inspections within a bounded shutdown deadline", async () => {
    let releaseRoot: (() => void) | undefined;
    const rootReady = new Promise<void>((resolve) => { releaseRoot = resolve; });
    const service = new WorktreeInspectionService({
      runner: {
        async resolveRepositoryRoot(cwd) { await rootReady; return cwd; },
        async resolveCommonDirectory(cwd) { return `${cwd}/.git`; },
        async listWorktrees(cwd) { return [worktree(cwd, "a", "main")]; },
        dispose() {}
      },
      workbenchState: workbench([workspace("workspace-a", "/repo")]),
      catalog: new MemoryCatalog(),
      observeIdentity: async (path) => identity(path, path.endsWith(".git") ? "2" : "1")
    });

    const inspection = service.inspect({ workspaceId: "workspace-a" });
    const draining = service.drain("workspace-a", 1_000);
    releaseRoot?.();
    await draining;
    await expect(inspection).resolves.toMatchObject({ status: "ready" });
    await expect(service.drain("workspace-a", -1)).rejects.toThrow(/deadline/u);
  });

  it("marks a missing registered Worktree without returning its path", async () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const service = new WorktreeInspectionService({
      runner: runner({
        root: "/repo",
        commonDirectory: "/repo/.git",
        records: [worktree("/repo", "a", "main"), worktree("/unavailable-wt", "b", "feature/gone")]
      }),
      workbenchState: workbench([workspace("workspace-a", "/repo")]),
      catalog: new MemoryCatalog(),
      observeIdentity: async (path) => {
        if (path === "/unavailable-wt") throw missing;
        return identity(path, path === "/repo/.git" ? "3" : "1");
      }
    });

    const snapshot = await service.inspect({ workspaceId: "workspace-a" });
    expect(snapshot.worktrees[1]).toMatchObject({ kind: "linked", status: "missing" });
    expect(JSON.stringify(snapshot)).not.toContain("/unavailable-wt");
  });

  it("returns typed missing and unknown-Workspace states without invoking Git", async () => {
    let disposed = false;
    const git = runner({});
    git.dispose = () => { disposed = true; };
    const catalog = new MemoryCatalog(readySnapshot("workspace-missing"));
    const service = new WorktreeInspectionService({
      runner: git,
      workbenchState: workbench([{
        ...workspace("workspace-missing", "/missing"),
        availability: "missing"
      }]),
      catalog,
      now: () => 50,
      observeIdentity: identityObserver({})
    });

    await expect(service.inspect({ workspaceId: "workspace-unknown" })).resolves.toMatchObject({
      status: "error",
      error: { stage: "workspace", code: "workspace-not-found", recoverable: false }
    });
    await expect(service.inspect({ workspaceId: "workspace-missing" })).resolves.toMatchObject({
      status: "missing",
      error: { stage: "workspace", code: "workspace-unavailable", recoverable: true }
    });
    await service.removeWorkspace("workspace-missing");
    service.dispose();
    expect(disposed).toBe(true);
  });

  it("keeps live Git authority when Catalog reads or writes fail", async () => {
    const git = runner({ root: "/repo", records: [worktree("/repo", "a", "main")] });
    const identities = identityObserver({
      "/repo": identity("/repo", "1"),
      "/repo/.git": identity("/repo/.git", "2")
    });
    const readFailure = new WorktreeInspectionService({
      runner: git,
      workbenchState: workbench([workspace("workspace-a", "/repo")]),
      catalog: {
        async load() { throw new Error("catalog unavailable"); },
        async replace() {},
        async removeWorkspace() {}
      },
      observeIdentity: identities
    });
    await expect(readFailure.inspect({ workspaceId: "workspace-a" })).resolves.toMatchObject({
      status: "ready",
      error: { stage: "catalog", code: "catalog-unavailable" }
    });

    const writeFailure = new WorktreeInspectionService({
      runner: git,
      workbenchState: workbench([workspace("workspace-a", "/repo")]),
      catalog: {
        async load() { return undefined; },
        async replace() { throw new Error("catalog unavailable"); },
        async removeWorkspace() {}
      },
      observeIdentity: identities
    });
    await expect(writeFailure.inspect({ workspaceId: "workspace-a" })).resolves.toMatchObject({
      status: "ready",
      error: { stage: "catalog", code: "catalog-unavailable" }
    });
  });

  it("keeps live Git authority visible when the durable environment binding cannot be saved", async () => {
    const base = workbench([workspace("workspace-a", "/repo")]);
    const service = new WorktreeInspectionService({
      runner: runner({ root: "/repo", records: [worktree("/repo", "a", "main")] }),
      workbenchState: {
        load: () => base.load(),
        async update() { throw new Error("state unavailable"); }
      },
      catalog: new MemoryCatalog(),
      observeIdentity: identityObserver({
        "/repo": identity("/repo", "1"),
        "/repo/.git": identity("/repo/.git", "2")
      })
    });

    await expect(service.inspect({ workspaceId: "workspace-a" })).resolves.toMatchObject({
      status: "ready",
      error: { stage: "state", code: "state-unavailable", recoverable: true }
    });
  });

  it("maps toolchain, cancellation, invalid output, and identity failures without guessing", async () => {
    const cases = [
      {
        error: new GitInspectionError("repository-root", "toolchain-unavailable"),
        status: "toolchain-unavailable",
        code: "toolchain-unavailable",
        recoverable: true
      },
      {
        error: new GitInspectionError("common-dir", "cancelled"),
        status: "error",
        code: "unknown",
        recoverable: true
      },
      {
        error: new GitInspectionError("worktree-list", "invalid-output"),
        status: "error",
        code: "invalid-output",
        recoverable: false
      },
      {
        error: new Error("identity failed"),
        status: "error",
        code: "identity-unavailable",
        recoverable: true
      }
    ] as const;

    for (const item of cases) {
      const service = new WorktreeInspectionService({
        runner: runner({ rootError: item.error }),
        workbenchState: workbench([workspace("workspace-a", "/repo")]),
        catalog: new MemoryCatalog(),
        observeIdentity: identityObserver({})
      });
      await expect(service.inspect({ workspaceId: "workspace-a" })).resolves.toMatchObject({
        status: item.status,
        error: { code: item.code, recoverable: item.recoverable }
      });
    }
  });

  it("projects prunable detached records without inventing optional Git facts", async () => {
    const primary = {
      path: "/repo",
      detached: true,
      locked: true,
      prunable: true
    } satisfies GitWorktreeRecord;
    const linked = {
      path: "/linked",
      detached: false,
      locked: false,
      prunable: false
    } satisfies GitWorktreeRecord;
    const service = new WorktreeInspectionService({
      runner: runner({
        root: "/repo",
        commonDirectory: "/repo/.git",
        records: [primary, linked]
      }),
      workbenchState: workbench([workspace("workspace-a", "/repo")]),
      catalog: new MemoryCatalog(),
      platform: "win32",
      observeIdentity: async (path) => ({ canonicalPath: path.toUpperCase(), assurance: "path-only" })
    });

    await expect(service.inspect({ workspaceId: "workspace-a" })).resolves.toMatchObject({
      status: "ready",
      repository: { assurance: "path-only" },
      worktrees: [
        { workspaceId: "workspace-a", status: "prunable", detached: true, locked: true },
        { kind: "linked", status: "ready", detached: false, locked: false }
      ]
    });
  });
});
