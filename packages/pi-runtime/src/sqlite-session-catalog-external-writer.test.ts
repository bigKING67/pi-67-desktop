import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSessionCatalog,
  type SessionCatalogDiscoveryResult
} from "./session-catalog.js";
import {
  openSqliteSessionCatalog,
  SESSION_CATALOG_DATABASE_FILENAME,
  SessionCatalogChangedExternallyError,
  type SessionCatalogRecord,
  type SqliteSessionCatalog
} from "./sqlite-session-catalog.js";
import type { DatabaseLike } from "./sqlite-session-catalog-schema.js";
import { normalizeSessionCatalogPathIdentity } from "./session-path-identity.js";

const temporaryRoots: string[] = [];
const WORKSPACE = normalizeSessionCatalogPathIdentity("/workspace");

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("SQLite Session Catalog external writer guard", () => {
  it("captures the validated baseline while holding the initial write lock", async () => {
    const root = await temporaryRoot();
    const seeded = await openReady(root);
    seeded.close();
    const control: InterleavingControl = {};
    let externalWriteCode: number | undefined;
    control.beforeGet = (sql) => {
      if (!sql.includes("pragma_data_version")) return;
      delete control.beforeGet;
      try {
        control.external!.exec("CREATE TRIGGER validation_gap AFTER INSERT ON sessions BEGIN SELECT 1; END;");
      } catch (error) {
        externalWriteCode = sqlitePrimaryErrorCode(error);
      }
    };
    const opened = await openInterleavingCatalog(root, control);

    expect(externalWriteCode).toBe(5);
    expect(opened.getState()).toMatchObject({ sourceKey: "", revision: 0 });
    expect(control.external!.prepare("SELECT name FROM sqlite_schema WHERE name = 'validation_gap'").get())
      .toBeUndefined();
    opened.close();
    control.external?.close();
  });

  it.each([
    ["data", "UPDATE sessions SET message_count = message_count + 1;"],
    ["schema", "CREATE INDEX external_session_id ON sessions(session_id);"]
  ] as const)("detects a committed external %s change before serving another read", async (_kind, sql) => {
    const root = await temporaryRoot();
    const catalog = await openReady(root);
    catalog.replaceAll("source", [record(1)], metadata(), 1);
    const external = new DatabaseSync(join(root, SESSION_CATALOG_DATABASE_FILENAME));
    external.exec(sql);
    external.close();

    expect(() => catalog.getState()).toThrow(SessionCatalogChangedExternallyError);
    catalog.close();
  });

  it("does not treat another connection's read-only work as an external mutation", async () => {
    const root = await temporaryRoot();
    const catalog = await openReady(root);
    catalog.replaceAll("source", [record(1)], metadata(), 1);
    const reader = new DatabaseSync(join(root, SESSION_CATALOG_DATABASE_FILENAME), { readOnly: true });
    expect(reader.prepare("SELECT COUNT(*) AS total FROM sessions").get()).toEqual({ total: 1 });
    reader.close();

    expect(catalog.query({ scope: "all", cwdKey: WORKSPACE, limit: 50 }).total).toBe(1);
    catalog.close();
  });

  it("detects an external commit between the count and page reads", async () => {
    const control: InterleavingControl = {};
    const root = await temporaryRoot();
    const opened = await openInterleavingCatalog(root, control);
    opened.replaceAll("source", [record(1)], metadata(), 1);
    control.beforeAll = (sql) => {
      if (!sql.includes("ORDER BY modified_at_ms DESC")) return;
      delete control.beforeAll;
      control.external!.exec("UPDATE sessions SET message_count = message_count + 1;");
    };

    expect(() => opened.query({ scope: "all", cwdKey: WORKSPACE, limit: 50 }))
      .toThrow(SessionCatalogChangedExternallyError);
    opened.close();
    control.external?.close();
  });

  it("checks the external generation inside the write lock before replacing rows", async () => {
    const control: InterleavingControl = {};
    const root = await temporaryRoot();
    const opened = await openInterleavingCatalog(root, control);
    opened.replaceAll("source", [record(1)], metadata(), 1);
    opened.upsert(record(2), 2);
    control.beforeExec = (sql) => {
      if (sql !== "BEGIN IMMEDIATE") return;
      delete control.beforeExec;
      control.external!.exec("UPDATE sessions SET message_count = 777 WHERE session_id = 'id-1';");
    };

    expect(() => opened.replaceAll("source", [record(3)], metadata(), 3))
      .toThrow(SessionCatalogChangedExternallyError);
    expect(control.external!.prepare("SELECT message_count FROM sessions WHERE session_id = 'id-1'").get())
      .toEqual({ message_count: 777 });
    opened.close();
    control.external?.close();
  });

  it("demotes the live projection and schedules bounded fallback recovery", async () => {
    const root = await temporaryRoot();
    let discoveryCount = 0;
    let resolveRecovery!: (result: SessionCatalogDiscoveryResult) => void;
    const active = {
      sourceKey: "source",
      workspaceCwd: WORKSPACE,
      discover: () => {
        discoveryCount += 1;
        if (discoveryCount === 1) return Promise.resolve(discovery([record(1)]));
        return new Promise<SessionCatalogDiscoveryResult>((resolve) => {
          resolveRecovery = resolve;
        });
      }
    };
    const catalog = createSessionCatalog({ directory: root });
    await catalog.reconcile(active);
    expect(catalog.status()).toMatchObject({ source: "sqlite", state: "ready", itemCount: 1 });

    const external = new DatabaseSync(join(root, SESSION_CATALOG_DATABASE_FILENAME));
    external.exec("UPDATE sessions SET message_count = message_count + 1;");
    external.close();
    const staleRead = await catalog.query({ scope: "all" }, active);

    expect(staleRead.items).toEqual([]);
    await vi.waitFor(() => expect(discoveryCount).toBe(2));
    expect(catalog.status()).toMatchObject({ source: "sdk-fallback", state: "rebuilding", itemCount: 0 });
    resolveRecovery(discovery([record(1)]));
    await vi.waitFor(() => expect(catalog.status()).toMatchObject({
      source: "sdk-fallback",
      state: "fallback",
      rebuilding: false,
      itemCount: 1
    }));
    await catalog.dispose();
  });

  it("does not restore externally written rows when SQLite reopens before an upsert", async () => {
    const root = await temporaryRoot();
    let now = 1_000;
    const active = {
      sourceKey: "source",
      workspaceCwd: WORKSPACE,
      discover: async () => discovery([record(1)])
    };
    const catalog = createSessionCatalog({ directory: root, now: () => now });
    await catalog.reconcile(active);

    const external = await openReady(root);
    external.replaceAll("source", [record(1), record(99)], metadata(), 10);
    external.close();
    await catalog.query({ scope: "all" }, active);
    await vi.waitFor(() => expect(catalog.status()).toMatchObject({
      source: "sdk-fallback",
      state: "fallback",
      itemCount: 1
    }));

    now = 3_000;
    await catalog.upsert(record(2), active, "session-updated");
    expect(catalog.status()).toMatchObject({ source: "sdk-fallback", state: "fallback", itemCount: 2 });
    const fallbackPage = await catalog.query({ scope: "all" }, active);
    expect(fallbackPage.items.map((item) => item.id).sort()).toEqual(["id-1", "id-2"]);
    await vi.waitFor(() => expect(catalog.status()).toMatchObject({
      source: "sqlite",
      state: "ready",
      itemCount: 2
    }));
    const settledPage = await catalog.query({ scope: "all" }, active);

    expect(settledPage.items.map((item) => item.id).sort()).toEqual(["id-1", "id-2"]);
    await catalog.dispose();
  });
});

