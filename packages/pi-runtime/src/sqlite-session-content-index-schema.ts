import { MAX_SESSION_FILE_IDENTITY_CHARS } from "@pi67/domain";
import {
  readNonNegativeInteger,
  SchemaMismatchError,
  type DatabaseLike
} from "./sqlite-session-catalog-schema-core.js";

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

const REQUIRED_CONTENT_INDEXES = [
  {
    name: "session_content_messages_order",
    tableName: "session_content_messages",
    sql: "CREATE INDEX session_content_messages_order ON session_content_messages(file_identity, entry_order)",
    columns: [
      { cid: 0, name: "file_identity" },
      { cid: 4, name: "entry_order" }
    ]
  },
  {
    name: "session_content_tokens_hash",
    tableName: "session_content_tokens",
    sql: "CREATE INDEX session_content_tokens_hash ON session_content_tokens(token_hash, file_identity, message_id)",
    columns: [
      { cid: 2, name: "token_hash" },
      { cid: 0, name: "file_identity" },
      { cid: 1, name: "message_id" }
    ]
  }
] as const;

export const CONTENT_INDEX_SCHEMA_SQL = `
  ${CONTENT_INDEX_STATE_TABLE_SQL};
  ${SESSION_CONTENT_VERSIONS_TABLE_SQL};
  ${SESSION_CONTENT_MESSAGES_TABLE_SQL};
  ${SESSION_CONTENT_TOKENS_TABLE_SQL};
  ${REQUIRED_CONTENT_INDEXES.map((index) => `${index.sql};`).join("\n")}
  INSERT INTO content_index_state VALUES (1, lower(hex(randomblob(32))));
`;

export const CONTENT_INDEX_SCHEMA_OBJECTS = [
  ...REQUIRED_CONTENT_INDEXES.map((index) => ({
    type: "index",
    name: index.name,
    tableName: index.tableName,
    sql: index.sql
  })),
  {
    type: "table",
    name: "content_index_state",
    tableName: "content_index_state",
    sql: CONTENT_INDEX_STATE_TABLE_SQL
  },
  {
    type: "table",
    name: "session_content_versions",
    tableName: "session_content_versions",
    sql: SESSION_CONTENT_VERSIONS_TABLE_SQL
  },
  {
    type: "table",
    name: "session_content_messages",
    tableName: "session_content_messages",
    sql: SESSION_CONTENT_MESSAGES_TABLE_SQL
  },
  {
    type: "table",
    name: "session_content_tokens",
    tableName: "session_content_tokens",
    sql: SESSION_CONTENT_TOKENS_TABLE_SQL
  }
] as const;

export const CONTENT_INDEX_TABLES = [
  {
    name: "content_index_state",
    columns: [
      { name: "singleton", type: "INTEGER", notNull: 0, primaryKey: 1 },
      { name: "salt", type: "TEXT", notNull: 1, primaryKey: 0 }
    ]
  },
  {
    name: "session_content_versions",
    columns: [
      { name: "file_identity", type: "TEXT", notNull: 1, primaryKey: 1 },
      { name: "projection_version", type: "TEXT", notNull: 1, primaryKey: 0 },
      { name: "indexed_entries", type: "INTEGER", notNull: 1, primaryKey: 0 },
      { name: "incomplete", type: "INTEGER", notNull: 1, primaryKey: 0 }
    ]
  },
  {
    name: "session_content_messages",
    columns: [
      { name: "file_identity", type: "TEXT", notNull: 1, primaryKey: 1 },
      { name: "message_id", type: "TEXT", notNull: 1, primaryKey: 2 },
      { name: "role", type: "TEXT", notNull: 1, primaryKey: 0 },
      { name: "created_at_ms", type: "INTEGER", notNull: 0, primaryKey: 0 },
      { name: "entry_order", type: "INTEGER", notNull: 1, primaryKey: 0 },
      { name: "content_fingerprint", type: "TEXT", notNull: 1, primaryKey: 0 }
    ]
  },
  {
    name: "session_content_tokens",
    columns: [
      { name: "file_identity", type: "TEXT", notNull: 1, primaryKey: 1 },
      { name: "message_id", type: "TEXT", notNull: 1, primaryKey: 2 },
      { name: "token_hash", type: "TEXT", notNull: 1, primaryKey: 3 }
    ]
  }
] as const;

