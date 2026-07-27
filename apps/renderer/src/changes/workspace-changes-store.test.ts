import {
  MAX_WORKSPACE_CHANGES,
  type WorkspaceChangesProjection,
  type WorkspaceChangeView
} from "@pi67/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  selectCommittedWorkspaceChangesProjection,
  useWorkspaceChangesStore,
  type WorkspaceChangesAuthority
} from "./workspace-changes-store.js";
import type { SessionProjectionAuthorityState } from "../session/session-projection-store.js";

const AUTHORITY: WorkspaceChangesAuthority = {
  hostEpoch: 7,
  sessionId: "session-1",
  sessionGeneration: 3,
  projectionRevision: 1
};
const CANONICAL: SessionProjectionAuthorityState = { phase: "active", ...AUTHORITY };

describe("workspace changes store", () => {
  beforeEach(() => {
    useWorkspaceChangesStore.setState(useWorkspaceChangesStore.getInitialState(), true);
  });

  it("keeps the canonical projection and indexed Tool lookup in sync", () => {
    const store = useWorkspaceChangesStore.getState();
    store.beginSession(AUTHORITY);
    expect(store.applyChange(AUTHORITY, change("tool-1", "running"))).toBe(true);
    expect(store.applyChange(AUTHORITY, change("tool-1", "completed"))).toBe(true);

    const state = useWorkspaceChangesStore.getState();
    expect(state.projection).toMatchObject({ sessionId: "session-1", total: 1 });
    expect(state.byToolCallId.get("tool-1")).toMatchObject({ status: "completed" });
  });

  it("keeps the projection and index bounded together", () => {
    const store = useWorkspaceChangesStore.getState();
    store.beginSession(AUTHORITY);
    for (let index = 0; index < MAX_WORKSPACE_CHANGES + 3; index += 1) {
      store.applyChange(AUTHORITY, change(`tool-${index}`, "completed"));
    }

    const state = useWorkspaceChangesStore.getState();
    expect(state.projection?.items).toHaveLength(MAX_WORKSPACE_CHANGES);
    expect(state.byToolCallId.size).toBe(MAX_WORKSPACE_CHANGES);
    expect(state.byToolCallId.has("tool-0")).toBe(false);
    expect(state.byToolCallId.has(`tool-${MAX_WORKSPACE_CHANGES + 2}`)).toBe(true);
  });

  it("rejects live changes from another Host, Session, or generation", () => {
    const store = useWorkspaceChangesStore.getState();
    store.beginSession(AUTHORITY);

    expect(store.applyChange({ ...AUTHORITY, hostEpoch: 8 }, change("host", "running"))).toBe(false);
    expect(store.applyChange({ ...AUTHORITY, sessionId: "session-2" }, change("session", "running"))).toBe(false);
    expect(store.applyChange({ ...AUTHORITY, sessionGeneration: 4 }, change("generation", "running"))).toBe(false);
    expect(store.applyChange({ ...AUTHORITY, projectionRevision: 2 }, change("revision", "running"))).toBe(false);
    expect(useWorkspaceChangesStore.getState().projection).toBeUndefined();
  });

  it("invalidates pending refresh completion when the Session changes", () => {
    const store = useWorkspaceChangesStore.getState();
    store.beginSession(AUTHORITY);
    const target = store.beginRefresh(CANONICAL);
    expect(target).toBeDefined();

    store.beginSession({ ...AUTHORITY, sessionId: "session-2", sessionGeneration: 4 });
    expect(store.finishRefresh(target!, projection("session-1", [change("old", "completed")]))).toBe(false);
    expect(useWorkspaceChangesStore.getState()).toMatchObject({
      authority: { sessionId: "session-2" },
      projection: undefined,
      status: "stale"
    });
  });

  it("keeps activation idempotent for the same Session authority", () => {
    const store = useWorkspaceChangesStore.getState();
    store.beginSession(AUTHORITY);
    store.applyChange(AUTHORITY, change("tool-1", "completed"));
    const revision = useWorkspaceChangesStore.getState().contentRevision;

    store.beginSession(AUTHORITY);

    expect(useWorkspaceChangesStore.getState().contentRevision).toBe(revision);
    expect(useWorkspaceChangesStore.getState().byToolCallId.has("tool-1")).toBe(true);
  });

  it("replaces live state with an authoritative resync projection", () => {
    const store = useWorkspaceChangesStore.getState();
    store.beginSession(AUTHORITY);
    store.applyChange(AUTHORITY, change("live", "running"));

    const resynced = projection("session-1", [change("resynced", "completed")]);
    expect(store.installProjection(AUTHORITY, resynced)).toBe(true);
    expect(useWorkspaceChangesStore.getState().projection).toEqual(resynced);
    expect(useWorkspaceChangesStore.getState().byToolCallId.has("live")).toBe(false);
    expect(useWorkspaceChangesStore.getState().byToolCallId.has("resynced")).toBe(true);
  });

  it("keeps a current refresh failure stale but ignores a failure after reset", () => {
    const store = useWorkspaceChangesStore.getState();
    store.beginSession(AUTHORITY);
    const current = store.beginRefresh(CANONICAL)!;
    expect(store.failRefresh(current)).toBe(true);
    expect(useWorkspaceChangesStore.getState().status).toBe("stale");

    const obsolete = store.beginRefresh(CANONICAL)!;
    store.reset("stale");
    expect(store.failRefresh(obsolete)).toBe(false);
    expect(useWorkspaceChangesStore.getState().status).toBe("stale");
  });

  it("hides staged changes until canonical authority commits and on every mismatch", () => {
    const staged = projection("session-1", [change("staged", "completed")]);
    useWorkspaceChangesStore.getState().installProjection(AUTHORITY, staged);
    const state = useWorkspaceChangesStore.getState();

    expect(selectCommittedWorkspaceChangesProjection(state, {
      phase: "inactive",
      projectionRevision: AUTHORITY.projectionRevision
    }).projection).toBeUndefined();
    for (const stale of [
      { ...AUTHORITY, hostEpoch: 8 },
      { ...AUTHORITY, sessionId: "session-2" },
      { ...AUTHORITY, sessionGeneration: 4 },
      { ...AUTHORITY, projectionRevision: 2 }
    ]) {
      expect(selectCommittedWorkspaceChangesProjection(state, { phase: "active", ...stale }).projection)
        .toBeUndefined();
    }
    expect(selectCommittedWorkspaceChangesProjection(state, CANONICAL).projection).toEqual(staged);
  });
});

function change(toolCallId: string, status: WorkspaceChangeView["status"]): WorkspaceChangeView {
  return {
    toolCallId,
    kind: "edit",
    path: `src/${toolCallId}.ts`,
    pathTruncated: false,
    status,
    patchTruncated: false
  };
}

function projection(
  sessionId: string,
  items: WorkspaceChangeView[]
): WorkspaceChangesProjection {
  return { sessionId, items, truncated: false, total: items.length };
}
