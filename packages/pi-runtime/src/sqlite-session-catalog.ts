import { rename } from "node:fs/promises";
import { join } from "node:path";
import type {
  SessionCatalogCursor,
  SessionCatalogDegradedReason,
  SessionCatalogScope
} from "@pi67/domain";
import {
  configureCatalogDatabase,
  CorruptCatalogError,
  createCatalogSchema,
  recordFromRow,
  recordValues,
  SchemaMismatchError,
  stateFromRow,
  validateCatalogDatabase,
  type DatabaseConstructor,
  type DatabaseLike,
  type SqlValue
} from "./sqlite-session-catalog-schema.js";
import {
  enforcePrivateSessionCatalogPermissions,
  prepareSessionCatalogDirectory,
  removeSessionCatalogRecovery,
  removeSessionCatalogRecoverySync,
  sessionCatalogFileExists,
  type SessionCatalogPermissionOperations
} from "./session-catalog-storage.js";

export const SESSION_CATALOG_DATABASE_FILENAME = "session-catalog-v1.sqlite3";
export const SESSION_CATALOG_RECOVERY_FILENAME = "session-catalog-v1.recovery.sqlite3";
const CATALOG_DATABASE_VERSION_SQL = `
  SELECT data.data_version, schema_version.schema_version
  FROM pragma_data_version() AS data
  CROSS JOIN pragma_schema_version() AS schema_version
`;

export interface SessionCatalogRecord {
  id: string;
  path: string;
  cwd: string;
  cwdKey: string;
  explicitName?: string;
  modifiedAt: number;
  messageCount: number;
  parentSessionPath?: string;
}

export interface SqliteCatalogState {
  sourceKey: string;
  revision: number;
  reconciledAt?: number;
  itemCount: number;
  incomplete: boolean;
  skippedCount: number;
}

interface CatalogDatabaseVersion {
  dataVersion: number;
  schemaVersion: number;
}

export class SessionCatalogChangedExternallyError extends Error {
  readonly code = "SESSION_CATALOG_CHANGED_EXTERNALLY";
  readonly recoverable = true;

  constructor() {
    super("Session Catalog changed outside the active Agent Host.");
  }
}

interface SqliteCatalogQuery {
  scope: SessionCatalogScope;
  cwdKey: string;
  search?: string;
  cursor?: Pick<SessionCatalogCursor, "modifiedAt" | "path">;
  limit: number;
}

export interface SqliteCatalogQueryResult {
  records: SessionCatalogRecord[];
  total: number;
  hasMore: boolean;
}

export interface SqliteSessionCatalog {
  getState(): SqliteCatalogState;
  query(query: SqliteCatalogQuery): SqliteCatalogQueryResult;
  replaceAll(
    sourceKey: string,
    records: SessionCatalogRecord[],
    metadata: { reconciledAt: number; incomplete: boolean; skippedCount: number },
    minimumRevision: number
  ): SqliteCatalogState;
  upsert(record: SessionCatalogRecord, minimumRevision: number): SqliteCatalogState;
  close(): void;
}

export type SqliteCatalogOpenResult =
  | { kind: "ready"; catalog: SqliteSessionCatalog }
  | {
      kind: "fallback";
      reason: "busy" | "unavailable";
      degradedReason?: Exclude<SessionCatalogDegradedReason, "runtime-query">;
    };

export type OpenSqliteSessionCatalog = (
  directory: string,
  expectedRoot?: string
) => Promise<SqliteCatalogOpenResult>;

