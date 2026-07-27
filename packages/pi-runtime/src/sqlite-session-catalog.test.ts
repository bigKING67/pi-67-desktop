import { chmod, link, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  SESSION_CATALOG_DATABASE_FILENAME,
  SESSION_CATALOG_RECOVERY_FILENAME,
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

describe("SQLite Session Catalog", () => {
  it("creates, pages at 1/50/100, preserves ties and reopens the projection", async () => {
    const root = await temporaryRoot();
    const catalog = await openReady(root);
    const records = Array.from({ length: 151 }, (_, index) => record(index, {
      id: index < 2 ? "duplicate-id" : `id-${index}`,
      modifiedAt: index < 120 ? 1_000 : 900
    }));
    const state = catalog.replaceAll("source-a", records, metadata(), 1);
    expect(state).toMatchObject({ sourceKey: "source-a", revision: 2, itemCount: 151 });

    const single = catalog.query({ scope: "all", cwdKey: WORKSPACE, limit: 1 });
    expect(single.records).toHaveLength(1);
    expect(single.hasMore).toBe(true);

    const first = catalog.query({ scope: "all", cwdKey: WORKSPACE, limit: 50 });
    const last = first.records.at(-1)!;
    const second = catalog.query({
      scope: "all",
      cwdKey: WORKSPACE,
      cursor: { modifiedAt: last.modifiedAt, path: last.path },
      limit: 50
    });
    const hundred = catalog.query({ scope: "all", cwdKey: WORKSPACE, limit: 100 });
    expect(first.records).toHaveLength(50);
    expect(second.records).toHaveLength(50);
    expect(hundred.records).toHaveLength(100);
    expect(new Set([...first.records, ...second.records].map((item) => item.path)).size).toBe(100);
    expect(records.filter((item) => item.id === "duplicate-id")).toHaveLength(2);

    catalog.close();
    const reopened = await openReady(root);
    expect(reopened.getState()).toEqual(state);
    expect(reopened.query({ scope: "all", cwdKey: WORKSPACE, limit: 100 }).total).toBe(151);
    reopened.close();
  });

  it("normalizes Chinese/full-width search and treats LIKE metacharacters literally", async () => {
    const root = await temporaryRoot();
    const catalog = await openReady(root);
    catalog.replaceAll("source", [
      record(1, { explicitName: "中文 ＡＢＣ" }),
      record(2, { explicitName: "literal % value" }),
      record(3, { explicitName: "literal _ value" }),
      record(4, { explicitName: "literal \\ value" })
    ], metadata(), 1);

    expect(querySearch(catalog, "中文 abc")).toHaveLength(1);
    expect(querySearch(catalog, "%").map((item) => item.explicitName)).toEqual(["literal % value"]);
    expect(querySearch(catalog, "_").map((item) => item.explicitName)).toEqual(["literal _ value"]);
    expect(querySearch(catalog, "\\").map((item) => item.explicitName)).toEqual(["literal \\ value"]);
    catalog.close();
  });

  it("rebuilds atomically, replaces a changed source and preserves duplicate ids by path", async () => {
    const root = await temporaryRoot();
    const catalog = await openReady(root);
    catalog.replaceAll("source-a", [record(1), record(2, { id: "id-1" })], metadata(), 1);

    expect(() => catalog.replaceAll(
      "broken-source",
      [record(3, { messageCount: -1 })],
      metadata(),
      2
    )).toThrow();
    expect(catalog.getState()).toMatchObject({ sourceKey: "source-a", revision: 2, itemCount: 2 });
    expect(catalog.query({ scope: "all", cwdKey: WORKSPACE, limit: 50 }).total).toBe(2);

    const replaced = catalog.replaceAll("source-b", [record(4)], metadata(), 2);
    expect(replaced).toMatchObject({ sourceKey: "source-b", revision: 3, itemCount: 1 });
    expect(catalog.query({ scope: "all", cwdKey: WORKSPACE, limit: 50 }).records.map((item) => item.path))
      .toEqual(["/sessions/004.jsonl"]);
    catalog.close();
  });

  it("replaces a corrupt disposable database without accumulating recovery files", async () => {
    const root = await temporaryRoot();
    const location = join(root, SESSION_CATALOG_DATABASE_FILENAME);
    await writeFile(location, Buffer.from("not-a-sqlite-database"));

    const catalog = await openReady(root);
    expect((await readdir(root)).filter((name) => name.includes("recovery"))).toHaveLength(1);
    catalog.replaceAll("source", [record(1)], metadata(), 1);
    catalog.close();

    expect((await readdir(root)).filter((name) => name.includes("recovery"))).toEqual([]);
    expect((await readFile(location)).subarray(0, 16).toString("utf8")).toBe("SQLite format 3\0");
  });

  it("replaces an incompatible disposable schema instead of writing through it", async () => {
    const root = await temporaryRoot();
    const location = join(root, SESSION_CATALOG_DATABASE_FILENAME);
    const incompatible = new DatabaseSync(location);
    incompatible.exec("CREATE TABLE unrelated (value TEXT) STRICT; PRAGMA user_version = 99;");
    incompatible.close();

    const catalog = await openReady(root);
    expect(catalog.getState()).toMatchObject({ sourceKey: "", revision: 0, itemCount: 0 });
    catalog.replaceAll("source", [record(1)], metadata(), 1);
    catalog.close();
    expect((await readdir(root)).filter((name) => name.includes("recovery"))).toEqual([]);
  });

  it.runIf(process.platform !== "win32")(
    "tightens an existing catalog database to owner-only permissions",
    async () => {
      const root = await temporaryRoot();
      const created = await openReady(root);
      created.close();
      const location = join(root, SESSION_CATALOG_DATABASE_FILENAME);
      await chmod(location, 0o644);

      const reopened = await openReady(root);
      expect((await stat(location)).mode & 0o777).toBe(0o600);
      reopened.close();
    }
  );

  it.runIf(process.platform !== "win32")(
    "closes a newly opened database when private file permissions cannot be applied",
    async () => {
      const root = await temporaryRoot();
      let closed = false;
      class TrackingDatabase {
        private readonly database: DatabaseSync;

        constructor(location: string) {
          this.database = new DatabaseSync(location);
        }

        close(): void {
          closed = true;
          this.database.close();
        }

        exec(sql: string): void {
          this.database.exec(sql);
        }

        prepare(sql: string) {
          return this.database.prepare(sql);
        }
      }

      const result = await openSqliteSessionCatalog(root, undefined, async () => TrackingDatabase, {
        chmod: async (path, mode) => {
          if (path.endsWith(SESSION_CATALOG_DATABASE_FILENAME)) {
            throw Object.assign(new Error("not permitted"), { code: "EPERM" });
          }
          await chmod(path, mode);
        },
        stat,
        effectiveUserId: currentUserId
      });

      expect(result).toEqual({ kind: "fallback", reason: "unavailable" });
      expect(closed).toBe(true);
    }
  );

  it.runIf(process.platform !== "win32")(
    "fails closed when the verified database mode is still too broad",
    async () => {
      const root = await temporaryRoot();
      const owner = currentUserId();
      const result = await openSqliteSessionCatalog(root, undefined, async () => DatabaseSync, {
        chmod,
        stat: async (path) => {
          const info = await stat(path);
          return {
            mode: path.endsWith(SESSION_CATALOG_DATABASE_FILENAME) ? 0o100644 : info.mode,
            uid: info.uid
          };
        },
        effectiveUserId: () => owner
      });

      expect(result).toEqual({ kind: "fallback", reason: "unavailable" });
    }
  );

  it("does not rename or delete a busy catalog", async () => {
    const root = await temporaryRoot();
    const created = await openReady(root);
    created.replaceAll("source", [record(1)], metadata(), 1);
    created.close();
    const location = join(root, SESSION_CATALOG_DATABASE_FILENAME);
    const before = await readFile(location);
    const locking = new DatabaseSync(location);
    locking.exec("PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE;");
    try {
      const result = await openSqliteSessionCatalog(root);
      expect(result).toEqual({ kind: "fallback", reason: "busy" });
      expect(await readFile(location)).toEqual(before);
      expect((await readdir(root)).filter((name) => name.includes("recovery"))).toEqual([]);
    } finally {
      locking.exec("ROLLBACK");
      locking.close();
    }
  });

  it("rejects symlinked catalog directories and database files", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const linkedDirectory = join(root, "linked-catalog");
    await symlink(outside, linkedDirectory, process.platform === "win32" ? "junction" : "dir");
    expect(await openSqliteSessionCatalog(linkedDirectory)).toEqual({ kind: "fallback", reason: "unavailable" });

    const target = join(outside, "outside.sqlite3");
    await writeFile(target, "OUTSIDE_SENTINEL", "utf8");
    await symlink(target, join(root, SESSION_CATALOG_DATABASE_FILENAME), "file");
    expect(await openSqliteSessionCatalog(root)).toEqual({ kind: "fallback", reason: "unavailable" });
    expect(await readFile(target, "utf8")).toBe("OUTSIDE_SENTINEL");
  });

  it("rejects a catalog reached through a symlinked parent directory", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const outsideCatalog = join(outside, "session-catalog");
    const linkedParent = join(root, "projections");
    await mkdir(outsideCatalog);
    await symlink(outside, linkedParent, process.platform === "win32" ? "junction" : "dir");

    expect(await openSqliteSessionCatalog(join(linkedParent, "session-catalog"), root))
      .toEqual({ kind: "fallback", reason: "unavailable" });
  });

  it("does not remove a symlinked recovery file while replacing corruption", async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const target = join(outside, "outside-recovery.sqlite3");
    await writeFile(join(root, SESSION_CATALOG_DATABASE_FILENAME), "corrupt", "utf8");
    await writeFile(target, "RECOVERY_SENTINEL", "utf8");
    await symlink(target, join(root, SESSION_CATALOG_RECOVERY_FILENAME), "file");

    expect(await openSqliteSessionCatalog(root)).toEqual({ kind: "fallback", reason: "unavailable" });
    expect(await readFile(target, "utf8")).toBe("RECOVERY_SENTINEL");
  });

  it("rejects directory-shaped database and recovery paths", async () => {
    const databaseRoot = await temporaryRoot();
    await mkdir(join(databaseRoot, SESSION_CATALOG_DATABASE_FILENAME));
    expect(await openSqliteSessionCatalog(databaseRoot)).toEqual({ kind: "fallback", reason: "unavailable" });

    const recoveryRoot = await temporaryRoot();
    await writeFile(join(recoveryRoot, SESSION_CATALOG_DATABASE_FILENAME), "corrupt", "utf8");
    await mkdir(join(recoveryRoot, SESSION_CATALOG_RECOVERY_FILENAME));
    expect(await openSqliteSessionCatalog(recoveryRoot)).toEqual({ kind: "fallback", reason: "unavailable" });
  });

  it.runIf(process.platform !== "win32")(
    "does not rename or remove hard-linked external aliases during corruption recovery",
    async () => {
      const databaseRoot = await temporaryRoot();
      const outsideDatabase = join(databaseRoot, "outside-database.sqlite3");
      await writeFile(outsideDatabase, "DATABASE_SENTINEL", "utf8");
      await link(outsideDatabase, join(databaseRoot, SESSION_CATALOG_DATABASE_FILENAME));

      expect(await openSqliteSessionCatalog(databaseRoot)).toEqual({ kind: "fallback", reason: "unavailable" });
      await expect(readFile(outsideDatabase, "utf8")).resolves.toBe("DATABASE_SENTINEL");

      const recoveryRoot = await temporaryRoot();
      const outsideRecovery = join(recoveryRoot, "outside-recovery.sqlite3");
      await writeFile(join(recoveryRoot, SESSION_CATALOG_DATABASE_FILENAME), "corrupt", "utf8");
      await writeFile(outsideRecovery, "RECOVERY_SENTINEL", "utf8");
      await link(outsideRecovery, join(recoveryRoot, SESSION_CATALOG_RECOVERY_FILENAME));

      expect(await openSqliteSessionCatalog(recoveryRoot)).toEqual({ kind: "fallback", reason: "unavailable" });
      await expect(readFile(outsideRecovery, "utf8")).resolves.toBe("RECOVERY_SENTINEL");
    }
  );

});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-session-catalog-sqlite-"));
  temporaryRoots.push(root);
  return root;
}

async function openReady(root: string): Promise<SqliteSessionCatalog> {
  const result = await openSqliteSessionCatalog(root);
  if (result.kind !== "ready") throw new Error(`SQLite unavailable: ${result.reason}`);
  return result.catalog;
}

function querySearch(catalog: SqliteSessionCatalog, search: string): SessionCatalogRecord[] {
  return catalog.query({
    scope: "all",
    cwdKey: WORKSPACE,
    search: search.normalize("NFKC").toLowerCase(),
    limit: 50
  }).records;
}

function record(index: number, overrides: Partial<SessionCatalogRecord> = {}): SessionCatalogRecord {
  return {
    id: `id-${index}`,
    path: `/sessions/${String(index).padStart(3, "0")}.jsonl`,
    cwd: WORKSPACE,
    cwdKey: WORKSPACE,
    explicitName: `Session ${index}`,
    modifiedAt: 1_000 - index,
    messageCount: index,
    ...overrides
  };
}

function metadata() {
  return { reconciledAt: 1_700_000_000_000, incomplete: false, skippedCount: 0 };
}

function currentUserId(): number {
  if (typeof process.geteuid !== "function") throw new Error("POSIX user identity is unavailable.");
  return process.geteuid();
}
