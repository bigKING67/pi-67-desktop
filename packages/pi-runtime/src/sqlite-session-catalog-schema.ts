import {
  MAX_SESSION_CATALOG_ID_CHARS,
  MAX_SESSION_CATALOG_NAME_CHARS,
  MAX_SESSION_CATALOG_PATH_CHARS
} from "@pi67/domain";
import { fingerprintSchemaSql, SchemaSqlFingerprintError } from "./sqlite-schema-fingerprint.js";
import { normalizeSessionCatalogPathIdentity } from "./session-path-identity.js";
import type { SessionCatalogRecord, SqliteCatalogState } from "./sqlite-session-catalog.js";

const SESSION_CATALOG_SCHEMA_VERSION = 1;
const SQLITE_BUSY_TIMEOUT_MS = 100;
const CATALOG_STATE_TABLE_SQL = `CREATE TABLE catalog_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  source_key TEXT NOT NULL CHECK (source_key = '' OR length(trim(source_key)) BETWEEN 1 AND 512),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  reconciled_at_ms INTEGER CHECK (reconciled_at_ms IS NULL OR reconciled_at_ms >= 0),
  item_count INTEGER NOT NULL CHECK (item_count >= 0),
  incomplete INTEGER NOT NULL CHECK (incomplete IN (0, 1)),
  skipped_count INTEGER NOT NULL CHECK (skipped_count >= 0)
) STRICT`;
const SESSIONS_TABLE_SQL = `CREATE TABLE sessions (
  path TEXT PRIMARY KEY CHECK (length(trim(path)) BETWEEN 1 AND ${MAX_SESSION_CATALOG_PATH_CHARS}),
  session_id TEXT NOT NULL CHECK (length(trim(session_id)) BETWEEN 1 AND ${MAX_SESSION_CATALOG_ID_CHARS}),
  cwd TEXT NOT NULL CHECK (length(trim(cwd)) BETWEEN 1 AND ${MAX_SESSION_CATALOG_PATH_CHARS}),
  cwd_key TEXT NOT NULL CHECK (length(trim(cwd_key)) BETWEEN 1 AND ${MAX_SESSION_CATALOG_PATH_CHARS}),
  explicit_name TEXT CHECK (explicit_name IS NULL OR length(trim(explicit_name)) BETWEEN 1 AND ${MAX_SESSION_CATALOG_NAME_CHARS}),
  search_name TEXT NOT NULL CHECK (length(search_name) > 0),
  search_path TEXT NOT NULL CHECK (length(search_path) > 0),
  search_id TEXT NOT NULL CHECK (length(search_id) > 0),
  modified_at_ms INTEGER NOT NULL CHECK (modified_at_ms >= 0),
  message_count INTEGER NOT NULL CHECK (message_count >= 0),
  parent_session_path TEXT CHECK (parent_session_path IS NULL OR length(trim(parent_session_path)) BETWEEN 1 AND ${MAX_SESSION_CATALOG_PATH_CHARS})
) STRICT`;
const REQUIRED_SESSION_INDEXES = [
  {
    name: "sessions_workspace_recent",
    sql: "CREATE INDEX sessions_workspace_recent ON sessions(cwd_key, modified_at_ms DESC, path DESC)",
    columns: [
      { cid: 3, name: "cwd_key", descending: false },
      { cid: 8, name: "modified_at_ms", descending: true },
      { cid: 0, name: "path", descending: true }
    ]
  },
  {
    name: "sessions_all_recent",
    sql: "CREATE INDEX sessions_all_recent ON sessions(modified_at_ms DESC, path DESC)",
    columns: [
      { cid: 8, name: "modified_at_ms", descending: true },
      { cid: 0, name: "path", descending: true }
    ]
  }
] as const;
const REQUIRED_SCHEMA_OBJECTS = [
  ...REQUIRED_SESSION_INDEXES.map((index) => ({
    type: "index",
    name: index.name,
    tableName: "sessions",
    sql: index.sql
  })),
  { type: "table", name: "catalog_state", tableName: "catalog_state", sql: CATALOG_STATE_TABLE_SQL },
  { type: "table", name: "sessions", tableName: "sessions", sql: SESSIONS_TABLE_SQL }
].map((object) => ({ ...object, fingerprint: fingerprintSchemaSql(object.sql) }));
const CATALOG_STATE_COLUMNS = [
  { name: "singleton", type: "INTEGER", notNull: 0, primaryKey: 1 },
  { name: "source_key", type: "TEXT", notNull: 1, primaryKey: 0 },
  { name: "revision", type: "INTEGER", notNull: 1, primaryKey: 0 },
  { name: "reconciled_at_ms", type: "INTEGER", notNull: 0, primaryKey: 0 },
  { name: "item_count", type: "INTEGER", notNull: 1, primaryKey: 0 },
  { name: "incomplete", type: "INTEGER", notNull: 1, primaryKey: 0 },
  { name: "skipped_count", type: "INTEGER", notNull: 1, primaryKey: 0 }
] as const;
const SESSION_COLUMNS = [
  { name: "path", type: "TEXT", notNull: 1, primaryKey: 1 },
  { name: "session_id", type: "TEXT", notNull: 1, primaryKey: 0 },
  { name: "cwd", type: "TEXT", notNull: 1, primaryKey: 0 },
  { name: "cwd_key", type: "TEXT", notNull: 1, primaryKey: 0 },
  { name: "explicit_name", type: "TEXT", notNull: 0, primaryKey: 0 },
  { name: "search_name", type: "TEXT", notNull: 1, primaryKey: 0 },
  { name: "search_path", type: "TEXT", notNull: 1, primaryKey: 0 },
  { name: "search_id", type: "TEXT", notNull: 1, primaryKey: 0 },
  { name: "modified_at_ms", type: "INTEGER", notNull: 1, primaryKey: 0 },
  { name: "message_count", type: "INTEGER", notNull: 1, primaryKey: 0 },
  { name: "parent_session_path", type: "TEXT", notNull: 0, primaryKey: 0 }
] as const;

