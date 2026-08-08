import { beforeEach, describe, expect, it } from "vitest";
import type { RepositoryEnvironmentSnapshot } from "@pi67/protocol";
import {
  repositoryEnvironmentRecord,
  useRepositoryEnvironmentStore
} from "./repository-environment-store.js";

beforeEach(() => useRepositoryEnvironmentStore.getState().reset());

describe("repository environment store", () => {
  it("rejects stale responses and responses for another Workspace", () => {
    const store = useRepositoryEnvironmentStore.getState();
    const first = store.beginInspection("workspace-a");
    const second = useRepositoryEnvironmentStore.getState().beginInspection("workspace-a");

    expect(useRepositoryEnvironmentStore.getState().finishInspection(first, snapshot("workspace-a")))
      .toBe(false);
    expect(useRepositoryEnvironmentStore.getState().finishInspection(second, snapshot("workspace-b")))
      .toBe(false);
    expect(useRepositoryEnvironmentStore.getState().finishInspection(second, snapshot("workspace-a")))
      .toBe(true);
    expect(repositoryEnvironmentRecord("workspace-a").status).toBe("ready");
  });

  it("keeps the previous snapshot visible during refresh and transport failure", () => {
    const store = useRepositoryEnvironmentStore.getState();
    const first = store.beginInspection("workspace-a");
    store.finishInspection(first, snapshot("workspace-a"));
    const refresh = useRepositoryEnvironmentStore.getState().beginInspection("workspace-a");
    expect(repositoryEnvironmentRecord("workspace-a")).toMatchObject({
      status: "loading",
      snapshot: { workspaceId: "workspace-a" }
    });
    useRepositoryEnvironmentStore.getState().failInspection(refresh, "bridge unavailable");
    expect(repositoryEnvironmentRecord("workspace-a")).toMatchObject({
      status: "error",
      snapshot: { workspaceId: "workspace-a" },
      error: "bridge unavailable"
    });
  });
});

function snapshot(workspaceId: string): RepositoryEnvironmentSnapshot {
  return {
    workspaceId,
    status: "non-git",
    revision: 1,
    observedAt: 1,
    stale: false,
    worktrees: []
  };
}
