import {
  MAX_SESSION_CATALOG_ID_CHARS,
  MAX_SESSION_CATALOG_NAME_CHARS,
  MAX_SESSION_CATALOG_PATH_CHARS,
  MAX_SESSION_FILE_IDENTITY_CHARS
} from "@pi67/domain";
import { fingerprintSchemaSql, SchemaSqlFingerprintError } from "./sqlite-schema-fingerprint.js";
import { normalizeSessionCatalogWorkspaceIdentity } from "./session-path-identity.js";
import type { SessionCatalogRecord, SqliteCatalogState } from "./sqlite-session-catalog.js";

export const SESSION_CATALOG_SCHEMA_VERSION = 7;
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
  file_identity TEXT PRIMARY KEY CHECK (length(trim(file_identity)) BETWEEN 1 AND ${MAX_SESSION_FILE_IDENTITY_CHARS}),
  path TEXT NOT NULL UNIQUE CHECK (length(trim(path)) BETWEEN 1 AND ${MAX_SESSION_CATALOG_PATH_CHARS}),
  session_id TEXT NOT NULL CHECK (length(trim(session_id)) BETWEEN 1 AND ${MAX_SESSION_CATALOG_ID_CHARS}),
  cwd TEXT NOT NULL CHECK (length(trim(cwd)) BETWEEN 1 AND ${MAX_SESSION_CATALOG_PATH_CHARS}),
  cwd_key TEXT NOT NULL CHECK (length(trim(cwd_key)) BETWEEN 1 AND ${MAX_SESSION_CATALOG_PATH_CHARS}),
  explicit_name TEXT CHECK (explicit_name IS NULL OR length(trim(explicit_name)) BETWEEN 1 AND ${MAX_SESSION_CATALOG_NAME_CHARS}),
  automatic_name TEXT CHECK (automatic_name IS NULL OR length(trim(automatic_name)) BETWEEN 1 AND ${MAX_SESSION_CATALOG_NAME_CHARS}),
  automatic_name_source TEXT CHECK (
    (automatic_name IS NULL AND automatic_name_source IS NULL)
    OR (automatic_name IS NOT NULL AND automatic_name_source IN ('generated', 'seed'))
  ),
  search_name TEXT NOT NULL CHECK (length(search_name) > 0),
  search_path TEXT NOT NULL CHECK (length(search_path) > 0),
  search_id TEXT NOT NULL CHECK (length(search_id) > 0),
  modified_at_ms INTEGER NOT NULL CHECK (modified_at_ms >= 0),
  message_count INTEGER NOT NULL CHECK (message_count >= 0),
  parent_session_path TEXT CHECK (parent_session_path IS NULL OR length(trim(parent_session_path)) BETWEEN 1 AND ${MAX_SESSION_CATALOG_PATH_CHARS}),
  pinned_at_ms INTEGER CHECK (pinned_at_ms IS NULL OR pinned_at_ms >= 0),
  archived_at_ms INTEGER CHECK (archived_at_ms IS NULL OR archived_at_ms >= 0),
  snoozed_until_ms INTEGER CHECK (snoozed_until_ms IS NULL OR snoozed_until_ms >= 0)
) STRICT`;
const CONTENT_INDEX_STATE_TABLE_SQL = `CREATE TABLE content_index_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  salt TEXT NOT NULL CHECK (length(salt) = 64 AND salt = lower(salt))
) STRICT`;
const SESSION_CONTENT_VERSIONS_TABLE_SQL = `CREATE TABLE session_content_versions (
  file_identity TEXT PRIMARY KEY CHECK (length(trim(file_identity)) BETWEEN 1 AND ${MAX_SESSION_FILE_IDENTITY_CHARS}),
  projection_version TEXT NOT NULL CHECK (length(projection_version) BETWEEN 1 AND 128),
  indexed_entries INTEGER NOT NULL CHECK (indexed_entries >= 0),
  incomplete INTEGER NOT NULL CHECK (incomplete IN (0, 1))
) STRICT`;
const SESSION_CONTENT_MESSAGES_TABLE_SQL = `CREATE TABLE session_content_messages (
  file_identity TEXT NOT NULL CHECK (length(trim(file_identity)) BETWEEN 1 AND ${MAX_SESSION_FILE_IDENTITY_CHARS}),
  message_id TEXT NOT NULL CHECK (length(trim(message_id)) BETWEEN 1 AND 512),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  created_at_ms INTEGER CHECK (created_at_ms IS NULL OR created_at_ms >= 0),
  entry_order INTEGER NOT NULL CHECK (entry_order >= 0),
  content_fingerprint TEXT NOT NULL CHECK (length(content_fingerprint) = 64 AND content_fingerprint = lower(content_fingerprint)),
  PRIMARY KEY (file_identity, message_id)
) STRICT`;
const SESSION_CONTENT_TOKENS_TABLE_SQL = `CREATE TABLE session_content_tokens (
  file_identity TEXT NOT NULL CHECK (length(trim(file_identity)) BETWEEN 1 AND ${MAX_SESSION_FILE_IDENTITY_CHARS}),
  message_id TEXT NOT NULL CHECK (length(trim(message_id)) BETWEEN 1 AND 512),
  token_hash TEXT NOT NULL CHECK (length(token_hash) = 32 AND token_hash = lower(token_hash)),
  PRIMARY KEY (file_identity, message_id, token_hash)
) STRICT`;
const REQUIRED_SESSION_INDEXES = [
  {
    name: "sessions_workspace_organized",
    sql: "CREATE INDEX sessions_workspace_organized ON sessions(cwd_key, archived_at_ms, pinned_at_ms DESC, modified_at_ms DESC, path DESC)",
    columns: [
      { cid: 4, name: "cwd_key", descending: false },
      { cid: 15, name: "archived_at_ms", descending: false },
      { cid: 14, name: "pinned_at_ms", descending: true },
      { cid: 11, name: "modified_at_ms", descending: true },
      { cid: 1, name: "path", descending: true }
    ]
  },
  {
    name: "sessions_all_organized",
    sql: "CREATE INDEX sessions_all_organized ON sessions(archived_at_ms, pinned_at_ms DESC, modified_at_ms DESC, path DESC)",
    columns: [
      { cid: 15, name: "archived_at_ms", descending: false },
      { cid: 14, name: "pinned_at_ms", descending: true },
      { cid: 11, name: "modified_at_ms", descending: true },
      { cid: 1, name: "path", descending: true }
    ]
  }
] as const;
const REQUIRED_CONTENT_INDEXES = [
  {
    name: "session_content_messages_order",
    tableName: "session_content_messages",
    sql: "CREATE INDEX session_content_messages_order ON session_content_messages(file_identity, entry_order)",
    columns: [
      { cid: 0, name: "file_identity", descending: false },
      { cid: 4, name: "entry_order", descending: false }
    ]
  },
  {
    name: "session_content_tokens_hash",
    tableName: "session_content_tokens",
    sql: "CREATE INDEX session_content_tokens_hash ON session_content_tokens(token_hash, file_identity, message_id)",
    columns: [
      { cid: 2, name: "token_hash", descending: false },
      { cid: 0, name: "file_identity", descending: false },
      { cid: 1, name: "message_id", descending: false }
    ]
  }
] as const;
const REQUIRED_SCHEMA_OBJECTS = [
  ...[...REQUIRED_SESSION_INDEXES, ...REQUIRED_CONTENT_INDEXES].map((index) => ({
    type: "index",
    name: index.name,
    tableName: "tableName" in index ? index.tableName : "sessions",
    sql: index.sql
  })),
  { type: "table", name: "catalog_state", tableName: "catalog_state", sql: CATALOG_STATE_TABLE_SQL },
  { type: "table", name: "sessions", tableName: "sessions", sql: SESSIONS_TABLE_SQL },
  { type: "table", name: "content_index_state", tableName: "content_index_state", sql: CONTENT_INDEX_STATE_TABLE_SQL },
  { type: "table", name: "session_content_versions", tableName: "session_content_versions", sql: SESSION_CONTENT_VERSIONS_TABLE_SQL },
  { type: "table", name: "session_content_messages", tableName: "session_content_messages", sql: SESSION_CONTENT_MESSAGES_TABLE_SQL },
  { type: "table", name: "session_content_tokens", tableName: "session_content_tokens", sql: SESSION_CONTENT_TOKENS_TABLE_SQL }
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
  { name: "file_identity", type: "TEXT", notNull: 1, primaryKey: 1 },
  { name: "path", type: "TEXT", notNull: 1, primaryKey: 0 },
  { name: "session_id", type: "TEXT", notNull: 1, primaryKey: 0 },
  { name: "cwd", type: "TEXT", notNull: 1, primaryKey: 0 },
  { name: "cwd_key", type: "TEXT", notNull: 1, primaryKey: 0 },
  { name: "explicit_name", type: "TEXT", notNull: 0, primaryKey: 0 },
  { name: "automatic_name", type: "TEXT", notNull: 0, primaryKey: 0 },
  { name: "automatic_name_source", type: "TEXT", notNull: 0, primaryKey: 0 },
  { name: "search_name", type: "TEXT", notNull: 1, primaryKey: 0 },
  { name: "search_path", type: "TEXT", notNull: 1, primaryKey: 0 },
  { name: "search_id", type: "TEXT", notNull: 1, primaryKey: 0 },
  { name: "modified_at_ms", type: "INTEGER", notNull: 1, primaryKey: 0 },
  { name: "message_count", type: "INTEGER", notNull: 1, primaryKey: 0 },
  { name: "parent_session_path", type: "TEXT", notNull: 0, primaryKey: 0 },
  { name: "pinned_at_ms", type: "INTEGER", notNull: 0, primaryKey: 0 },
  { name: "archived_at_ms", type: "INTEGER", notNull: 0, primaryKey: 0 },
  { name: "snoozed_until_ms", type: "INTEGER", notNull: 0, primaryKey: 0 }
] as const;
const CONTENT_INDEX_STATE_COLUMNS = [
  { name: "singleton", type: "INTEGER", notNull: 0, primaryKey: 1 },
  { name: "salt", type: "TEXT", notNull: 1, primaryKey: 0 }
] as const;
const SESSION_CONTENT_VERSION_COLUMNS = [
  { name: "file_identity", type: "TEXT", notNull: 1, primaryKey: 1 },
  { name: "projection_version", type: "TEXT", notNull: 1, primaryKey: 0 },
  { name: "indexed_entries", type: "INTEGER", notNull: 1, primaryKey: 0 },
  { name: "incomplete", type: "INTEGER", notNull: 1, primaryKey: 0 }
] as const;
const SESSION_CONTENT_MESSAGE_COLUMNS = [
  { name: "file_identity", type: "TEXT", notNull: 1, primaryKey: 1 },
  { name: "message_id", type: "TEXT", notNull: 1, primaryKey: 2 },
  { name: "role", type: "TEXT", notNull: 1, primaryKey: 0 },
  { name: "created_at_ms", type: "INTEGER", notNull: 0, primaryKey: 0 },
  { name: "entry_order", type: "INTEGER", notNull: 1, primaryKey: 0 },
  { name: "content_fingerprint", type: "TEXT", notNull: 1, primaryKey: 0 }
] as const;
const SESSION_CONTENT_TOKEN_COLUMNS = [
  { name: "file_identity", type: "TEXT", notNull: 1, primaryKey: 1 },
  { name: "message_id", type: "TEXT", notNull: 1, primaryKey: 2 },
  { name: "token_hash", type: "TEXT", notNull: 1, primaryKey: 3 }
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
    ${CONTENT_INDEX_STATE_TABLE_SQL};
    ${SESSION_CONTENT_VERSIONS_TABLE_SQL};
    ${SESSION_CONTENT_MESSAGES_TABLE_SQL};
    ${SESSION_CONTENT_TOKENS_TABLE_SQL};
    ${REQUIRED_SESSION_INDEXES.map((index) => `${index.sql};`).join("\n")}
    ${REQUIRED_CONTENT_INDEXES.map((index) => `${index.sql};`).join("\n")}
    INSERT INTO catalog_state VALUES (1, '', 0, NULL, 0, 1, 0);
    INSERT INTO content_index_state VALUES (1, lower(hex(randomblob(32))));
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
  validateTable(database, "content_index_state", CONTENT_INDEX_STATE_COLUMNS);
  validateTable(database, "session_content_versions", SESSION_CONTENT_VERSION_COLUMNS);
  validateTable(database, "session_content_messages", SESSION_CONTENT_MESSAGE_COLUMNS);
  validateTable(database, "session_content_tokens", SESSION_CONTENT_TOKEN_COLUMNS);
  const implicitIndexes = validateIndexes(database);
  validateSchemaFingerprint(database, implicitIndexes);
  validateLogicalState(database);
}

export function recordValues(record: SessionCatalogRecord): SqlValue[] {
  return [
    record.fileIdentity,
    record.path,
    record.id,
    record.cwd,
    record.cwdKey,
    record.explicitName ?? null,
    record.automaticName ?? null,
    record.automaticName === undefined ? null : record.automaticNameSource ?? "seed",
    normalizeSearch(record.explicitName ?? record.automaticName ?? "Untitled session"),
    normalizeSearch(record.path),
    normalizeSearch(record.id),
    record.modifiedAt,
    record.messageCount,
    record.parentSessionPath ?? null,
    record.pinnedAt ?? null,
    record.archivedAt ?? null,
    record.snoozedUntil ?? null
  ];
}

export function recordFromRow(row: Record<string, unknown>): SessionCatalogRecord {
  const explicitName = readOptionalText(row.explicit_name, "explicit_name", MAX_SESSION_CATALOG_NAME_CHARS, true);
  const automaticName = readOptionalText(row.automatic_name, "automatic_name", MAX_SESSION_CATALOG_NAME_CHARS, true);
  const automaticNameSource = readOptionalText(row.automatic_name_source, "automatic_name_source", 16, true);
  if ((automaticName === undefined) !== (automaticNameSource === undefined)
    || (automaticNameSource !== undefined && automaticNameSource !== "generated" && automaticNameSource !== "seed")) {
    throw new SchemaMismatchError("automatic_name_source is invalid.");
  }
  const parentSessionPath = readOptionalText(
    row.parent_session_path,
    "parent_session_path",
    MAX_SESSION_CATALOG_PATH_CHARS
  );
  const pinnedAt = row.pinned_at_ms === null
    ? undefined
    : readNonNegativeInteger(row.pinned_at_ms, "pinned_at_ms");
  const archivedAt = row.archived_at_ms === null
    ? undefined
    : readNonNegativeInteger(row.archived_at_ms, "archived_at_ms");
  const snoozedUntil = row.snoozed_until_ms === null
    ? undefined
    : readNonNegativeInteger(row.snoozed_until_ms, "snoozed_until_ms");
  return {
    fileIdentity: readText(
      row.file_identity,
      "file_identity",
      MAX_SESSION_FILE_IDENTITY_CHARS
    ),
    id: readText(row.session_id, "session_id", MAX_SESSION_CATALOG_ID_CHARS),
    path: readText(row.path, "path", MAX_SESSION_CATALOG_PATH_CHARS),
    cwd: readText(row.cwd, "cwd", MAX_SESSION_CATALOG_PATH_CHARS),
    cwdKey: readText(row.cwd_key, "cwd_key", MAX_SESSION_CATALOG_PATH_CHARS),
    ...(explicitName === undefined ? {} : { explicitName }),
    ...(automaticName === undefined ? {} : { automaticName }),
    ...(automaticNameSource === undefined ? {} : { automaticNameSource }),
    modifiedAt: readNonNegativeInteger(row.modified_at_ms, "modified_at_ms"),
    messageCount: readNonNegativeInteger(row.message_count, "message_count"),
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
    ...(pinnedAt === undefined ? {} : { pinnedAt }),
    ...(archivedAt === undefined ? {} : { archivedAt }),
    ...(snoozedUntil === undefined ? {} : { snoozedUntil })
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
    WHERE length(trim(file_identity)) NOT BETWEEN 1 AND ${MAX_SESSION_FILE_IDENTITY_CHARS}
       OR length(trim(path)) NOT BETWEEN 1 AND ${MAX_SESSION_CATALOG_PATH_CHARS}
       OR length(trim(session_id)) NOT BETWEEN 1 AND ${MAX_SESSION_CATALOG_ID_CHARS}
       OR length(trim(cwd)) NOT BETWEEN 1 AND ${MAX_SESSION_CATALOG_PATH_CHARS}
       OR length(trim(cwd_key)) NOT BETWEEN 1 AND ${MAX_SESSION_CATALOG_PATH_CHARS}
       OR (explicit_name IS NOT NULL AND length(trim(explicit_name)) NOT BETWEEN 1 AND ${MAX_SESSION_CATALOG_NAME_CHARS})
       OR (automatic_name IS NOT NULL AND length(trim(automatic_name)) NOT BETWEEN 1 AND ${MAX_SESSION_CATALOG_NAME_CHARS})
       OR NOT ((automatic_name IS NULL AND automatic_name_source IS NULL)
         OR (automatic_name IS NOT NULL AND automatic_name_source IN ('generated', 'seed')))
       OR length(search_name) = 0 OR length(search_path) = 0 OR length(search_id) = 0
       OR modified_at_ms < 0 OR message_count < 0
       OR (pinned_at_ms IS NOT NULL AND pinned_at_ms < 0)
       OR (archived_at_ms IS NOT NULL AND archived_at_ms < 0)
       OR (snoozed_until_ms IS NOT NULL AND snoozed_until_ms < 0)
       OR (parent_session_path IS NOT NULL AND length(trim(parent_session_path)) NOT BETWEEN 1 AND ${MAX_SESSION_CATALOG_PATH_CHARS})
  `).get()?.total, "invalid rows");
  if (invalid > 0) throw new SchemaMismatchError("Catalog contains invalid session metadata.");
  validateContentIndexState(database);
  validateDerivedSessionMetadata(database);
}