export async function openSqliteSessionCatalog(
  directory: string,
  expectedRoot?: string,
  loadDatabase: () => Promise<DatabaseConstructor> = loadNodeSqlite,
  permissionOperations?: SessionCatalogPermissionOperations
): Promise<SqliteCatalogOpenResult> {
  let Database: DatabaseConstructor;
  try {
    Database = await loadDatabase();
  } catch {
    return fallback("unavailable", "runtime-load");
  }

  let canonicalDirectory: string;
  try {
    canonicalDirectory = await prepareSessionCatalogDirectory(directory, expectedRoot, permissionOperations);
  } catch {
    return fallback("unavailable", "storage-prepare");
  }

  const location = join(canonicalDirectory, SESSION_CATALOG_DATABASE_FILENAME);
  const recovery = join(canonicalDirectory, SESSION_CATALOG_RECOVERY_FILENAME);
  let exists: boolean;
  try {
    exists = await sessionCatalogFileExists(location);
  } catch {
    return fallback("unavailable", "storage-inspect");
  }
  let database: DatabaseLike | undefined;
  let stage: Exclude<SessionCatalogDegradedReason, "busy" | "unavailable" | "runtime-query"> = "database-open";
  try {
    if (exists) {
      stage = "database-verify";
      await enforcePrivateSessionCatalogPermissions(location, 0o600, "database", permissionOperations);
    }
    stage = "database-open";
    database = new Database(location);
    if (!exists) {
      stage = "database-verify";
      await sessionCatalogFileExists(location);
      await enforcePrivateSessionCatalogPermissions(location, 0o600, "database", permissionOperations);
    }
    stage = "schema-prepare";
    const openedVersion = prepareCatalogForUse(database, !exists);
    stage = "database-verify";
    await sessionCatalogFileExists(location);
    return { kind: "ready", catalog: new NodeSqliteSessionCatalog(database, recovery, openedVersion) };
  } catch (error) {
    safeClose(database);
    const failure = classifySqliteFailure(error);
    if (failure === "busy") return fallback("busy", "busy");
    if (failure !== "replaceable") return fallback("unavailable", stage);
  }

  stage = "recovery-prepare";
  try {
    await removeSessionCatalogRecovery(recovery);
    await sessionCatalogFileExists(location);
    await rename(location, recovery);
    await sessionCatalogFileExists(recovery);
    stage = "recovery-open";
    database = new Database(location);
    stage = "recovery-verify";
    await sessionCatalogFileExists(location);
    await enforcePrivateSessionCatalogPermissions(location, 0o600, "database", permissionOperations);
    stage = "recovery-schema";
    const openedVersion = prepareCatalogForUse(database, true);
    stage = "recovery-verify";
    await sessionCatalogFileExists(location);
    return { kind: "ready", catalog: new NodeSqliteSessionCatalog(database, recovery, openedVersion) };
  } catch (error) {
    safeClose(database);
    return classifySqliteFailure(error) === "busy"
      ? fallback("busy", "busy")
      : fallback("unavailable", stage);
  }
}

function fallback(
  reason: "busy" | "unavailable",
  degradedReason: Exclude<SessionCatalogDegradedReason, "runtime-query">
): SqliteCatalogOpenResult {
  return { kind: "fallback", reason, degradedReason };
}

class NodeSqliteSessionCatalog implements SqliteSessionCatalog {
  private closed = false;
  private readonly versionStatement: ReturnType<DatabaseLike["prepare"]>;

  constructor(
    private readonly database: DatabaseLike,
    private readonly recoveryPath: string,
    private readonly openedVersion: CatalogDatabaseVersion
  ) {
    this.versionStatement = database.prepare(CATALOG_DATABASE_VERSION_SQL);
  }

  getState(): SqliteCatalogState {
    this.assertDatabaseVersion();
    const state = this.readState();
    this.assertDatabaseVersion();
    return state;
  }

  private readState(): SqliteCatalogState {
    const row = this.database.prepare(`
      SELECT source_key, revision, reconciled_at_ms, item_count, incomplete, skipped_count
      FROM catalog_state WHERE singleton = 1
    `).get();
    if (!row) throw new SchemaMismatchError("Catalog state is missing.");
    return stateFromRow(row);
  }

  query(query: SqliteCatalogQuery): SqliteCatalogQueryResult {
    this.assertDatabaseVersion();
    const filters: string[] = [];
    const values: SqlValue[] = [];
    if (query.scope === "workspace") {
      filters.push("cwd_key = ?");
      values.push(query.cwdKey);
    }
    if (query.search !== undefined && query.search.length > 0) {
      filters.push("(search_name LIKE ? ESCAPE '\\' OR search_path LIKE ? ESCAPE '\\' OR search_id LIKE ? ESCAPE '\\')");
      const pattern = `%${escapeLikePattern(query.search)}%`;
      values.push(pattern, pattern, pattern);
    }
    const countWhere = filters.length > 0 ? ` WHERE ${filters.join(" AND ")}` : "";
    const totalRow = this.database.prepare(`SELECT COUNT(*) AS total FROM sessions${countWhere}`).get(...values);
    const total = readInteger(totalRow?.total, "total");

    const pageFilters = [...filters];
    const pageValues = [...values];
    if (query.cursor) {
      pageFilters.push("(modified_at_ms < ? OR (modified_at_ms = ? AND path < ?))");
      pageValues.push(query.cursor.modifiedAt, query.cursor.modifiedAt, query.cursor.path);
    }
    const pageWhere = pageFilters.length > 0 ? ` WHERE ${pageFilters.join(" AND ")}` : "";
    const rows = this.database.prepare(`
      SELECT path, session_id, cwd, cwd_key, explicit_name, modified_at_ms, message_count, parent_session_path
      FROM sessions${pageWhere}
      ORDER BY modified_at_ms DESC, path DESC
      LIMIT ?
    `).all(...pageValues, query.limit + 1);
    const result = {
      records: rows.slice(0, query.limit).map(recordFromRow),
      total,
      hasMore: rows.length > query.limit
    };
    this.assertDatabaseVersion();
    return result;
  }

