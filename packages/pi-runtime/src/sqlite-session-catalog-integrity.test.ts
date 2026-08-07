import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  SESSION_CATALOG_DATABASE_FILENAME,
  openSqliteSessionCatalog,
  type SessionCatalogRecord,
  type SqliteSessionCatalog
} from "./sqlite-session-catalog.js";
import { normalizeSessionCatalogPathIdentity } from "./session-path-identity.js";

const temporaryRoots: string[] = [];
const WORKSPACE = normalizeSessionCatalogPathIdentity("/workspace");

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("SQLite Session Catalog integrity", () => {
  it("replaces a quick-check-clean schema whose constraint contract was weakened", async () => {
    const root = await temporaryRoot();
    const damaged = createCatalogWithWeakenedConstraints(root);
    insertCatalogState(damaged, { sourceKey: "", revision: 0, itemCount: 0, incomplete: 1 });
    expect(damaged.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    damaged.close();

    const replaced = await openReady(root);
    expect(replaced.getState()).toMatchObject({ sourceKey: "", revision: 0, itemCount: 0 });
    replaced.close();
  });

  it("replaces a canonical schema with a sqlite-like sabotage trigger", async () => {
    const root = await temporaryRoot();
    const damaged = await openCatalogDatabase(root);
    damaged.exec(`
      CREATE TRIGGER sqliteX_sabotage
      AFTER INSERT ON sessions
      BEGIN
        DELETE FROM sessions WHERE path = NEW.path;
      END;
    `);
    expect(damaged.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    damaged.close();

    const replaced = await openReady(root);
    expect(replaced.getState()).toMatchObject({ sourceKey: "", revision: 0, itemCount: 0 });
    replaced.close();
  });

  it.each([
    ["table", "CREATE TABLE unexpected_table (value TEXT) STRICT;"],
    ["view", "CREATE VIEW unexpected_view AS SELECT path FROM sessions;"],
    ["index", "CREATE INDEX unexpected_index ON sessions(session_id);"]
  ] as const)("replaces a canonical schema with an extra %s", async (_kind, sql) => {
    const root = await temporaryRoot();
    const damaged = await openCatalogDatabase(root);
    damaged.exec(sql);
    expect(damaged.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    damaged.close();

    const replaced = await openReady(root);
    expect(replaced.getState()).toMatchObject({ sourceKey: "", revision: 0, itemCount: 0 });
    replaced.close();
  });

  it("treats ANALYZE statistics as an unsupported schema mutation", async () => {
    const root = await temporaryRoot();
    const damaged = await openCatalogDatabase(root);
    damaged.exec("ANALYZE;");
    expect(damaged.prepare("SELECT name FROM sqlite_schema WHERE name = 'sqlite_stat1'").get())
      .toEqual({ name: "sqlite_stat1" });
    damaged.close();

    const replaced = await openReady(root);
    expect(replaced.getState()).toMatchObject({ sourceKey: "", revision: 0, itemCount: 0 });
    replaced.close();
  });

  it("replaces a logically inconsistent state even when quick_check passes", async () => {
    const root = await temporaryRoot();
    const catalog = await openReady(root);
    catalog.replaceAll("source", [record(1)], metadata(), 1);
    catalog.close();
    const location = join(root, SESSION_CATALOG_DATABASE_FILENAME);
    const inconsistent = new DatabaseSync(location);
    inconsistent.exec("UPDATE catalog_state SET item_count = 999;");
    inconsistent.close();

    const replaced = await openReady(root);
    expect(replaced.getState()).toMatchObject({ sourceKey: "", revision: 0, itemCount: 0 });
    replaced.close();
  });

  it("replaces projections whose derived search or workspace metadata was altered", async () => {
    for (const [column, value] of [
      ["search_name", "wrong-name"],
      ["search_path", "wrong-path"],
      ["search_id", "wrong-id"],
      ["cwd_key", "/wrong-workspace"]
    ] as const) {
      const root = await temporaryRoot();
      const catalog = await openReady(root);
      catalog.replaceAll("source", [record(1)], metadata(), 1);
      catalog.close();
      const damaged = new DatabaseSync(join(root, SESSION_CATALOG_DATABASE_FILENAME));
      damaged.prepare(`UPDATE sessions SET ${column} = ?`).run(value);
      expect(damaged.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
      damaged.close();

      const replaced = await openReady(root);
      expect(replaced.getState()).toMatchObject({ sourceKey: "", revision: 0, itemCount: 0 });
      replaced.close();
    }
  });

  it("replaces a non-initial empty-source state that otherwise has no rows", async () => {
    const root = await temporaryRoot();
    const catalog = await openReady(root);
    catalog.close();
    const damaged = new DatabaseSync(join(root, SESSION_CATALOG_DATABASE_FILENAME));
    damaged.exec("UPDATE catalog_state SET revision = 99, reconciled_at_ms = 1, incomplete = 0;");
    expect(damaged.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    damaged.close();

    const replaced = await openReady(root);
    expect(replaced.getState()).toMatchObject({
      sourceKey: "",
      revision: 0,
      itemCount: 0,
      incomplete: true
    });
    replaced.close();
  });

  it("replaces quick-check-clean catalogs with all-whitespace required metadata", async () => {
    for (const field of ["file_identity", "path", "session_id", "cwd", "cwd_key", "source_key"] as const) {
      const root = await temporaryRoot();
      const damaged = await openCatalogDatabase(root, true);
      if (field === "source_key") {
        damaged.exec("UPDATE catalog_state SET source_key = '   ';");
      } else {
        replaceCatalogState(damaged, { sourceKey: "source", revision: 1, itemCount: 1, incomplete: 0 });
        const values = {
          file_identity: "session-file-fixture-1",
          path: "/sessions/001.jsonl",
          session_id: "id-1",
          cwd: WORKSPACE,
          cwd_key: WORKSPACE,
          [field]: "   "
        };
        damaged.prepare(`
          INSERT INTO sessions (
            file_identity, path, session_id, cwd, cwd_key, explicit_name, search_name, search_path, search_id,
            modified_at_ms, message_count, parent_session_path
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          values.file_identity,
          values.path,
          values.session_id,
          values.cwd,
          values.cwd_key,
          "Session 1",
          "session 1",
          "/sessions/001.jsonl",
          "id-1",
          1,
          1,
          null
        );
      }
      expect(damaged.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
      damaged.close();

      const replaced = await openReady(root);
      expect(replaced.getState()).toMatchObject({
        sourceKey: "",
        revision: 0,
        itemCount: 0,
        incomplete: true
      });
      replaced.close();
    }
  });

  it("replaces a quick-check-clean catalog with more than one initial-state row", async () => {
    const root = await temporaryRoot();
    const damaged = await openCatalogDatabase(root, true);
    insertCatalogState(damaged, {
      singleton: 2,
      sourceKey: "",
      revision: 0,
      itemCount: 0,
      incomplete: 1
    });
    expect(damaged.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    damaged.close();

    const replaced = await openReady(root);
    expect(replaced.getState()).toMatchObject({
      sourceKey: "",
      revision: 0,
      itemCount: 0,
      incomplete: true
    });
    replaced.close();
  });

  it("replaces quick-check-clean non-empty source states outside the lifecycle contract", async () => {
    for (const state of [
      { revision: 0, reconciledAt: 1, incomplete: 0 as const, skippedCount: 0 },
      { revision: 1, reconciledAt: null, incomplete: 0 as const, skippedCount: 0 },
      { revision: 1, reconciledAt: 1, incomplete: 0 as const, skippedCount: 1 }
    ]) {
      const root = await temporaryRoot();
      const damaged = await openCatalogDatabase(root);
      replaceCatalogState(damaged, {
        sourceKey: "source",
        revision: state.revision,
        reconciledAt: state.reconciledAt,
        itemCount: 0,
        incomplete: state.incomplete,
        skippedCount: state.skippedCount
      });
      expect(damaged.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
      damaged.close();

      const replaced = await openReady(root);
      expect(replaced.getState()).toMatchObject({
        sourceKey: "",
        revision: 0,
        itemCount: 0,
        incomplete: true
      });
      replaced.close();
    }
  });

  it.each(["sessions_workspace_organized", "sessions_all_organized"] as const)(
    "replaces a valid projection when required index %s is missing",
    async (indexName) => {
      const root = await temporaryRoot();
      const catalog = await openReady(root);
      catalog.replaceAll("source", [record(1)], metadata(), 1);
      catalog.close();
      const damaged = new DatabaseSync(join(root, SESSION_CATALOG_DATABASE_FILENAME));
      damaged.exec(`DROP INDEX ${indexName};`);
      expect(damaged.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
      damaged.close();

      const replaced = await openReady(root);
      expect(replaced.getState()).toMatchObject({ sourceKey: "", revision: 0, itemCount: 0 });
      replaced.close();
    }
  );

  it.each([
    [
      "sessions_workspace_organized",
      "CREATE INDEX sessions_workspace_organized ON sessions(cwd_key, archived_at_ms, pinned_at_ms DESC, path DESC, modified_at_ms DESC);"
    ],
    [
      "sessions_all_organized",
      "CREATE INDEX sessions_all_organized ON sessions(archived_at_ms, pinned_at_ms ASC, modified_at_ms DESC, path DESC);"
    ]
  ] as const)("replaces a valid projection when index %s violates ordering", async (indexName, replacementSql) => {
    const root = await temporaryRoot();
    const catalog = await openReady(root);
    catalog.replaceAll("source", [record(1)], metadata(), 1);
    catalog.close();
    const damaged = new DatabaseSync(join(root, SESSION_CATALOG_DATABASE_FILENAME));
    damaged.exec(`DROP INDEX ${indexName}; ${replacementSql}`);
    expect(damaged.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    damaged.close();

    const replaced = await openReady(root);
    expect(replaced.getState()).toMatchObject({ sourceKey: "", revision: 0, itemCount: 0 });
    replaced.close();
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-session-catalog-integrity-"));
  temporaryRoots.push(root);
  return root;
}

async function openReady(root: string): Promise<SqliteSessionCatalog> {
  const result = await openSqliteSessionCatalog(root);
  if (result.kind !== "ready") throw new Error(`SQLite unavailable: ${result.reason}`);
  return result.catalog;
}

function record(index: number): SessionCatalogRecord {
  return {
    fileIdentity: `session-file-fixture-${index}`,
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

async function openCatalogDatabase(root: string, ignoreChecks = false): Promise<DatabaseSync> {
  const catalog = await openReady(root);
  catalog.close();
  const database = new DatabaseSync(join(root, SESSION_CATALOG_DATABASE_FILENAME));
  if (ignoreChecks) database.exec("PRAGMA ignore_check_constraints = ON;");
  return database;
}

function createCatalogWithWeakenedConstraints(root: string): DatabaseSync {
  const database = new DatabaseSync(join(root, SESSION_CATALOG_DATABASE_FILENAME));
  database.exec(`
    CREATE TABLE catalog_state (
      singleton INTEGER PRIMARY KEY,
      source_key TEXT NOT NULL,
      revision INTEGER NOT NULL,
      reconciled_at_ms INTEGER,
      item_count INTEGER NOT NULL,
      incomplete INTEGER NOT NULL,
      skipped_count INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE sessions (
      path TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      cwd TEXT NOT NULL,
      cwd_key TEXT NOT NULL,
      explicit_name TEXT,
      search_name TEXT NOT NULL,
      search_path TEXT NOT NULL,
      search_id TEXT NOT NULL,
      modified_at_ms INTEGER NOT NULL,
      message_count INTEGER NOT NULL,
      parent_session_path TEXT
    ) STRICT;
    CREATE INDEX sessions_workspace_recent ON sessions(cwd_key, modified_at_ms DESC, path DESC);
    CREATE INDEX sessions_all_recent ON sessions(modified_at_ms DESC, path DESC);
    PRAGMA user_version = 1;
  `);
  return database;
}

function replaceCatalogState(
  database: DatabaseSync,
  state: Parameters<typeof insertCatalogState>[1]
): void {
  database.exec("DELETE FROM catalog_state;");
  insertCatalogState(database, state);
}

function insertCatalogState(
  database: DatabaseSync,
  state: {
    singleton?: number;
    sourceKey: string;
    revision: number;
    reconciledAt?: number | null;
    itemCount: number;
    incomplete: 0 | 1;
    skippedCount?: number;
  }
): void {
  database.prepare(`
    INSERT INTO catalog_state (
      singleton, source_key, revision, reconciled_at_ms, item_count, incomplete, skipped_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    state.singleton ?? 1,
    state.sourceKey,
    state.revision,
    state.reconciledAt === undefined ? (state.sourceKey.length === 0 ? null : 1) : state.reconciledAt,
    state.itemCount,
    state.incomplete,
    state.skippedCount ?? 0
  );
}