interface StatementLike {
  all(...values: SqlValue[]): Record<string, unknown>[];
  get(...values: SqlValue[]): Record<string, unknown> | undefined;
  run(...values: SqlValue[]): unknown;
}

export interface DatabaseLike {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): StatementLike;
}

export interface DatabaseConstructor {
  new(location: string): DatabaseLike;
}

export type SqlValue = null | number | string;

export class SchemaMismatchError extends Error {}
export class CorruptCatalogError extends Error {}

export function configureCatalogDatabase(database: DatabaseLike): void {
  database.exec(`
    PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};
    PRAGMA journal_mode = DELETE;
    PRAGMA trusted_schema = OFF;
  `);
}

export function createCatalogSchema(database: DatabaseLike): void {
  database.exec(`
    ${CATALOG_STATE_TABLE_SQL};
    ${SESSIONS_TABLE_SQL};
    ${REQUIRED_SESSION_INDEXES.map((index) => `${index.sql};`).join("\n")}
    INSERT INTO catalog_state VALUES (1, '', 0, NULL, 0, 1, 0);
    PRAGMA user_version = ${SESSION_CATALOG_SCHEMA_VERSION};
  `);
  validateCatalogDatabase(database);
}

export function validateCatalogDatabase(database: DatabaseLike): void {
  const version = database.prepare("PRAGMA user_version").get();
  if (readNonNegativeInteger(version?.user_version, "user_version") !== SESSION_CATALOG_SCHEMA_VERSION) {
    throw new SchemaMismatchError("Catalog schema version does not match.");
  }
  const check = database.prepare("PRAGMA quick_check").get();
  if (check?.quick_check !== "ok") throw new CorruptCatalogError("Catalog integrity check failed.");
  validateTable(database, "catalog_state", CATALOG_STATE_COLUMNS);
  validateTable(database, "sessions", SESSION_COLUMNS);
  const primaryKeyIndex = validateSessionIndexes(database);
  validateSchemaFingerprint(database, primaryKeyIndex);
  validateLogicalState(database);
}

