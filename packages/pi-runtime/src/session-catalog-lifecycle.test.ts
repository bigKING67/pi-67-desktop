import { describe, expect, it, vi } from "vitest";
import {
  createSessionCatalog,
  type SessionCatalogContext,
  type SessionCatalogDiscoveryResult
} from "./session-catalog.js";
import type {
  SessionCatalogRecord,
  SqliteCatalogOpenResult,
  SqliteCatalogState,
  SqliteSessionCatalog
} from "./sqlite-session-catalog.js";

describe("Session Catalog lifecycle", () => {
  it("does not reuse an older SQLite revision when the active source returns to a cached dataset", async () => {
    const state: SqliteCatalogState = {
      sourceKey: "source-a",
      revision: 5,
      reconciledAt: 1,
      itemCount: 2,
      incomplete: false,
      skippedCount: 0
    };
    const sqlite = fakeSqlite(state, [record(1), record(2)]);
    const never = () => new Promise<SessionCatalogDiscoveryResult>(() => undefined);
    const catalog = createSessionCatalog({
      directory: "/owned/catalog",
      openSqlite: async () => ({ kind: "ready", catalog: sqlite })
    });
    const sourceA = context("source-a", never);
    const sourceB = context("source-b", never);

    const firstA = await catalog.query({ scope: "all", limit: 1 }, sourceA);
    const sourceBPage = await catalog.query({ scope: "all" }, sourceB);
    const returnedA = await catalog.query({ scope: "all", limit: 1 }, sourceA);

    expect(firstA.revision).toBe(5);
    expect(sourceBPage.revision).toBeGreaterThan(firstA.revision);
    expect(returnedA.revision).toBeGreaterThan(sourceBPage.revision);
    expect(firstA.nextCursor).toBeDefined();
    await expect(catalog.query({ scope: "all", cursor: firstA.nextCursor! }, sourceA))
      .rejects.toMatchObject({ code: "STALE_SESSION_CATALOG" });
    await catalog.dispose();
  });

  it("rejects a cursor when SQLite demotion changes the revision during its query", async () => {
    const state: SqliteCatalogState = {
      sourceKey: "source",
      revision: 5,
      reconciledAt: 1,
      itemCount: 2,
      incomplete: false,
      skippedCount: 0
    };
    let queryCount = 0;
    const sqlite: SqliteSessionCatalog = {
      getState: () => state,
      query: (query) => {
        queryCount += 1;
        if (queryCount > 1) throw new Error("SQLITE_IOERR");
        return { records: [record(1)], total: 2, hasMore: query.limit < 2 };
      },
      replaceAll: () => state,
      upsert: () => state,
      close: vi.fn()
    };
    const never = () => new Promise<SessionCatalogDiscoveryResult>(() => undefined);
    const active = context("source", never);
    const catalog = createSessionCatalog({
      directory: "/owned/catalog",
      openSqlite: async () => ({ kind: "ready", catalog: sqlite })
    });

    const first = await catalog.query({ scope: "all", limit: 1 }, active);
    await expect(catalog.query({ scope: "all", cursor: first.nextCursor!, limit: 1 }, active))
      .rejects.toMatchObject({ code: "STALE_SESSION_CATALOG" });
    expect(catalog.status()).toMatchObject({ revision: 6, source: "sdk-fallback", state: "rebuilding" });
    await catalog.dispose();
  });

  it("closes a SQLite catalog that opens after disposal instead of reviving it", async () => {
    let releaseOpen!: (result: SqliteCatalogOpenResult) => void;
    const close = vi.fn();
    const sqlite = fakeSqlite({
      sourceKey: "source",
      revision: 1,
      itemCount: 0,
      incomplete: false,
      skippedCount: 0
    }, [], close);
    const catalog = createSessionCatalog({
      directory: "/owned/catalog",
      openSqlite: () => new Promise((resolve) => {
        releaseOpen = resolve;
      })
    });
    const query = catalog.query({ scope: "all" }, context("source", async () => discovery([])));
    await vi.waitFor(() => expect(releaseOpen).toBeTypeOf("function"));

    await catalog.dispose();
    releaseOpen({ kind: "ready", catalog: sqlite });

    await expect(query).rejects.toMatchObject({ code: "RUNTIME_NOT_READY" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps an unresolved upsert across a failed reconcile and a later stale discovery", async () => {
    const fixture = retryingDiscovery(record(1, {
      explicitName: "Stale retry metadata",
      modifiedAt: 10_000,
      messageCount: 1
    }));
    const catalog = createSessionCatalog();
    const active = context("source", fixture.discover);

    const firstReconcile = catalog.reconcile(active);
    await vi.waitFor(() => expect(fixture.rejectFirst).toBeTypeOf("function"));
    await catalog.upsert(record(1, {
      explicitName: "Current runtime metadata",
      modifiedAt: 20_000,
      messageCount: 20
    }), active, "session-updated");
    fixture.rejectFirst(new Error("temporary discovery failure"));
    await firstReconcile;
    await catalog.reconcile(active);

    expect((await catalog.query({ scope: "all" }, active)).items[0]).toMatchObject({
      name: "Current runtime metadata",
      modifiedAt: 20_000,
      messageCount: 20
    });
    await catalog.dispose();
  });

  it("accepts discovery metadata that is newer than an unresolved upsert", async () => {
    const fixture = retryingDiscovery(record(1, {
      explicitName: "Newer external metadata",
      modifiedAt: 30_000,
      messageCount: 30
    }));
    const catalog = createSessionCatalog();
    const active = context("source", fixture.discover);

    const firstReconcile = catalog.reconcile(active);
    await vi.waitFor(() => expect(fixture.rejectFirst).toBeTypeOf("function"));
    await catalog.upsert(record(1, {
      explicitName: "Older runtime metadata",
      modifiedAt: 20_000,
      messageCount: 20
    }), active, "session-updated");
    fixture.rejectFirst(new Error("temporary discovery failure"));
    await firstReconcile;
    await catalog.reconcile(active);

    expect((await catalog.query({ scope: "all" }, active)).items[0]).toMatchObject({
      name: "Newer external metadata",
      modifiedAt: 30_000,
      messageCount: 30
    });
    await catalog.dispose();
  });
});

function retryingDiscovery(secondRecord: SessionCatalogRecord) {
  let rejectFirst!: (error: Error) => void;
  const discover = vi.fn<() => Promise<SessionCatalogDiscoveryResult>>()
    .mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectFirst = reject;
    }))
    .mockResolvedValueOnce(discovery([secondRecord]));
  return { discover, get rejectFirst() { return rejectFirst; } };
}

function fakeSqlite(
  state: SqliteCatalogState,
  records: SessionCatalogRecord[],
  close = vi.fn()
): SqliteSessionCatalog {
  return {
    getState: () => state,
    query: (query) => ({
      records: records.slice(0, query.limit),
      total: records.length,
      hasMore: query.limit < records.length
    }),
    replaceAll: () => state,
    upsert: () => state,
    close
  };
}

function context(sourceKey: string, discover: () => Promise<SessionCatalogDiscoveryResult>): SessionCatalogContext {
  return { sourceKey, workspaceCwd: "/workspace", discover };
}

function discovery(records: SessionCatalogRecord[]): SessionCatalogDiscoveryResult {
  return { records, incomplete: false, skippedCount: 0 };
}

function record(index: number, overrides: Partial<SessionCatalogRecord> = {}): SessionCatalogRecord {
  return {
    id: `id-${index}`,
    path: `/session-${index}.jsonl`,
    cwd: "/workspace",
    cwdKey: "/workspace",
    explicitName: `Session ${index}`,
    modifiedAt: 10_000 - index,
    messageCount: index,
    ...overrides
  };
}
