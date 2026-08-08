import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RepositoryEnvironmentSnapshot } from "@pi67/protocol";
import { WorktreeCatalogStore } from "./worktree-catalog-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WorktreeCatalogStore", () => {
  it("serializes concurrent projection replacements and never persists physical paths", async () => {
    const root = await userData();
    const store = new WorktreeCatalogStore(root);
    await Promise.all([
      store.replace("a".repeat(64), snapshot("workspace-a", 1)),
      store.replace("b".repeat(64), snapshot("workspace-b", 2))
    ]);

    await expect(store.load("workspace-a", "a".repeat(64)))
      .resolves.toMatchObject({ workspaceId: "workspace-a", revision: 1 });
    await expect(store.load("workspace-b", "b".repeat(64)))
      .resolves.toMatchObject({ workspaceId: "workspace-b", revision: 2 });
    const serialized = await readFile(store.requestedCatalogPath, "utf8");
    expect(serialized).not.toContain("/private/repository");
    expect(serialized).not.toContain("gitExecutable");
  });

  it("quarantines corrupt projection state and rebuilds after deletion", async () => {
    const root = await userData();
    const store = new WorktreeCatalogStore(root, { now: () => 10, createToken: () => "token" });
    await store.replace("a".repeat(64), snapshot("workspace-a", 1));
    await writeFile(store.requestedCatalogPath, "{broken", "utf8");

    await expect(store.load("workspace-a", "a".repeat(64))).resolves.toBeUndefined();
    expect((await readdir(join(root, "workbench"))).some((name) => name.includes("corrupt-10-token")))
      .toBe(true);

    await store.replace("a".repeat(64), snapshot("workspace-a", 2));
    await unlink(store.requestedCatalogPath);
    await expect(store.load("workspace-a", "a".repeat(64))).resolves.toBeUndefined();
    await store.replace("a".repeat(64), snapshot("workspace-a", 3));
    await expect(store.load("workspace-a", "a".repeat(64)))
      .resolves.toMatchObject({ revision: 3 });
  });

  it("does not reuse a projection after the Workspace physical identity changes", async () => {
    const root = await userData();
    const store = new WorktreeCatalogStore(root);
    await store.replace("a".repeat(64), snapshot("workspace-a", 1));
    await expect(store.load("workspace-a", "b".repeat(64))).resolves.toBeUndefined();
  });

  it("rejects invalid public observations and removes only an existing Workspace", async () => {
    const root = await userData();
    const store = new WorktreeCatalogStore(root);
    await expect(store.replace("invalid", snapshot("workspace-a", 1)))
      .rejects.toThrow("Worktree Catalog observation is invalid.");
    await expect(store.replace("a".repeat(64), {
      ...snapshot("workspace-a", 1),
      commonDir: "/secret"
    } as RepositoryEnvironmentSnapshot)).rejects.toThrow("Worktree Catalog observation is invalid.");

    await store.replace("a".repeat(64), snapshot("workspace-a", 1));
    await store.removeWorkspace("workspace-missing");
    await expect(store.load("workspace-a", "a".repeat(64))).resolves.toBeDefined();
    await store.removeWorkspace("workspace-a");
    await expect(store.load("workspace-a", "a".repeat(64))).resolves.toBeUndefined();
  });

  it("quarantines bounded but structurally invalid Catalog states", async () => {
    const root = await userData();
    let token = 0;
    const store = new WorktreeCatalogStore(root, {
      now: () => 20,
      createToken: () => `token-${token++}`
    });
    await store.replace("a".repeat(64), snapshot("workspace-a", 1));
    const validRecord = {
      workspaceId: "workspace-a",
      workspaceFingerprint: "a".repeat(64),
      snapshot: snapshot("workspace-a", 1)
    };
    const invalidStates: unknown[] = [
      [],
      { version: 2, observations: [] },
      { version: 1, observations: {} },
      { version: 1, observations: Array.from({ length: 101 }, () => validRecord) },
      { version: 1, observations: [null] },
      { version: 1, observations: [{ ...validRecord, unexpected: true }] },
      { version: 1, observations: [{ ...validRecord, workspaceFingerprint: "invalid" }] },
      {
        version: 1,
        observations: [{ ...validRecord, workspaceId: "workspace-other" }]
      },
      {
        version: 1,
        observations: [validRecord, { ...validRecord }]
      }
    ];

    for (const state of invalidStates) {
      await writeFile(store.requestedCatalogPath, `${JSON.stringify(state)}\n`, "utf8");
      await expect(store.load("workspace-a", "a".repeat(64))).resolves.toBeUndefined();
    }
    expect((await readdir(join(root, "workbench"))).filter((name) => name.includes("corrupt-20-")))
      .toHaveLength(invalidStates.length);
  });

  it("fails closed for a non-directory storage path and quarantines oversized or non-file state", async () => {
    const root = await userData();
    await writeFile(join(root, "workbench"), "not a directory", "utf8");
    const blocked = new WorktreeCatalogStore(root);
    await expect(blocked.load("workspace-a", "a".repeat(64)))
      .rejects.toThrow("Worktree Catalog storage path must be a real directory.");

    await rm(join(root, "workbench"));
    let token = 0;
    const store = new WorktreeCatalogStore(root, { createToken: () => `quarantine-${token++}` });
    await store.replace("a".repeat(64), snapshot("workspace-a", 1));
    await writeFile(store.requestedCatalogPath, "x".repeat(2 * 1024 * 1024 + 1), "utf8");
    await expect(store.load("workspace-a", "a".repeat(64))).resolves.toBeUndefined();

    await mkdir(store.requestedCatalogPath);
    await expect(store.load("workspace-a", "a".repeat(64))).resolves.toBeUndefined();
  });
});

function snapshot(workspaceId: string, revision: number): RepositoryEnvironmentSnapshot {
  return {
    workspaceId,
    status: "ready",
    revision,
    observedAt: 10,
    stale: false,
    repository: {
      repositoryGroupId: `repo_${revision.toString(16).padStart(32, "0")}`,
      assurance: "filesystem",
      currentWorktreeId: `wt_${revision.toString(16).padStart(32, "0")}`
    },
    worktrees: [{
      worktreeId: `wt_${revision.toString(16).padStart(32, "0")}`,
      workspaceId,
      kind: "primary",
      status: "ready",
      headSha: "a".repeat(40),
      detached: false,
      locked: false
    }]
  };
}

async function userData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-worktree-catalog-"));
  roots.push(root);
  return root;
}