export function recordValues(record: SessionCatalogRecord): SqlValue[] {
  return [
    record.path,
    record.id,
    record.cwd,
    record.cwdKey,
    record.explicitName ?? null,
    normalizeSearch(record.explicitName ?? "Untitled session"),
    normalizeSearch(record.path),
    normalizeSearch(record.id),
    record.modifiedAt,
    record.messageCount,
    record.parentSessionPath ?? null
  ];
}

export function recordFromRow(row: Record<string, unknown>): SessionCatalogRecord {
  const explicitName = readOptionalText(row.explicit_name, "explicit_name", MAX_SESSION_CATALOG_NAME_CHARS, true);
  const parentSessionPath = readOptionalText(
    row.parent_session_path,
    "parent_session_path",
    MAX_SESSION_CATALOG_PATH_CHARS
  );
  return {
    id: readText(row.session_id, "session_id", MAX_SESSION_CATALOG_ID_CHARS),
    path: readText(row.path, "path", MAX_SESSION_CATALOG_PATH_CHARS),
    cwd: readText(row.cwd, "cwd", MAX_SESSION_CATALOG_PATH_CHARS),
    cwdKey: readText(row.cwd_key, "cwd_key", MAX_SESSION_CATALOG_PATH_CHARS),
    ...(explicitName === undefined ? {} : { explicitName }),
    modifiedAt: readNonNegativeInteger(row.modified_at_ms, "modified_at_ms"),
    messageCount: readNonNegativeInteger(row.message_count, "message_count"),
    ...(parentSessionPath === undefined ? {} : { parentSessionPath })
  };
}

export function stateFromRow(row: Record<string, unknown>): SqliteCatalogState {
  const reconciledAt = row.reconciled_at_ms === null
    ? undefined
    : readNonNegativeInteger(row.reconciled_at_ms, "reconciled_at_ms");
  const incomplete = readNonNegativeInteger(row.incomplete, "incomplete");
  if (incomplete !== 0 && incomplete !== 1) throw new SchemaMismatchError("Catalog incomplete is invalid.");
  return {
    sourceKey: readString(row.source_key, "source_key", 512),
    revision: readNonNegativeInteger(row.revision, "revision"),
    ...(reconciledAt === undefined ? {} : { reconciledAt }),
    itemCount: readNonNegativeInteger(row.item_count, "item_count"),
    incomplete: incomplete === 1,
    skippedCount: readNonNegativeInteger(row.skipped_count, "skipped_count")
  };
}

function validateLogicalState(database: DatabaseLike): void {
  const rows = database.prepare(`
    SELECT singleton, source_key, revision, reconciled_at_ms, item_count, incomplete, skipped_count
    FROM catalog_state
  `).all();
  if (rows.length !== 1 || readNonNegativeInteger(rows[0]?.singleton, "singleton") !== 1) {
    throw new SchemaMismatchError("Catalog must contain exactly one canonical state row.");
  }
  const row = rows[0]!;
  const state = stateFromRow(row);
  const total = readNonNegativeInteger(
    database.prepare("SELECT COUNT(*) AS total FROM sessions").get()?.total,
    "total"
  );
  if (state.itemCount !== total || !isConsistentCatalogState(state, total)) {
    throw new SchemaMismatchError("Catalog state does not match stored sessions.");
  }
  const invalid = readNonNegativeInteger(database.prepare(`
    SELECT COUNT(*) AS total FROM sessions
    WHERE length(trim(path)) NOT BETWEEN 1 AND ${MAX_SESSION_CATALOG_PATH_CHARS}
       OR length(trim(session_id)) NOT BETWEEN 1 AND ${MAX_SESSION_CATALOG_ID_CHARS}
       OR length(trim(cwd)) NOT BETWEEN 1 AND ${MAX_SESSION_CATALOG_PATH_CHARS}
       OR length(trim(cwd_key)) NOT BETWEEN 1 AND ${MAX_SESSION_CATALOG_PATH_CHARS}
       OR (explicit_name IS NOT NULL AND length(trim(explicit_name)) NOT BETWEEN 1 AND ${MAX_SESSION_CATALOG_NAME_CHARS})
       OR length(search_name) = 0 OR length(search_path) = 0 OR length(search_id) = 0
       OR modified_at_ms < 0 OR message_count < 0
       OR (parent_session_path IS NOT NULL AND length(trim(parent_session_path)) NOT BETWEEN 1 AND ${MAX_SESSION_CATALOG_PATH_CHARS})
  `).get()?.total, "invalid rows");
  if (invalid > 0) throw new SchemaMismatchError("Catalog contains invalid session metadata.");
  validateDerivedSessionMetadata(database);
}

