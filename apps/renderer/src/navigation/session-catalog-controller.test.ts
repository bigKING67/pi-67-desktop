import type { SessionCatalogPage, SessionSummary } from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import {
  handleSessionCatalogChanged,
  loadMoreSessionCatalog,
  queryFirstSessionCatalog,
  querySessionCatalogPage
} from "./session-catalog-controller.js";
import {
  selectWorkspaceSessionCatalog,
  useSessionCatalogStore
} from "./session-catalog-store.js";

const WORKSPACE_ID = "workspace-a";

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

const NEXT_CURSOR = {
  revision: 1,
  queryKey: "0".repeat(64),
  modifiedAt: 20,
  path: SESSION_ONE.path
};

describe("session catalog controller", () => {
  beforeEach(() => {
    useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("owns the bounded first-page transport request", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(page([SESSION_ONE]) as never);

    await queryFirstSessionCatalog(WORKSPACE_ID, { query: " session ", refresh: true });

    expect(request).toHaveBeenCalledWith("session.catalog.query", {
      scope: "workspace",
      limit: 50,
      search: "session",
      refresh: true
    }, [], { context: { scope: "workspace", workspaceId: WORKSPACE_ID } });
    expect(catalog()).toMatchObject({
      items: [SESSION_ONE],
      query: "session",
      loading: false,
      error: undefined
    });
  });

  it("appends the next page without duplicating an existing path", async () => {
    vi.spyOn(agentConnectionController, "request")
      .mockResolvedValueOnce(page([SESSION_ONE], { total: 2, hasMore: true, nextCursor: NEXT_CURSOR }) as never)
      .mockResolvedValueOnce(page([SESSION_ONE, SESSION_TWO], { total: 2 }) as never);

    await queryFirstSessionCatalog(WORKSPACE_ID);
    await loadMoreSessionCatalog(WORKSPACE_ID);

    expect(catalog().items).toEqual([SESSION_ONE, SESSION_TWO]);
  });

  it("reloads the first page when a keyset cursor becomes stale", async () => {
    const stale = new ProtocolRequestError({
      code: "STALE_SESSION_CATALOG",
      message: "Catalog revision changed.",
      recoverable: true
    });
    vi.spyOn(agentConnectionController, "request")
      .mockResolvedValueOnce(page([SESSION_ONE], { total: 2, hasMore: true, nextCursor: NEXT_CURSOR }) as never)
      .mockRejectedValueOnce(stale)
      .mockResolvedValueOnce(page([SESSION_TWO], { revision: 2 }) as never);

    await queryFirstSessionCatalog(WORKSPACE_ID);
    await loadMoreSessionCatalog(WORKSPACE_ID);

    expect(catalog()).toMatchObject({
      items: [SESSION_TWO],
      revision: 2,
      loading: false,
      loadingMore: false
    });
  });

  it("drops a delayed first-page failure after reset", async () => {
    const pending = deferred<SessionCatalogPage>();
    vi.spyOn(agentConnectionController, "request").mockReturnValue(pending.promise as never);

    const query = queryFirstSessionCatalog(WORKSPACE_ID);
    useSessionCatalogStore.getState().reset(WORKSPACE_ID);
    pending.reject(new Error("old Port closed"));
    await query;

    expect(catalog()).toMatchObject({
      items: [],
      loading: false,
      error: undefined
    });
  });

  it("refreshes on a changed revision but ignores an unchanged ready revision", async () => {
    useSessionCatalogStore.getState().applyStatus(WORKSPACE_ID, status(3));
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(
      page([SESSION_TWO], { revision: 4 }) as never
    );

    handleSessionCatalogChanged(WORKSPACE_ID, 3);
    expect(request).not.toHaveBeenCalled();
    handleSessionCatalogChanged(WORKSPACE_ID, 4);

    await vi.waitFor(() => expect(catalog().items).toEqual([SESSION_TWO]));
    expect(request).toHaveBeenCalledOnce();
  });

  it("keeps command-palette page queries outside Store mutation", async () => {
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(page([SESSION_ONE]) as never);

    await querySessionCatalogPage({ workspaceId: WORKSPACE_ID, query: " session " });

    expect(request).toHaveBeenCalledWith("session.catalog.query", {
      scope: "workspace",
      limit: 50,
      search: "session"
    }, [], { context: { scope: "workspace", workspaceId: WORKSPACE_ID } });
    expect(catalog().items).toEqual([]);
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function catalog() {
  return selectWorkspaceSessionCatalog(useSessionCatalogStore.getState(), WORKSPACE_ID);
}

function status(revision: number) {
  return {
    revision,
    itemCount: 0,
    source: "sqlite" as const,
    state: "ready" as const,
    rebuilding: false,
    incomplete: false,
    skippedCount: 0
  };
}
