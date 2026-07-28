import type { SessionCatalogPage, SessionSummary } from "@pi67/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  selectWorkspaceSessionCatalog,
  useSessionCatalogStore
} from "./session-catalog-store.js";

const SESSION_ONE: SessionSummary = {
  id: "session-1",
  path: "/sessions/one.jsonl",
  cwd: "/work",
  name: "Session one",
  modifiedAt: 20,
  messageCount: 2
};

const SESSION_TWO: SessionSummary = {
  id: "session-2",
  path: "/sessions/two.jsonl",
  cwd: "/work",
  name: "Session two",
  modifiedAt: 10,
  messageCount: 4
};
const QUERY_KEY = "0".repeat(64);

describe("session catalog store", () => {
  beforeEach(() => {
    useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
  });

  it("normalizes and installs a first-page projection", () => {
    const store = useSessionCatalogStore.getState();
    const target = store.beginFirstPage({ query: " session " });
    expect(store.finishFirstPage(target, page([SESSION_ONE]))).toBe(true);

    expect(useSessionCatalogStore.getState()).toMatchObject({
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

  it("appends a keyset page without duplicating paths", () => {
    const first = page([SESSION_ONE], {
      total: 2,
      hasMore: true,
      nextCursor: { revision: 1, queryKey: QUERY_KEY, modifiedAt: 20, path: SESSION_ONE.path }
    });
    const second = page([SESSION_ONE, SESSION_TWO], { total: 2 });
    const store = useSessionCatalogStore.getState();
    store.finishFirstPage(store.beginFirstPage(), first);
    const nextTarget = store.beginNextPage();
    expect(nextTarget).toBeDefined();
    expect(store.finishNextPage(nextTarget!, second)).toBe(true);

    expect(useSessionCatalogStore.getState().items).toEqual([SESSION_ONE, SESSION_TWO]);
    expect(useSessionCatalogStore.getState().hasMore).toBe(false);
  });

  it("clears loaded pages and invalidates pending requests when status revision changes", () => {
    useSessionCatalogStore.setState({ ...pageState(page([SESSION_ONE])), query: "" });
    const pending = useSessionCatalogStore.getState().beginFirstPage();

    useSessionCatalogStore.getState().applyStatus({
      revision: 2,
      itemCount: 2,
      source: "sqlite",
      state: "ready",
      rebuilding: false,
      reconciledAt: 30,
      incomplete: false,
      skippedCount: 0
    });

    expect(useSessionCatalogStore.getState()).toMatchObject({
      items: [],
      total: 0,
      revision: 2,
      loading: false,
      incomplete: false,
      skippedCount: 0,
      itemCount: 2,
      reconciledAt: 30
    });
    expect(useSessionCatalogStore.getState().finishFirstPage(pending, page([SESSION_TWO]))).toBe(false);
    expect(useSessionCatalogStore.getState().items).toEqual([]);
  });

  it("retains incomplete status and clears it on reset", () => {
    useSessionCatalogStore.setState({ revision: 3 });
    useSessionCatalogStore.getState().applyStatus({
      revision: 3,
      itemCount: 8,
      source: "sdk-fallback",
      state: "fallback",
      rebuilding: false,
      reconciledAt: 40,
      incomplete: true,
      skippedCount: 2
    });
    expect(useSessionCatalogStore.getState()).toMatchObject({
      catalogState: "fallback",
      source: "sdk-fallback",
      incomplete: true,
      skippedCount: 2,
      itemCount: 8,
      reconciledAt: 40
    });

    useSessionCatalogStore.getState().reset();
    expect(useSessionCatalogStore.getState()).toMatchObject({
      incomplete: false,
      skippedCount: 0,
      itemCount: 0,
      reconciledAt: undefined
    });
  });

  it("does not present old rows as results for a failed new search", () => {
    useSessionCatalogStore.setState({ ...pageState(page([SESSION_ONE])), query: "old" });
    const store = useSessionCatalogStore.getState();
    const target = store.beginFirstPage({ query: "new" });
    expect(store.failFirstPage(target, "catalog unavailable")).toBe(true);

    expect(useSessionCatalogStore.getState()).toMatchObject({
      query: "new",
      items: [],
      total: 0,
      loading: false,
      error: "catalog unavailable"
    });
  });

  it("invalidates changed revisions but ignores an unchanged ready revision", () => {
    useSessionCatalogStore.setState({ ...pageState(page([SESSION_ONE])), revision: 3, rebuilding: false });
    expect(useSessionCatalogStore.getState().invalidateRevision(3)).toBe(false);
    expect(useSessionCatalogStore.getState().items).toEqual([SESSION_ONE]);

    expect(useSessionCatalogStore.getState().invalidateRevision(4)).toBe(true);
    expect(useSessionCatalogStore.getState()).toMatchObject({ revision: 4, items: [], total: 0 });
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

function pageState(value: SessionCatalogPage) {
  return {
    items: value.items,
    total: value.total,
    nextCursor: value.nextCursor,
    hasMore: value.hasMore,
    revision: value.revision,
    rebuilding: value.rebuilding,
    source: value.source,
    catalogState: value.state,
    error: undefined
  };
}
