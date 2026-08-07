import type { SessionTreeProjection } from "@pi67/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  selectCommittedSessionTreeProjection,
  useSessionTreeStore
} from "./session-tree-store.js";
import type { SessionProjectionAuthorityState } from "../session/session-projection-store.js";

const AUTHORITY = {
  hostEpoch: 7,
  sessionId: "session-1",
  sessionFileIdentity: "session-file-1",
  sessionGeneration: 3,
  projectionRevision: 1
};
const CANONICAL: SessionProjectionAuthorityState = { phase: "active", ...AUTHORITY };

describe("session tree store", () => {
  beforeEach(() => {
    useSessionTreeStore.setState(useSessionTreeStore.getInitialState(), true);
  });

  it("keeps the exact canonical authority after a response snapshot", () => {
    const store = useSessionTreeStore.getState();
    store.replaceProjection(AUTHORITY, tree("snapshot"));

    expect(store.markChanged(AUTHORITY)).toBe(true);
    expect(useSessionTreeStore.getState()).toMatchObject({
      authority: AUTHORITY,
      status: "stale"
    });
    expect(useSessionTreeStore.getState().beginRefresh(CANONICAL)).toMatchObject(AUTHORITY);
  });

  it("rejects stale Host, Session, and generation changes", () => {
    useSessionTreeStore.getState().replaceProjection(AUTHORITY, tree("current"));

    expect(useSessionTreeStore.getState().markChanged({ ...AUTHORITY, hostEpoch: 8 })).toBe(false);
    expect(useSessionTreeStore.getState().markChanged({ ...AUTHORITY, sessionId: "session-old" })).toBe(false);
    expect(useSessionTreeStore.getState().markChanged({ ...AUTHORITY, sessionGeneration: 2 })).toBe(false);
    expect(useSessionTreeStore.getState().markChanged({ ...AUTHORITY, projectionRevision: 2 })).toBe(false);
    expect(useSessionTreeStore.getState()).toMatchObject({
      tree: tree("current"),
      status: "ready"
    });
  });

  it("discards a delayed response after the projection is replaced", () => {
    const store = useSessionTreeStore.getState();
    store.replaceProjection(AUTHORITY, tree("old"));
    store.markChanged(AUTHORITY);
    const target = store.beginRefresh(CANONICAL);
    if (!target) throw new Error("Expected a Session Tree refresh target.");

    store.replaceProjection({ ...AUTHORITY, sessionId: "session-2", sessionGeneration: 4 }, tree("new"));

    expect(store.finishRefresh(target, tree("delayed"))).toBe("discarded");
    expect(useSessionTreeStore.getState()).toMatchObject({
      authority: { sessionId: "session-2", sessionGeneration: 4 },
      tree: tree("new"),
      status: "ready"
    });
  });

  it("keeps a projection stale when another change arrives during refresh", () => {
    const store = useSessionTreeStore.getState();
    store.replaceProjection(AUTHORITY, tree("old"));
    store.markChanged(AUTHORITY);
    const target = store.beginRefresh(CANONICAL);
    if (!target) throw new Error("Expected a Session Tree refresh target.");
    store.markChanged(AUTHORITY);

    expect(store.finishRefresh(target, tree("intermediate"))).toBe("superseded");
    expect(useSessionTreeStore.getState()).toMatchObject({
      tree: tree("intermediate"),
      status: "stale"
    });
    expect(useSessionTreeStore.getState().needsRefresh(CANONICAL)).toBe(true);
  });

  it("keeps the invalidation pending when a refresh is deferred", () => {
    const store = useSessionTreeStore.getState();
    store.replaceProjection(AUTHORITY, tree("current"));
    store.markChanged(AUTHORITY);
    const target = store.beginRefresh(CANONICAL);
    if (!target) throw new Error("Expected a Session Tree refresh target.");

    expect(store.deferRefresh(target)).toBe(true);
    expect(useSessionTreeStore.getState()).toMatchObject({
      status: "stale",
      changeRevision: 1,
      refreshedChangeRevision: 0
    });
    expect(useSessionTreeStore.getState().needsRefresh(CANONICAL)).toBe(true);
  });

  it("hides staged trees until canonical authority commits and on every mismatch", () => {
    useSessionTreeStore.getState().replaceProjection(AUTHORITY, tree("staged"));
    const state = useSessionTreeStore.getState();

    expect(selectCommittedSessionTreeProjection(state, {
      phase: "inactive",
      projectionRevision: AUTHORITY.projectionRevision
    })).toMatchObject({ tree: { nodes: [] }, status: "stale" });
    for (const stale of [
      { ...AUTHORITY, hostEpoch: 8 },
      { ...AUTHORITY, sessionId: "session-2" },
      { ...AUTHORITY, sessionGeneration: 4 },
      { ...AUTHORITY, projectionRevision: 2 }
    ]) {
      expect(selectCommittedSessionTreeProjection(state, { phase: "active", ...stale }).tree.nodes)
        .toEqual([]);
    }
    expect(selectCommittedSessionTreeProjection(state, CANONICAL).tree).toEqual(tree("staged"));
  });
});

function tree(preview: string): SessionTreeProjection {
  return {
    nodes: [{
      id: `entry-${preview}`,
      parentId: null,
      type: "message",
      preview,
      active: true,
      depth: 0
    }],
    truncated: false,
    total: 1
  };
}