function validateContentIndexState(database: DatabaseLike): void {
  const stateRows = database.prepare("SELECT singleton, salt FROM content_index_state").all();
  const salt = stateRows[0]?.salt;
  if (stateRows.length !== 1
    || readNonNegativeInteger(stateRows[0]?.singleton, "content index singleton") !== 1
    || typeof salt !== "string"
    || !/^[0-9a-f]{64}$/u.test(salt)) {
    throw new SchemaMismatchError("Content index state is invalid.");
  }
  const invalidVersions = readNonNegativeInteger(database.prepare(`
    SELECT COUNT(*) AS total FROM session_content_versions
    WHERE length(trim(file_identity)) NOT BETWEEN 1 AND ${MAX_SESSION_FILE_IDENTITY_CHARS}
       OR length(projection_version) NOT BETWEEN 1 AND 128
       OR indexed_entries < 0
       OR incomplete NOT IN (0, 1)
  `).get()?.total, "invalid content versions");
  const invalidMessages = readNonNegativeInteger(database.prepare(`
    SELECT COUNT(*) AS total FROM session_content_messages
    WHERE length(trim(file_identity)) NOT BETWEEN 1 AND ${MAX_SESSION_FILE_IDENTITY_CHARS}
       OR length(trim(message_id)) NOT BETWEEN 1 AND 512
       OR role NOT IN ('user', 'assistant')
       OR (created_at_ms IS NOT NULL AND created_at_ms < 0)
       OR entry_order < 0
       OR length(content_fingerprint) <> 64
       OR content_fingerprint <> lower(content_fingerprint)
  `).get()?.total, "invalid content messages");
  const invalidTokens = readNonNegativeInteger(database.prepare(`
    SELECT COUNT(*) AS total FROM session_content_tokens
    WHERE length(trim(file_identity)) NOT BETWEEN 1 AND ${MAX_SESSION_FILE_IDENTITY_CHARS}
       OR length(trim(message_id)) NOT BETWEEN 1 AND 512
       OR length(token_hash) <> 32
       OR token_hash <> lower(token_hash)
  `).get()?.total, "invalid content tokens");
  const orphanMessages = readNonNegativeInteger(database.prepare(`
    SELECT COUNT(*) AS total
    FROM session_content_messages AS messages
    LEFT JOIN session_content_versions AS versions USING (file_identity)
    WHERE versions.file_identity IS NULL
  `).get()?.total, "orphan content messages");
  const orphanVersions = readNonNegativeInteger(database.prepare(`
    SELECT COUNT(*) AS total
    FROM session_content_versions AS versions
    LEFT JOIN sessions USING (file_identity)
    WHERE sessions.file_identity IS NULL
  `).get()?.total, "orphan content versions");
  const orphanTokens = readNonNegativeInteger(database.prepare(`
    SELECT COUNT(*) AS total
    FROM session_content_tokens AS tokens
    LEFT JOIN session_content_messages AS messages USING (file_identity, message_id)
    WHERE messages.message_id IS NULL
  `).get()?.total, "orphan content tokens");
  const mismatchedEntryCounts = readNonNegativeInteger(database.prepare(`
    SELECT COUNT(*) AS total
    FROM session_content_versions AS versions
    LEFT JOIN (
      SELECT file_identity, COUNT(*) AS message_count
      FROM session_content_messages
      GROUP BY file_identity
    ) AS messages USING (file_identity)
    WHERE versions.indexed_entries <> COALESCE(messages.message_count, 0)
  `).get()?.total, "mismatched content entry counts");
  if (invalidVersions + invalidMessages + invalidTokens + orphanVersions
    + orphanMessages + orphanTokens + mismatchedEntryCounts > 0) {
    throw new SchemaMismatchError("Content index projection is inconsistent.");
  }
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
    SELECT file_identity, path, session_id, cwd, cwd_key, explicit_name, automatic_name, automatic_name_source, search_name, search_path, search_id,
           modified_at_ms, message_count, parent_session_path, pinned_at_ms, archived_at_ms,
           snoozed_until_ms
    FROM sessions
  `).all();
  for (const row of rows) {
    const record = recordFromRow(row);
    const expected = recordValues(record);
    if (row.cwd_key !== normalizeSessionCatalogWorkspaceIdentity(record.cwd)
      || row.search_name !== expected[8]
      || row.search_path !== expected[9]
      || row.search_id !== expected[10]) {
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

function validateSchemaFingerprint(
  database: DatabaseLike,
  implicitIndexes: readonly { name: string; tableName: string }[]
): void {
  const actual = database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM main.sqlite_schema
  `).all();
  if (actual.length !== REQUIRED_SCHEMA_OBJECTS.length + implicitIndexes.length) {
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
  for (const implicit of implicitIndexes) {
    const index = byIdentity.get(`index:${implicit.name}`);
    if (!index || index.tbl_name !== implicit.tableName || index.sql !== null) {
      throw new SchemaMismatchError("Catalog implicit index schema object does not match.");
    }
  }
}

