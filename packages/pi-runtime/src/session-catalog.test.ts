import { MAX_SESSION_CATALOG_PAGE_JSON_BYTES } from "@pi67/domain";
import { describe, expect, it, vi } from "vitest";
import {
  createSessionCatalog,
  type SessionCatalogContext,
  type SessionCatalogDiscoveryResult
} from "./session-catalog.js";
import { normalizeSessionCatalogPathIdentity } from "./session-path-identity.js";
import type {
  SessionCatalogRecord,
  SqliteCatalogOpenResult,
  SqliteCatalogState,
  SqliteSessionCatalog
} from "./sqlite-session-catalog.js";

describe("Session Catalog orchestration", () => {
  it("returns a cold rebuilding page, then reuses a bounded fallback projection", async () => {
    let release!: (value: SessionCatalogDiscoveryResult) => void;
    let completed!: () => void;
    const changed = new Promise<void>((resolve) => {
      completed = resolve;
    });
    const discover = vi.fn(() => new Promise<SessionCatalogDiscoveryResult>((resolve) => {
      release = resolve;
    }));
    const catalog = createSessionCatalog({ onChanged: () => completed() });
    const context = makeContext("source-a", discover);

    const cold = await catalog.query({ scope: "all" }, context);
    expect(cold).toMatchObject({
      items: [],
      total: 0,
      source: "sdk-fallback",
      state: "rebuilding",
      rebuilding: true
    });
    release(discovery([record(1), record(2)]));
    await changed;

    const first = await catalog.query({ scope: "all", limit: 1 }, context);
    const second = await catalog.query({ scope: "all", limit: 100 }, context);
    expect(first).toMatchObject({ total: 2, hasMore: true, source: "sdk-fallback", state: "fallback" });
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(2);
    expect(discover).toHaveBeenCalledTimes(1);
    await catalog.dispose();
  });

  it("recognizes stale cursors after an upsert and keeps duplicate ids on distinct paths", async () => {
    const catalog = createSessionCatalog();
    const context = makeContext("source", async () => discovery([
      record(1, { id: "duplicate" }),
      record(2, { id: "duplicate" })
    ]));
    await catalog.reconcile(context);
    const page = await catalog.query({ scope: "all", limit: 1 }, context);
    expect(page.nextCursor).toBeDefined();

    await catalog.upsert(record(3), context, "session-created");
    await expect(catalog.query({ scope: "all", cursor: page.nextCursor!, limit: 1 }, context))
      .rejects.toMatchObject({ code: "STALE_SESSION_CATALOG", recoverable: true });
    const updated = await catalog.query({ scope: "all", limit: 100 }, context);
    expect(updated.items.filter((item) => item.id === "duplicate")).toHaveLength(2);
    await catalog.dispose();
  });

  it("binds cursors to scope, normalized search and workspace identity", async () => {
    const catalog = createSessionCatalog();
    const discover = async () => discovery([record(1), record(2), record(3)]);
    const workspace = makeContext("source", discover);
    await catalog.reconcile(workspace);

    const allPage = await catalog.query({ scope: "all", limit: 1 }, workspace);
    const allCursor = allPage.nextCursor;
    if (!allCursor) throw new Error("Expected a cursor for the all-session page.");
    expect(allCursor.queryKey).toMatch(/^[0-9a-f]{64}$/u);
    await expect(catalog.query({
      scope: "workspace",
      cursor: allCursor,
      limit: 1
    }, workspace)).rejects.toMatchObject({ code: "STALE_SESSION_CATALOG" });

    const searchPage = await catalog.query({ scope: "all", search: "session", limit: 1 }, workspace);
    const searchCursor = searchPage.nextCursor;
    if (!searchCursor) throw new Error("Expected a cursor for the search page.");
    await expect(catalog.query({
      scope: "all",
      search: "ＳＥＳＳＩＯＮ",
      cursor: searchCursor,
      limit: 1
    }, workspace)).resolves.toMatchObject({ items: [expect.any(Object)] });
    await expect(catalog.query({
      scope: "all",
      search: "different",
      cursor: searchCursor,
      limit: 1
    }, workspace)).rejects.toMatchObject({ code: "STALE_SESSION_CATALOG" });

    const workspacePage = await catalog.query({ scope: "workspace", limit: 1 }, workspace);
    const workspaceCursor = workspacePage.nextCursor;
    if (!workspaceCursor) throw new Error("Expected a cursor for the workspace page.");
    const otherWorkspace = makeContext("source", discover, "/other-workspace");
    await expect(catalog.query({
      scope: "workspace",
      cursor: workspaceCursor,
      limit: 1
    }, otherWorkspace)).rejects.toMatchObject({ code: "STALE_SESSION_CATALOG" });
    await catalog.dispose();
  });

  it("normalizes fallback search without treating percent, underscore or backslash as wildcards", async () => {
    const catalog = createSessionCatalog();
    const context = makeContext("source", async () => discovery([
      record(1, { explicitName: "中文 ＡＢＣ" }),
      record(2, { explicitName: "literal %" }),
      record(3, { explicitName: "literal _" }),
      record(4, { explicitName: "literal \\" })
    ]));
    await catalog.reconcile(context);

    expect((await catalog.query({ scope: "all", search: "中文 abc" }, context)).items).toHaveLength(1);
    expect((await catalog.query({ scope: "all", search: "%" }, context)).items[0]?.name).toBe("literal %");
    expect((await catalog.query({ scope: "all", search: "_" }, context)).items[0]?.name).toBe("literal _");
    expect((await catalog.query({ scope: "all", search: "\\" }, context)).items[0]?.name).toBe("literal \\");
    await catalog.dispose();
  });

  it("falls back on an injected SQLite busy result without retrying discovery on warm queries", async () => {
    const openSqlite = vi.fn(async (): Promise<SqliteCatalogOpenResult> => ({
      kind: "fallback",
      reason: "busy",
      degradedReason: "busy"
    }));
    const discover = vi.fn(async () => discovery([record(1)]));
    const catalog = createSessionCatalog({ directory: "/owned/catalog", openSqlite, now: () => 1_000 });
    const context = makeContext("source", discover);

    await catalog.reconcile(context);
    expect(catalog.status()).toMatchObject({
      source: "sdk-fallback",
      state: "fallback",
      itemCount: 1,
      degradedReason: "busy"
    });
    expect((await catalog.query({ scope: "all" }, context)).items).toHaveLength(1);
    expect((await catalog.query({ scope: "all" }, context)).items).toHaveLength(1);
    expect(openSqlite).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledTimes(1);
    await catalog.dispose();
  });

  it("uses the same bounded metadata fallback when SQLite cannot load", async () => {
    const openSqlite = vi.fn(async (): Promise<SqliteCatalogOpenResult> => ({
      kind: "fallback",
      reason: "unavailable",
      degradedReason: "runtime-load"
    }));
    const catalog = createSessionCatalog({ directory: "/owned/catalog", openSqlite });
    const context = makeContext("source", async () => discovery([record(1)]));
    await catalog.reconcile(context);

    expect(catalog.status()).toMatchObject({
      source: "sdk-fallback",
      state: "fallback",
      itemCount: 1,
      degradedReason: "runtime-load"
    });
    expect((await catalog.query({ scope: "all", limit: 100 }, context)).items).toHaveLength(1);
    await catalog.dispose();
  });

  it("runs discovery single-flight and discards results from a replaced source", async () => {
    let releaseA!: (value: SessionCatalogDiscoveryResult) => void;
    const discoverA = vi.fn(() => new Promise<SessionCatalogDiscoveryResult>((resolve) => {
      releaseA = resolve;
    }));
    const discoverB = vi.fn(async () => discovery([record(2, { path: "/source-b.jsonl" })]));
    const catalog = createSessionCatalog();
    const sourceA = makeContext("source-a", discoverA);
    const sourceB = makeContext("source-b", discoverB);

    const first = catalog.reconcile(sourceA);
    const duplicate = catalog.reconcile(sourceA);
    await catalog.query({ scope: "all" }, sourceB);
    await vi.waitFor(() => expect(discoverB).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(catalog.status().rebuilding).toBe(false));

    const page = await catalog.query({ scope: "all" }, sourceB);
    releaseA(discovery([record(1, { path: "/stale-a.jsonl" })]));
    await Promise.all([first, duplicate]);
    expect(discoverA).toHaveBeenCalledTimes(1);
    expect(discoverB).toHaveBeenCalledTimes(1);
    expect(page.items.map((item) => item.path)).toEqual(["/source-b.jsonl"]);
    await catalog.dispose();
  });

  it("does not let an old source generation overwrite a newer A-B-A lifecycle", async () => {
    let releaseOldA!: (value: SessionCatalogDiscoveryResult) => void;
    let callsA = 0;
    const revisions: number[] = [];
    const sourceA = makeContext("source-a", vi.fn(() => {
      callsA += 1;
      if (callsA === 1) {
        return new Promise<SessionCatalogDiscoveryResult>((resolve) => { releaseOldA = resolve; });
      }
      return Promise.resolve(discovery([record(3, { path: "/current-a.jsonl" })]));
    }));
    const sourceB = makeContext("source-b", async () => discovery([record(2, { path: "/source-b.jsonl" })]));
    const catalog = createSessionCatalog({ onChanged: (event) => revisions.push(event.revision) });

    const oldA = catalog.reconcile(sourceA);
    await vi.waitFor(() => expect(releaseOldA).toBeTypeOf("function"));
    await catalog.reconcile(sourceB);
    await catalog.reconcile(sourceA);
    expect((await catalog.query({ scope: "all" }, sourceA)).items.map((item) => item.path))
      .toEqual(["/current-a.jsonl"]);

    releaseOldA(discovery([record(1, { path: "/stale-a.jsonl" })]));
    await oldA;
    expect((await catalog.query({ scope: "all" }, sourceA)).items.map((item) => item.path))
      .toEqual(["/current-a.jsonl"]);
    expect(revisions.every((revision, index) => index === 0 || revision > revisions[index - 1]!)).toBe(true);
    await catalog.dispose();
  });

  it("opens SQLite only once for concurrent callers", async () => {
    let releaseOpen!: (value: SqliteCatalogOpenResult) => void;
    const openSqlite = vi.fn(() => new Promise<SqliteCatalogOpenResult>((resolve) => { releaseOpen = resolve; }));
    const discover = vi.fn(async () => discovery([record(1)]));
    const context = makeContext("source", discover);
    const catalog = createSessionCatalog({ directory: "/owned/catalog", openSqlite });

    const first = catalog.query({ scope: "all" }, context);
    const second = catalog.query({ scope: "all" }, context);
    await vi.waitFor(() => expect(openSqlite).toHaveBeenCalledOnce());
    releaseOpen({ kind: "fallback", reason: "busy" });
    await Promise.all([first, second]);
    expect(openSqlite).toHaveBeenCalledOnce();
    expect(discover).toHaveBeenCalledOnce();
    await catalog.dispose();
  });

  it("merges a newer upsert that completes while stale discovery is pending", async () => {
    let release!: (value: SessionCatalogDiscoveryResult) => void;
    const discover = vi.fn(() => new Promise<SessionCatalogDiscoveryResult>((resolve) => {
      release = resolve;
    }));
    const catalog = createSessionCatalog();
    const context = makeContext("source", discover);
    const rebuilding = catalog.reconcile(context);
    await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(1));

    await catalog.upsert(record(1, {
      explicitName: "Newest local metadata",
      modifiedAt: 20_000,
      messageCount: 99
    }), context, "session-updated");
    release(discovery([record(1, {
      explicitName: "Stale discovery metadata",
      modifiedAt: 10_000,
      messageCount: 1
    })]));
    await rebuilding;

    expect((await catalog.query({ scope: "all" }, context)).items[0]).toMatchObject({
      name: "Newest local metadata",
      modifiedAt: 20_000,
      messageCount: 99
    });
    await catalog.dispose();
  });

  it("rebuilds the complete SDK fallback after a runtime SQLite query failure", async () => {
    const state: SqliteCatalogState = {
      sourceKey: "source",
      revision: 4,
      reconciledAt: 1,
      itemCount: 1,
      incomplete: false,
      skippedCount: 0
    };
    const sqlite: SqliteSessionCatalog = {
      getState: () => state,
      query: () => { throw new Error("SQLITE_IOERR"); },
      replaceAll: () => state,
      upsert: () => state,
      close: vi.fn()
    };
    let release!: (value: SessionCatalogDiscoveryResult) => void;
    const context = makeContext("source", () => new Promise((resolve) => {
      release = resolve;
    }));
    const catalog = createSessionCatalog({
      directory: "/owned/catalog",
      openSqlite: async () => ({ kind: "ready", catalog: sqlite })
    });

    const demoted = await catalog.query({ scope: "all" }, context);
    expect(demoted).toMatchObject({ source: "sdk-fallback", state: "rebuilding", items: [] });
    release(discovery([record(7)]));
    await vi.waitFor(() => expect(catalog.status()).toMatchObject({
      source: "sdk-fallback",
      state: "fallback",
      rebuilding: false,
      itemCount: 1
    }));
    expect((await catalog.query({ scope: "all" }, context)).items).toHaveLength(1);
    await catalog.dispose();
  });

  it("keeps the current upsert when SQLite fails and fallback discovery is stale", async () => {
    const state: SqliteCatalogState = {
      sourceKey: "source",
      revision: 2,
      reconciledAt: 1,
      itemCount: 1,
      incomplete: false,
      skippedCount: 0
    };
    const sqlite: SqliteSessionCatalog = {
      getState: () => state,
      query: () => ({ records: [], total: 0, hasMore: false }),
      replaceAll: () => state,
      upsert: () => { throw new Error("SQLITE_IOERR"); },
      close: vi.fn()
    };
    let release!: (value: SessionCatalogDiscoveryResult) => void;
    const context = makeContext("source", () => new Promise((resolve) => {
      release = resolve;
    }));
    const catalog = createSessionCatalog({
      directory: "/owned/catalog",
      openSqlite: async () => ({ kind: "ready", catalog: sqlite })
    });

    await catalog.upsert(record(3, {
      explicitName: "Current upsert",
      modifiedAt: 30_000,
      messageCount: 30
    }), context, "session-updated");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release(discovery([record(3, {
      explicitName: "Stale fallback discovery",
      modifiedAt: 3_000,
      messageCount: 3
    })]));
    await vi.waitFor(() => expect(catalog.status().rebuilding).toBe(false));

    expect((await catalog.query({ scope: "all" }, context)).items[0]).toMatchObject({
      name: "Current upsert",
      modifiedAt: 30_000,
      messageCount: 30
    });
    await catalog.dispose();
  });

  it("skips blank required metadata and treats whitespace names as unnamed", async () => {
    const catalog = createSessionCatalog();
    const context = makeContext("source", async () => discovery([
      record(1, { explicitName: "   " }),
      record(2, { cwd: "", cwdKey: "" }),
      record(3, { id: "   " }),
      record(4, { path: "   " }),
      record(5, { parentSessionPath: "   " })
    ]));
    await catalog.reconcile(context);

    const page = await catalog.query({ scope: "all" }, context);
    expect(page).toMatchObject({ total: 1, incomplete: true, skippedCount: 4 });
    expect(page.items[0]?.name).toBe("未命名对话");
    expect(page.items[0]?.nameSource).toBe("fallback");
    await catalog.dispose();
  });

  it("caps serialized pages even when records contain maximum-size metadata", async () => {
    const long = "x".repeat(32_000);
    const records = Array.from({ length: 100 }, (_, index) => record(index, {
      path: `/${String(index).padStart(3, "0")}-${long}`,
      parentSessionPath: `/parent-${long}`
    }));
    const catalog = createSessionCatalog();
    const context = makeContext("source", async () => discovery(records));
    await catalog.reconcile(context);

    const page = await catalog.query({ scope: "all", limit: 100 }, context);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThan(100);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor?.revision).toBe(page.revision);
    expect(Buffer.byteLength(JSON.stringify(page), "utf8")).toBeLessThanOrEqual(MAX_SESSION_CATALOG_PAGE_JSON_BYTES);
    await catalog.dispose();
  });

  it("does not publish a completed rebuild after disposal", async () => {
    let release!: (value: SessionCatalogDiscoveryResult) => void;
    const onChanged = vi.fn();
    const catalog = createSessionCatalog({ onChanged });
    const context = makeContext("source", () => new Promise((resolve) => {
      release = resolve;
    }));
    const rebuilding = catalog.reconcile(context);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await catalog.dispose();
    release(discovery([record(1)]));
    await rebuilding;
    expect(onChanged).not.toHaveBeenCalled();
  });
});

function makeContext(
  sourceKey: string,
  discover: () => Promise<SessionCatalogDiscoveryResult>,
  workspaceCwd = "/workspace"
): SessionCatalogContext {
  return { sourceKey, workspaceCwd, discover };
}

function discovery(records: SessionCatalogRecord[]): SessionCatalogDiscoveryResult {
  return { records, incomplete: false, skippedCount: 0 };
}

function record(index: number, overrides: Partial<SessionCatalogRecord> = {}): SessionCatalogRecord {
  return {
    fileIdentity: `session-file-fixture-${index}`,
    id: `id-${index}`,
    path: `/session-${index}.jsonl`,
    cwd: "/workspace",
    cwdKey: normalizeSessionCatalogPathIdentity("/workspace"),
    explicitName: `Session ${index}`,
    modifiedAt: 10_000 - index,
    messageCount: index,
    ...overrides
  };
}
