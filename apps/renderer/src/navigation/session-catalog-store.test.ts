import type { SessionCatalogPage, SessionSummary } from "@pi67/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  selectConversationSessionSummary,
  selectWorkspaceSessionCatalog,
  useSessionCatalogStore
} from "./session-catalog-store.js";

const SESSION_ONE: SessionSummary = {
  id: "session-1",
  path: "/sessions/one.jsonl",
  cwd: "/work",
  name: "Session one",
  nameSource: "explicit",
  modifiedAt: 20,
  messageCount: 2
};

const SESSION_TWO: SessionSummary = {
  id: "session-2",
  path: "/sessions/two.jsonl",
  cwd: "/work",
  name: "Session two",
  nameSource: "explicit",
  modifiedAt: 10,
  messageCount: 4
};
const QUERY_KEY = "0".repeat(64);
const WORKSPACE_ID = "workspace-a";

describe("session catalog store", () => {
  beforeEach(() => {
    useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
  });

  it("normalizes and installs a first-page projection", () => {
    const store = useSessionCatalogStore.getState();
    const target = store.beginFirstPage(WORKSPACE_ID, { query: " session " });
    expect(store.finishFirstPage(target, page([SESSION_ONE]))).toBe(true);

    expect(catalog()).toMatchObject({
      items: [SESSION_ONE],
      total: 1,
      revision: 1,
      query: "session",
      loading: false
    });
  });

  it("keeps loading, rows, and pagination independent for each Workspace", () => {
    const store = useSessionCatalogStore.getState();
    const workspaceA = store.beginFirstPage("workspace-a");
    const workspaceB = store.beginFirstPage("workspace-b", { query: "two" });
    expect(store.finishFirstPage(workspaceA, page([SESSION_ONE]))).toBe(true);
    expect(store.finishFirstPage(workspaceB, page([SESSION_TWO]))).toBe(true);

    expect(selectWorkspaceSessionCatalog(useSessionCatalogStore.getState(), "workspace-a")).toMatchObject({
      items: [SESSION_ONE],
      query: ""
    });
    expect(selectWorkspaceSessionCatalog(useSessionCatalogStore.getState(), "workspace-b")).toMatchObject({
      items: [SESSION_TWO],
      query: "two"
    });
  });

  it("resolves the selected persisted conversation from its Workspace catalog", () => {
    const store = useSessionCatalogStore.getState();
    store.finishFirstPage(store.beginFirstPage(WORKSPACE_ID), page([SESSION_ONE]));

    expect(selectConversationSessionSummary(useSessionCatalogStore.getState(), {
      kind: "session",
      workspaceId: WORKSPACE_ID,
      sessionPath: SESSION_ONE.path
    })).toEqual(SESSION_ONE);
    expect(selectConversationSessionSummary(useSessionCatalogStore.getState(), {
      kind: "provisional",
      workspaceId: WORKSPACE_ID,
      draftId: "draft-1"
    })).toBeUndefined();
  });

  it("appends a keyset page without duplicating paths", () => {
    const first = page([SESSION_ONE], {
      total: 2,
      hasMore: true,
      nextCursor: { revision: 1, queryKey: QUERY_KEY, modifiedAt: 20, path: SESSION_ONE.path }
    });
    const second = page([SESSION_ONE, SESSION_TWO], { total: 2 });
    const store = useSessionCatalogStore.getState();
    store.finishFirstPage(store.beginFirstPage(WORKSPACE_ID), first);
    const nextTarget = store.beginNextPage(WORKSPACE_ID);
    expect(nextTarget).toBeDefined();
    expect(store.finishNextPage(nextTarget!, second)).toBe(true);

    expect(catalog().items).toEqual([SESSION_ONE, SESSION_TWO]);
    expect(catalog().hasMore).toBe(false);
  });

  it("clears loaded pages and invalidates pending requests when status revision changes", () => {
    const store = useSessionCatalogStore.getState();
    store.finishFirstPage(store.beginFirstPage(WORKSPACE_ID), page([SESSION_ONE]));
    const pending = store.beginFirstPage(WORKSPACE_ID);

    store.applyStatus(WORKSPACE_ID, {
      revision: 2,
      itemCount: 2,
      source: "sqlite",
      state: "ready",
      rebuilding: false,
      reconciledAt: 30,
      incomplete: false,
      skippedCount: 0
    });

    expect(catalog()).toMatchObject({
      items: [],
      total: 0,
      revision: 2,
      loading: false,
      incomplete: false,
      skippedCount: 0,
      itemCount: 2,
      reconciledAt: 30
    });
    expect(store.finishFirstPage(pending, page([SESSION_TWO]))).toBe(false);
    expect(catalog().items).toEqual([]);
  });

  it("retains incomplete status and clears it on reset", () => {
    useSessionCatalogStore.getState().applyStatus(WORKSPACE_ID, {
      revision: 3,
      itemCount: 8,
      source: "sdk-fallback",
      state: "fallback",
      rebuilding: false,
      degradedReason: "runtime-query",
      reconciledAt: 40,
      incomplete: true,
      skippedCount: 2
    });
    expect(catalog()).toMatchObject({
      catalogState: "fallback",
      source: "sdk-fallback",
      degradedReason: "runtime-query",
      incomplete: true,
      skippedCount: 2,
      itemCount: 8,
      reconciledAt: 40
    });

    useSessionCatalogStore.getState().reset(WORKSPACE_ID);
    expect(catalog()).toMatchObject({
      incomplete: false,
      skippedCount: 0,
      itemCount: 0,
      degradedReason: undefined,
      reconciledAt: undefined
    });
  });

  it("does not present old rows as results for a failed new search", () => {
    const store = useSessionCatalogStore.getState();
    store.finishFirstPage(store.beginFirstPage(WORKSPACE_ID, { query: "old" }), page([SESSION_ONE]));
    const target = store.beginFirstPage(WORKSPACE_ID, { query: "new" });
    expect(store.failFirstPage(target, "catalog unavailable")).toBe(true);

    expect(catalog()).toMatchObject({
      query: "new",
      items: [],
      total: 0,
      loading: false,
      error: "catalog unavailable"
    });
  });

  it("invalidates changed revisions but ignores an unchanged ready revision", () => {
    const store = useSessionCatalogStore.getState();
    store.finishFirstPage(store.beginFirstPage(WORKSPACE_ID), page([SESSION_ONE], { revision: 3 }));
    expect(store.invalidateRevision(WORKSPACE_ID, 3)).toBe(false);
    expect(catalog().items).toEqual([SESSION_ONE]);

    expect(store.invalidateRevision(WORKSPACE_ID, 4)).toBe(true);
    expect(catalog()).toMatchObject({ revision: 4, items: [], total: 0 });
  });

  it("resets one Workspace without changing another", () => {
    const store = useSessionCatalogStore.getState();
    store.finishFirstPage(store.beginFirstPage("workspace-a"), page([SESSION_ONE]));
    store.finishFirstPage(store.beginFirstPage("workspace-b"), page([SESSION_TWO]));

    store.reset("workspace-a");

    expect(catalog("workspace-a").items).toEqual([]);
    expect(catalog("workspace-b").items).toEqual([SESSION_TWO]);
  });

  it("clears every Workspace and rejects requests from before the reset", () => {
    const store = useSessionCatalogStore.getState();
    const staleTarget = store.beginFirstPage("workspace-a");
    store.finishFirstPage(store.beginFirstPage("workspace-b"), page([SESSION_TWO]));

    store.reset();
    const currentTarget = store.beginFirstPage("workspace-a");

    expect(store.finishFirstPage(staleTarget, page([SESSION_ONE]))).toBe(false);
    expect(store.finishFirstPage(currentTarget, page([SESSION_TWO]))).toBe(true);
    expect(Object.keys(useSessionCatalogStore.getState().byWorkspace)).toEqual(["workspace-a"]);
    expect(catalog("workspace-a").items).toEqual([SESSION_TWO]);
  });
});

function page(items: SessionSummary[], overrides: Partial<SessionCatalogPage> = {}): SessionCatalogPage {
  return {
    items,
    total: items.length,
    hasMore: false,
    revision: 1,
    itemCount: items.length,
    source: "sqlite",
    state: "ready",
    rebuilding: false,
    incomplete: false,
    skippedCount: 0,
    ...overrides
  };
}

function catalog(workspaceId = WORKSPACE_ID) {
  return selectWorkspaceSessionCatalog(useSessionCatalogStore.getState(), workspaceId);
}