  replaceAll(
    sourceKey: string,
    records: SessionCatalogRecord[],
    metadata: { reconciledAt: number; incomplete: boolean; skippedCount: number },
    minimumRevision: number
  ): SqliteCatalogState {
    this.assertDatabaseVersion();
    const insert = this.database.prepare(`
      INSERT INTO sessions (
        path, session_id, cwd, cwd_key, explicit_name, search_name, search_path, search_id,
        modified_at_ms, message_count, parent_session_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.assertDatabaseVersion();
      const revision = Math.max(this.readState().revision, minimumRevision) + 1;
      this.database.exec("DELETE FROM sessions");
      for (const record of records) insert.run(...recordValues(record));
      this.database.prepare(`
        UPDATE catalog_state
        SET source_key = ?, revision = ?, reconciled_at_ms = ?, item_count = ?, incomplete = ?, skipped_count = ?
        WHERE singleton = 1
      `).run(
        sourceKey,
        revision,
        metadata.reconciledAt,
        records.length,
        metadata.incomplete ? 1 : 0,
        metadata.skippedCount
      );
      this.database.exec("COMMIT");
    } catch (error) {
      rollback(this.database);
      throw error;
    }
    const state = this.getState();
    try {
      removeSessionCatalogRecoverySync(this.recoveryPath);
    } catch {
      // Recovery cleanup is best-effort after the committed state is captured.
    }
    return state;
  }

  upsert(record: SessionCatalogRecord, minimumRevision: number): SqliteCatalogState {
    this.assertDatabaseVersion();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.assertDatabaseVersion();
      const revision = Math.max(this.readState().revision, minimumRevision) + 1;
      this.database.prepare(`
        INSERT INTO sessions (
          path, session_id, cwd, cwd_key, explicit_name, search_name, search_path, search_id,
          modified_at_ms, message_count, parent_session_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          session_id = excluded.session_id,
          cwd = excluded.cwd,
          cwd_key = excluded.cwd_key,
          explicit_name = excluded.explicit_name,
          search_name = excluded.search_name,
          search_path = excluded.search_path,
          search_id = excluded.search_id,
          modified_at_ms = excluded.modified_at_ms,
          message_count = excluded.message_count,
          parent_session_path = excluded.parent_session_path
      `).run(...recordValues(record));
      this.database.prepare(`
        UPDATE catalog_state
        SET revision = ?, item_count = (SELECT COUNT(*) FROM sessions)
        WHERE singleton = 1
      `).run(revision);
      this.database.exec("COMMIT");
    } catch (error) {
      rollback(this.database);
      throw error;
    }
    return this.getState();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  private assertDatabaseVersion(): void {
    const current = catalogDatabaseVersionFromRow(this.versionStatement.get());
    if (current.dataVersion !== this.openedVersion.dataVersion
      || current.schemaVersion !== this.openedVersion.schemaVersion) {
      throw new SessionCatalogChangedExternallyError();
    }
  }
}

function prepareCatalogForUse(database: DatabaseLike, create: boolean): CatalogDatabaseVersion {
  configureCatalogDatabase(database);
  database.exec("BEGIN IMMEDIATE");
  try {
    if (create) createCatalogSchema(database);
    else validateCatalogDatabase(database);
    const version = readCatalogDatabaseVersion(database);
    database.exec("COMMIT");
    return version;
  } catch (error) {
    rollback(database);
    throw error;
  }
}

function readCatalogDatabaseVersion(database: DatabaseLike): CatalogDatabaseVersion {
  return catalogDatabaseVersionFromRow(database.prepare(CATALOG_DATABASE_VERSION_SQL).get());
}

function catalogDatabaseVersionFromRow(row: Record<string, unknown> | undefined): CatalogDatabaseVersion {
  return {
    dataVersion: readInteger(row?.data_version, "data_version"),
    schemaVersion: readInteger(row?.schema_version, "schema_version")
  };
}

function classifySqliteFailure(error: unknown): "busy" | "replaceable" | "unavailable" {
  if (error instanceof SchemaMismatchError || error instanceof CorruptCatalogError) return "replaceable";
  const code = typeof error === "object" && error !== null && "errcode" in error
    ? Number((error as { errcode?: unknown }).errcode) & 0xff
    : undefined;
  if (code === 5 || code === 6) return "busy";
  if (code === 11 || code === 17 || code === 26) return "replaceable";
  return "unavailable";
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function readInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SchemaMismatchError(`Catalog ${field} is invalid.`);
  }
  return value;
}

async function loadNodeSqlite(): Promise<DatabaseConstructor> {
  const { DatabaseSync } = await import("node:sqlite");
  return DatabaseSync;
}

function rollback(database: DatabaseLike): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Preserve the original transaction failure.
  }
}

function safeClose(database: DatabaseLike | undefined): void {
  try {
    database?.close();
  } catch {
    // Open failures are reported as a bounded fallback state.
  }
}