function isConsistentCatalogState(state: SqliteCatalogState, total: number): boolean {
  if (state.sourceKey.length === 0) {
    return state.revision === 0
      && state.reconciledAt === undefined
      && total === 0
      && state.incomplete
      && state.skippedCount === 0;
  }
  return state.sourceKey.trim().length > 0
    && state.revision >= 1
    && state.reconciledAt !== undefined
    && (state.skippedCount === 0 || state.incomplete);
}

function validateDerivedSessionMetadata(database: DatabaseLike): void {
  const rows = database.prepare(`
    SELECT path, session_id, cwd, cwd_key, explicit_name, search_name, search_path, search_id,
           modified_at_ms, message_count, parent_session_path
    FROM sessions
  `).all();
  for (const row of rows) {
    const record = recordFromRow(row);
    const expected = recordValues(record);
    if (row.cwd_key !== normalizeSessionCatalogPathIdentity(record.cwd)
      || row.search_name !== expected[5]
      || row.search_path !== expected[6]
      || row.search_id !== expected[7]) {
      throw new SchemaMismatchError("Catalog derived session metadata is invalid.");
    }
  }
}

function validateTable(
  database: DatabaseLike,
  name: string,
  columns: readonly { name: string; type: string; notNull: number; primaryKey: number }[]
): void {
  const table = database.prepare("PRAGMA table_list").all()
    .find((row) => row.schema === "main" && row.name === name);
  const actual = database.prepare(`PRAGMA table_xinfo(${name})`).all();
  if (table?.type !== "table"
    || table.strict !== 1
    || table.wr !== 0
    || table.ncol !== columns.length
    || actual.length !== columns.length
    || columns.some((expected, index) => {
      const column = actual[index];
      return column?.cid !== index
        || column.name !== expected.name
        || column.type !== expected.type
        || column.notnull !== expected.notNull
        || column.dflt_value !== null
        || column.pk !== expected.primaryKey
        || column.hidden !== 0;
    })
    || database.prepare(`PRAGMA foreign_key_list(${name})`).all().length !== 0) {
    throw new SchemaMismatchError(`Catalog table ${name} does not match.`);
  }
}