export function validateContentIndexState(database: DatabaseLike): void {
  const stateRows = database.prepare("SELECT singleton, salt FROM content_index_state").all();
  const salt = stateRows[0]?.salt;
  if (stateRows.length !== 1
    || readNonNegativeInteger(stateRows[0]?.singleton, "content index singleton") !== 1
    || typeof salt !== "string"
    || !/^[0-9a-f]{64}$/u.test(salt)) {
    throw new SchemaMismatchError("Content index state is invalid.");
  }
  const invalidVersions = count(database, `
    SELECT COUNT(*) AS total FROM session_content_versions
    WHERE length(trim(file_identity)) NOT BETWEEN 1 AND ${MAX_SESSION_FILE_IDENTITY_CHARS}
       OR length(projection_version) NOT BETWEEN 1 AND 128
       OR indexed_entries < 0
       OR incomplete NOT IN (0, 1)
  `, "invalid content versions");
  const invalidMessages = count(database, `
    SELECT COUNT(*) AS total FROM session_content_messages
    WHERE length(trim(file_identity)) NOT BETWEEN 1 AND ${MAX_SESSION_FILE_IDENTITY_CHARS}
       OR length(trim(message_id)) NOT BETWEEN 1 AND 512
       OR role NOT IN ('user', 'assistant')
       OR (created_at_ms IS NOT NULL AND created_at_ms < 0)
       OR entry_order < 0
       OR length(content_fingerprint) <> 64
       OR content_fingerprint <> lower(content_fingerprint)
  `, "invalid content messages");
  const invalidTokens = count(database, `
    SELECT COUNT(*) AS total FROM session_content_tokens
    WHERE length(trim(file_identity)) NOT BETWEEN 1 AND ${MAX_SESSION_FILE_IDENTITY_CHARS}
       OR length(trim(message_id)) NOT BETWEEN 1 AND 512
       OR length(token_hash) <> 32
       OR token_hash <> lower(token_hash)
  `, "invalid content tokens");
  const orphanMessages = count(database, `
    SELECT COUNT(*) AS total
    FROM session_content_messages AS messages
    LEFT JOIN session_content_versions AS versions USING (file_identity)
    WHERE versions.file_identity IS NULL
  `, "orphan content messages");
  const orphanVersions = count(database, `
    SELECT COUNT(*) AS total
    FROM session_content_versions AS versions
    LEFT JOIN sessions USING (file_identity)
    WHERE sessions.file_identity IS NULL
  `, "orphan content versions");
  const orphanTokens = count(database, `
    SELECT COUNT(*) AS total
    FROM session_content_tokens AS tokens
    LEFT JOIN session_content_messages AS messages USING (file_identity, message_id)
    WHERE messages.message_id IS NULL
  `, "orphan content tokens");
  const mismatchedEntryCounts = count(database, `
    SELECT COUNT(*) AS total
    FROM session_content_versions AS versions
    LEFT JOIN (
      SELECT file_identity, COUNT(*) AS message_count
      FROM session_content_messages
      GROUP BY file_identity
    ) AS messages USING (file_identity)
    WHERE versions.indexed_entries <> COALESCE(messages.message_count, 0)
  `, "mismatched content entry counts");
  if (invalidVersions + invalidMessages + invalidTokens + orphanVersions
    + orphanMessages + orphanTokens + mismatchedEntryCounts > 0) {
    throw new SchemaMismatchError("Content index projection is inconsistent.");
  }
}

export function validateContentIndexes(
  database: DatabaseLike
): Array<{ name: string; tableName: string }> {
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
  return [
    {
      name: validateImplicitCompositeIndex(database, versionIndexes, [
        { cid: 0, name: "file_identity" }
      ]),
      tableName: "session_content_versions"
    },
    {
      name: validateImplicitCompositeIndex(database, messageIndexes, [
        { cid: 0, name: "file_identity" },
        { cid: 1, name: "message_id" }
      ]),
      tableName: "session_content_messages"
    },
    {
      name: validateImplicitCompositeIndex(database, tokenIndexes, [
        { cid: 0, name: "file_identity" },
        { cid: 1, name: "message_id" },
        { cid: 2, name: "token_hash" }
      ]),
      tableName: "session_content_tokens"
    }
  ];
}

function count(database: DatabaseLike, sql: string, field: string): number {
  return readNonNegativeInteger(database.prepare(sql).get()?.total, field);
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
  assertIndexColumns(database, required.name, indexes, required.columns);
}

function validateImplicitCompositeIndex(
  database: DatabaseLike,
  indexes: Record<string, unknown>[],
  expectedColumns: readonly { cid: number; name: string }[]
): string {
  const matches = indexes.filter((index) => index.origin === "pk");
  const index = matches[0];
  if (matches.length !== 1
    || typeof index?.name !== "string"
    || index.unique !== 1
    || index.partial !== 0) {
    throw new SchemaMismatchError("Content index primary identity does not match.");
  }
  assertIndexColumns(database, index.name, indexes, expectedColumns);
  return index.name;
}

function assertIndexColumns(
  database: DatabaseLike,
  indexName: string,
  _indexes: Record<string, unknown>[],
  expectedColumns: readonly { cid: number; name: string }[]
): void {
  const columns = database.prepare(`PRAGMA index_xinfo(${indexName})`).all()
    .filter((row) => row.key === 1);
  if (columns.length !== expectedColumns.length || expectedColumns.some((expected, position) => {
    const column = columns[position];
    return column?.seqno !== position
      || column.cid !== expected.cid
      || column.name !== expected.name
      || column.desc !== 0
      || column.coll !== "BINARY";
  })) throw new SchemaMismatchError("Content index identity does not match.");
}