interface InterleavingControl {
  external?: DatabaseSync;
  beforeAll?: (sql: string) => void;
  beforeExec?: (sql: string) => void;
  beforeGet?: (sql: string) => void;
}

async function openInterleavingCatalog(
  root: string,
  control: InterleavingControl
): Promise<SqliteSessionCatalog> {
  class InterleavingDatabase implements DatabaseLike {
    private readonly database: DatabaseSync;

    constructor(location: string) {
      this.database = new DatabaseSync(location);
      control.external = new DatabaseSync(location);
    }

    close(): void {
      this.database.close();
    }

    exec(sql: string): void {
      control.beforeExec?.(sql);
      this.database.exec(sql);
    }

    prepare(sql: string): ReturnType<DatabaseLike["prepare"]> {
      const statement = this.database.prepare(sql);
      return {
        all: (...values) => {
          control.beforeAll?.(sql);
          return statement.all(...values) as Record<string, unknown>[];
        },
        get: (...values) => {
          control.beforeGet?.(sql);
          return statement.get(...values) as Record<string, unknown> | undefined;
        },
        run: (...values) => statement.run(...values)
      };
    }
  }

  const opened = await openSqliteSessionCatalog(root, undefined, async () => InterleavingDatabase);
  if (opened.kind !== "ready") throw new Error(`SQLite unavailable: ${opened.reason}`);
  return opened.catalog;
}

async function openReady(root: string): Promise<SqliteSessionCatalog> {
  const opened = await openSqliteSessionCatalog(root);
  if (opened.kind !== "ready") throw new Error(`SQLite unavailable: ${opened.reason}`);
  return opened.catalog;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-session-catalog-external-writer-"));
  temporaryRoots.push(root);
  return root;
}

function record(index: number): SessionCatalogRecord {
  return {
    id: `id-${index}`,
    path: `/sessions/${String(index).padStart(3, "0")}.jsonl`,
    cwd: WORKSPACE,
    cwdKey: WORKSPACE,
    explicitName: `Session ${index}`,
    modifiedAt: 1_000 - index,
    messageCount: index
  };
}

function metadata() {
  return { reconciledAt: 1_700_000_000_000, incomplete: false, skippedCount: 0 };
}

function discovery(records: SessionCatalogRecord[]): SessionCatalogDiscoveryResult {
  return { records, incomplete: false, skippedCount: 0 };
}

function sqlitePrimaryErrorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("errcode" in error)) return undefined;
  return Number((error as { errcode?: unknown }).errcode) & 0xff;
}