function validateSchemaFingerprint(database: DatabaseLike, primaryKeyIndex: string): void {
  const actual = database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM main.sqlite_schema
  `).all();
  if (actual.length !== REQUIRED_SCHEMA_OBJECTS.length + 1) {
    throw new SchemaMismatchError("Catalog schema object inventory does not match.");
  }
  const byIdentity = new Map(actual.map((row) => [`${String(row.type)}:${String(row.name)}`, row]));
  if (byIdentity.size !== actual.length) {
    throw new SchemaMismatchError("Catalog schema object inventory is ambiguous.");
  }
  for (const expected of REQUIRED_SCHEMA_OBJECTS) {
    const row = byIdentity.get(`${expected.type}:${expected.name}`);
    if (!row || row.tbl_name !== expected.tableName || typeof row.sql !== "string") {
      throw new SchemaMismatchError("Catalog schema fingerprint does not match.");
    }
    try {
      if (fingerprintSchemaSql(row.sql) !== expected.fingerprint) {
        throw new SchemaMismatchError("Catalog schema fingerprint does not match.");
      }
    } catch (error) {
      if (error instanceof SchemaMismatchError) throw error;
      if (error instanceof SchemaSqlFingerprintError) {
        throw new SchemaMismatchError("Catalog schema SQL is malformed.");
      }
      throw error;
    }
  }
  const primaryKey = byIdentity.get(`index:${primaryKeyIndex}`);
  if (!primaryKey || primaryKey.tbl_name !== "sessions" || primaryKey.sql !== null) {
    throw new SchemaMismatchError("Catalog primary-key schema object does not match.");
  }
}

function validateSessionIndexes(database: DatabaseLike): string {
  const indexes = database.prepare("PRAGMA index_list(sessions)").all();
  if (database.prepare("PRAGMA index_list(catalog_state)").all().length !== 0
    || indexes.length !== REQUIRED_SESSION_INDEXES.length + 1) {
    throw new SchemaMismatchError("Catalog index inventory does not match.");
  }
  for (const required of REQUIRED_SESSION_INDEXES) {
    const index = indexes.find((row) => row.name === required.name);
    if (!index
      || index.origin !== "c"
      || readNonNegativeInteger(index.unique, `${required.name} unique`) !== 0
      || readNonNegativeInteger(index.partial, `${required.name} partial`) !== 0) {
      throw new SchemaMismatchError(`Catalog index ${required.name} does not match.`);
    }
    const columns = database.prepare(`PRAGMA index_xinfo(${required.name})`).all()
      .filter((row) => row.key === 1);
    if (columns.length !== required.columns.length || required.columns.some((expected, position) => {
      const column = columns[position];
      return column?.seqno !== position
        || column.cid !== expected.cid
        || column.name !== expected.name
        || column.desc !== (expected.descending ? 1 : 0)
        || column.coll !== "BINARY";
    })) {
      throw new SchemaMismatchError(`Catalog index ${required.name} does not match.`);
    }
  }
  const primaryIndexes = indexes.filter((index) => index.origin === "pk");
  const primaryIndex = primaryIndexes[0];
  if (primaryIndexes.length !== 1
    || typeof primaryIndex?.name !== "string"
    || primaryIndex.unique !== 1
    || primaryIndex.partial !== 0) {
    throw new SchemaMismatchError("Catalog primary-key index does not match.");
  }
  const primaryColumns = database.prepare(`PRAGMA index_xinfo(${primaryIndex.name})`).all()
    .filter((row) => row.key === 1);
  const primaryColumn = primaryColumns[0];
  if (primaryColumns.length !== 1
    || primaryColumn?.seqno !== 0
    || primaryColumn.cid !== 0
    || primaryColumn.name !== "path"
    || primaryColumn.desc !== 0
    || primaryColumn.coll !== "BINARY") {
    throw new SchemaMismatchError("Catalog primary-key index does not match.");
  }
  return primaryIndex.name;
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function readString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) {
    throw new SchemaMismatchError(`Catalog ${field} is invalid.`);
  }
  return value;
}

function readText(value: unknown, field: string, maximum: number, trim = false): string {
  const text = readString(value, field, maximum);
  if (text.trim().length === 0) throw new SchemaMismatchError(`Catalog ${field} is invalid.`);
  return trim ? text.trim() : text;
}

function readOptionalText(
  value: unknown,
  field: string,
  maximum: number,
  trim = false
): string | undefined {
  if (value === null) return undefined;
  return readText(value, field, maximum, trim);
}

function readNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SchemaMismatchError(`Catalog ${field} is invalid.`);
  }
  return value;
}
