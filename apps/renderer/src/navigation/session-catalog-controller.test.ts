import type { SessionCatalogPage, SessionSummary } from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import {
  cancelSessionCatalogRetries,
  findSessionForRecovery,
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

const NEXT_CURSOR = {
  revision: 1,
  queryKey: "0".repeat(64),
  modifiedAt: 20,
  path: SESSION_ONE.path
};

describe("session catalog controller", () => {
  beforeEach(() => {
    useSessionCatalogStore.setState(useSessionCatalogStore.getInitialState(), true);
    rendererWorkbenchStore.getState().reset();
  });

  afterEach(() => {
    cancelSessionCatalogRetries();
    vi.useRealTimers();
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

  it("materializes a matching provisional Task only after the Catalog returns its path", async () => {
    const workbench = rendererWorkbenchStore.getState();
    workbench.registerWorkspace({
      id: WORKSPACE_ID,
      displayName: "A",
      identity: { canonicalPath: "/work", assurance: "filesystem" },
      trust: "trusted",
      trustProvenance: "native-picker",
      availability: "available"
    });
    workbench.openTask({
      id: "task-pending",
      conversation: { kind: "provisional", workspaceId: WORKSPACE_ID, draftId: "task-pending" },
      workspaceId: WORKSPACE_ID,
      sessionId: SESSION_ONE.id,
      sessionGeneration: 2,
      taskGeneration: 1,
      lifecycle: "idle",
      runtime: { phase: "ready", detail: "ready", recoverable: true },
      title: "未命名对话",
      hasDraft: false,
      attachmentCount: 0,
      toolMode: "auto",
      creationStatus: "confirming"
    });
    vi.spyOn(agentConnectionController, "request").mockResolvedValue(page([SESSION_ONE]) as never);

    await queryFirstSessionCatalog(WORKSPACE_ID);

    expect(rendererWorkbenchStore.getState().tasks["task-pending"]).toMatchObject({
      conversation: {
        kind: "session",
        workspaceId: WORKSPACE_ID,
        sessionPath: SESSION_ONE.path
      },
      sessionPath: SESSION_ONE.path,
      title: SESSION_ONE.name,
      titleSource: SESSION_ONE.nameSource
    });
    expect(rendererWorkbenchStore.getState().tasks["task-pending"]?.creationStatus).toBeUndefined();
  });

  it("appends the next page without duplicating an existing path", async () => {
    vi.spyOn(agentConnectionController, "request")
      .mockResolvedValueOnce(page([SESSION_ONE], { total: 2, hasMore: true, nextCursor: NEXT_CURSOR }) as never)
      .mockResolvedValueOnce(page([SESSION_ONE, SESSION_TWO], { total: 2 }) as never);

    await queryFirstSessionCatalog(WORKSPACE_ID);
    await loadMoreSessionCatalog(WORKSPACE_ID);

    expect(catalog().items).toEqual([SESSION_ONE, SESSION_TWO]);
  });

  it("walks Catalog pages until the exact recovery Session id and path match", async () => {
    vi.spyOn(agentConnectionController, "request")
      .mockResolvedValueOnce(page([SESSION_ONE], { total: 2, hasMore: true, nextCursor: NEXT_CURSOR }) as never)
      .mockResolvedValueOnce(page([SESSION_TWO], { total: 2 }) as never);

    await expect(findSessionForRecovery(
      WORKSPACE_ID,
      SESSION_TWO.id,
      SESSION_TWO.path
    )).resolves.toEqual({ status: "found", session: SESSION_TWO });
  });

  it("reports a missing recovery Session only from a complete ready SQLite Catalog", async () => {
    vi.spyOn(agentConnectionController, "request").mockResolvedValue(page([SESSION_ONE]) as never);

    await expect(findSessionForRecovery(
      WORKSPACE_ID,
      SESSION_TWO.id,
      SESSION_TWO.path
    )).resolves.toEqual({ status: "missing" });
  });

  it("does not turn an incomplete fallback Catalog miss into Session deletion", async () => {
    vi.spyOn(agentConnectionController, "request").mockResolvedValue(page([SESSION_ONE], {
      source: "sdk-fallback",
      state: "fallback",
      incomplete: true,
      degradedReason: "runtime-query"
    }) as never);

    await expect(findSessionForRecovery(
      WORKSPACE_ID,
      SESSION_TWO.id,
      SESSION_TWO.path
    )).resolves.toEqual({
      status: "unavailable",
      detail: "对话目录仍在重建，请稍后重试。"
    });
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

  it("retries an unavailable Catalog after 1s, 3s and 10s", async () => {
    vi.useFakeTimers();
    const request = vi.spyOn(agentConnectionController, "request")
      .mockRejectedValueOnce(new Error("unavailable-1"))
      .mockRejectedValueOnce(new Error("unavailable-2"))
      .mockRejectedValueOnce(new Error("unavailable-3"))
      .mockResolvedValueOnce(page([SESSION_ONE]) as never);

    await queryFirstSessionCatalog(WORKSPACE_ID);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(request).toHaveBeenCalledTimes(4);
    expect(catalog()).toMatchObject({ items: [SESSION_ONE], error: undefined });
  });

  it("cancels a scheduled unavailable retry when a newer query succeeds", async () => {
    vi.useFakeTimers();
    const request = vi.spyOn(agentConnectionController, "request")
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(page([SESSION_ONE]) as never);

    await queryFirstSessionCatalog(WORKSPACE_ID);
    await queryFirstSessionCatalog(WORKSPACE_ID, { refresh: true });
    await vi.advanceTimersByTimeAsync(20_000);

    expect(request).toHaveBeenCalledTimes(2);
    expect(catalog().items).toEqual([SESSION_ONE]);
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

  it("refreshes an unchanged revision when background automatic titles become available", async () => {
    useSessionCatalogStore.getState().applyStatus(WORKSPACE_ID, status(3));
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(
      page([SESSION_ONE], { revision: 3 }) as never
    );

    handleSessionCatalogChanged(WORKSPACE_ID, 3, "automatic-title");

    await vi.waitFor(() => expect(catalog().items).toEqual([SESSION_ONE]));
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

  it("passes the archived view through without mutating the active Catalog Store", async () => {
    const archived = { ...SESSION_ONE, archivedAt: 30 };
    const request = vi.spyOn(agentConnectionController, "request").mockResolvedValue(page([archived]) as never);

    await expect(querySessionCatalogPage({
      workspaceId: WORKSPACE_ID,
      query: " old ",
      view: "archived"
    })).resolves.toMatchObject({ items: [archived] });

    expect(request).toHaveBeenCalledWith("session.catalog.query", {
      scope: "workspace",
      limit: 50,
      view: "archived",
      search: "old"
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
