import { beforeEach, describe, expect, it } from "vitest";
import type { RepositoryChangeDetail, RepositoryWorkingTreeSnapshot } from "@pi67/domain";
import {
  repositoryChangeReviewed,
  repositoryChangeViewed,
  useRepositoryWorkingTreeStore
} from "./repository-working-tree-store.js";

describe("repository working tree store", () => {
  beforeEach(() => useRepositoryWorkingTreeStore.getState().reset());

  it("ignores stale list results across refreshes and Workspace switches", () => {
    const store = useRepositoryWorkingTreeStore.getState();
    const first = store.begin("workspace-a");
    const second = store.begin("workspace-a");
    expect(store.finish("workspace-a", first, snapshot("workspace-a", 1))).toBe(false);
    expect(store.finish("workspace-a", second, snapshot("workspace-a", 2))).toBe(true);
    expect(useRepositoryWorkingTreeStore.getState().snapshot?.revision).toBe(2);

    const switched = store.begin("workspace-b");
    expect(useRepositoryWorkingTreeStore.getState().snapshot).toBeUndefined();
    expect(store.finish("workspace-a", second, snapshot("workspace-a", 3))).toBe(false);
    expect(store.finish("workspace-b", switched, snapshot("workspace-b", 1))).toBe(true);
  });

  it("accepts detail only for the current opaque identity and records its exact fingerprint", () => {
    const store = useRepositoryWorkingTreeStore.getState();
    const request = store.begin("workspace-a");
    store.finish("workspace-a", request, snapshot("workspace-a", 7));
    expect(store.beginDetail("workspace-a", 7, changeId)).toBe(true);
    expect(store.finishDetail(detail("workspace-a", 6, changeId, "a".repeat(64)))).toBe(false);
    expect(store.finishDetail(detail("workspace-a", 7, `chg_${"b".repeat(32)}`, "a".repeat(64)))).toBe(false);

    const current = detail("workspace-a", 7, changeId, "c".repeat(64));
    expect(store.finishDetail(current)).toBe(true);
    const state = useRepositoryWorkingTreeStore.getState();
    expect(repositoryChangeViewed("workspace-a", current, state.viewedByWorkspace["workspace-a"])).toBe(true);
    expect(repositoryChangeViewed(
      "workspace-a",
      { ...current, contentFingerprint: "d".repeat(64) },
      state.viewedByWorkspace["workspace-a"]
    )).toBe(false);
    expect(repositoryChangeReviewed(
      "workspace-a",
      current,
      state.reviewedByWorkspace["workspace-a"]
    )).toBe(false);
    expect(store.markReviewed("workspace-a", current)).toBe(true);
    expect(repositoryChangeReviewed(
      "workspace-a",
      current,
      useRepositoryWorkingTreeStore.getState().reviewedByWorkspace["workspace-a"]
    )).toBe(true);
  });
});

const changeId = `chg_${"a".repeat(32)}`;

function snapshot(workspaceId: string, revision: number): RepositoryWorkingTreeSnapshot {
  return {
    workspaceId,
    revision,
    observedAt: revision,
    changes: [{
      changeId,
      displayPath: "src/current.ts",
      kind: "modified",
      staged: false,
      unstaged: true,
      conflicted: false
    }],
    truncated: false
  };
}

function detail(
  workspaceId: string,
  revision: number,
  id: string,
  contentFingerprint: string
): RepositoryChangeDetail {
  return {
    workspaceId,
    revision,
    changeId: id,
    contentFingerprint,
    unstagedPatch: "patch",
    truncated: false
  };
}
