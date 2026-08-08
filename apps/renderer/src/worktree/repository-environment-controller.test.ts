import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepositoryEnvironmentSnapshot } from "@pi67/protocol";
import { inspectRepositoryEnvironment } from "./repository-environment-controller.js";
import { repositoryEnvironmentRecord, useRepositoryEnvironmentStore } from "./repository-environment-store.js";

beforeEach(() => {
  useRepositoryEnvironmentStore.getState().reset();
});

describe("repository environment controller", () => {
  it("single-flights duplicate inspection requests", async () => {
    let resolveInspection: ((snapshot: RepositoryEnvironmentSnapshot) => void) | undefined;
    const inspect = vi.fn(() => new Promise<RepositoryEnvironmentSnapshot>((resolvePromise) => {
      resolveInspection = resolvePromise;
    }));
    installWindow(inspect);

    const first = inspectRepositoryEnvironment("workspace-a");
    const second = inspectRepositoryEnvironment("workspace-a");
    expect(second).toBe(first);
    resolveInspection?.(snapshot());
    await first;

    expect(inspect).toHaveBeenCalledOnce();
    expect(repositoryEnvironmentRecord("workspace-a").status).toBe("ready");
  });

  it("keeps bridge failures local to the repository status", async () => {
    installWindow(vi.fn(async () => { throw new Error("private Git unavailable"); }));
    await inspectRepositoryEnvironment("workspace-a");
    expect(repositoryEnvironmentRecord("workspace-a")).toMatchObject({
      status: "error",
      error: "private Git unavailable"
    });
  });
});

function installWindow(inspect: (request: { workspaceId: string }) => Promise<RepositoryEnvironmentSnapshot>) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { pi67: { system: { inspectRepositoryEnvironment: inspect } } }
  });
}

function snapshot(): RepositoryEnvironmentSnapshot {
  return {
    workspaceId: "workspace-a",
    status: "non-git",
    revision: 1,
    observedAt: 1,
    stale: false,
    worktrees: []
  };
}