function validateIndexes(database: DatabaseLike): Array<{ name: string; tableName: string }> {
  const indexes = database.prepare("PRAGMA index_list(sessions)").all();
  if (database.prepare("PRAGMA index_list(catalog_state)").all().length !== 0
    || indexes.length !== REQUIRED_SESSION_INDEXES.length + 2) {
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
  const primaryIndex = validateImplicitIndex(database, indexes, "pk", "file_identity", 0);
  const pathIndex = validateImplicitIndex(database, indexes, "u", "path", 1);
  const versionIndexes = database.prepare("PRAGMA index_list(session_content_versions)").all();
  const messageIndexes = database.prepare("PRAGMA index_list(session_content_messages)").all();
  const tokenIndexes = database.prepare("PRAGMA index_list(session_content_tokens)").all();
  if (database.prepare("PRAGMA index_list(content_index_state)").all().length !== 0
    || versionIndexes.length !== 1
    || messageIndexes.length !== 2
    || tokenIndexes.length !== 2) {
    throw new SchemaMismatchError("Content index inventory does not match.");
  }
  validateRequiredContentIndex(database, messageIndexes, REQUIRED_CONTENT_INDEXES[0]);
  validateRequiredContentIndex(database, tokenIndexes, REQUIRED_CONTENT_INDEXES[1]);
  const versionPrimary = validateImplicitCompositeIndex(
    database,
    versionIndexes,
    [{ cid: 0, name: "file_identity" }]
  );
  const messagePrimary = validateImplicitCompositeIndex(database, messageIndexes, [
    { cid: 0, name: "file_identity" },
    { cid: 1, name: "message_id" }
  ]);
  const tokenPrimary = validateImplicitCompositeIndex(database, tokenIndexes, [
    { cid: 0, name: "file_identity" },
    { cid: 1, name: "message_id" },
    { cid: 2, name: "token_hash" }
  ]);
  return [
    { name: primaryIndex, tableName: "sessions" },
    { name: pathIndex, tableName: "sessions" },
    { name: versionPrimary, tableName: "session_content_versions" },
    { name: messagePrimary, tableName: "session_content_messages" },
    { name: tokenPrimary, tableName: "session_content_tokens" }
  ];
}

function validateRequiredContentIndex(
  database: DatabaseLike,
  indexes: Record<string, unknown>[],
  required: (typeof REQUIRED_CONTENT_INDEXES)[number]
): void {
  const index = indexes.find((row) => row.name === required.name);
  if (!index || index.origin !== "c" || index.unique !== 0 || index.partial !== 0) {
    throw new SchemaMismatchError(`Content index ${required.name} does not match.`);
  }
  const columns = database.prepare(`PRAGMA index_xinfo(${required.name})`).all()
    .filter((row) => row.key === 1);
  if (columns.length !== required.columns.length || required.columns.some((expected, position) => {
    const column = columns[position];
    return column?.seqno !== position
      || column.cid !== expected.cid
      || column.name !== expected.name
      || column.desc !== 0
      || column.coll !== "BINARY";
  })) throw new SchemaMismatchError(`Content index ${required.name} does not match.`);
}

function validateImplicitCompositeIndex(
  database: DatabaseLike,
  indexes: Record<string, unknown>[],
  expectedColumns: readonly { cid: number; name: string }[]
): string {
  const matches = indexes.filter((index) => index.origin === "pk");
  const index = matches[0];
  if (matches.length !== 1 || typeof index?.name !== "string" || index.unique !== 1 || index.partial !== 0) {
    throw new SchemaMismatchError("Content index primary identity does not match.");
  }
  const columns = database.prepare(`PRAGMA index_xinfo(${index.name})`).all()
    .filter((row) => row.key === 1);
  if (columns.length !== expectedColumns.length || expectedColumns.some((expected, position) => {
    const column = columns[position];
    return column?.seqno !== position
      || column.cid !== expected.cid
      || column.name !== expected.name
      || column.desc !== 0
      || column.coll !== "BINARY";
  })) throw new SchemaMismatchError("Content index primary identity does not match.");
  return index.name;
}

function validateImplicitIndex(
  database: DatabaseLike,
  indexes: Record<string, unknown>[],
  origin: "pk" | "u",
  columnName: string,
  columnId: number
): string {
  const matches = indexes.filter((index) => index.origin === origin);
  const index = matches[0];
  if (matches.length !== 1
    || typeof index?.name !== "string"
    || index.unique !== 1
    || index.partial !== 0) {
    throw new SchemaMismatchError(`Catalog ${columnName} identity index does not match.`);
  }
  const columns = database.prepare(`PRAGMA index_xinfo(${index.name})`).all()
    .filter((row) => row.key === 1);
  const column = columns[0];
  if (columns.length !== 1
    || column?.seqno !== 0
    || column.cid !== columnId
    || column.name !== columnName
    || column.desc !== 0
    || column.coll !== "BINARY") {
    throw new SchemaMismatchError(`Catalog ${columnName} identity index does not match.`);
  }
  return index.name;
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
