import { rename } from "node:fs/promises";
import { join } from "node:path";
import type { SessionCatalogDegradedReason } from "@pi67/domain";
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
  type DatabaseLike
} from "./sqlite-session-catalog-schema.js";
import {
  organizeManySqliteSessionCatalog,
  organizeSqliteSessionCatalog,
  type SessionCatalogOrganization
} from "./sqlite-session-catalog-organization.js";
import {
  querySqliteSessionCatalog,
  type SqliteCatalogQuery,
  type SqliteCatalogQueryResult
} from "./sqlite-session-catalog-query.js";
import {
  enforcePrivateSessionCatalogPermissions,
  prepareSessionCatalogDirectory,
  removeSessionCatalogRecovery,
  removeSessionCatalogRecoverySync,
  sessionCatalogFileExists,
  type SessionCatalogPermissionOperations
} from "./session-catalog-storage.js";
import {
  assertSessionCatalogRecordSetConsistency,
  SessionCatalogIdentityConflictError
} from "./session-catalog-record-identity.js";

export type { SqliteCatalogQueryResult } from "./sqlite-session-catalog-query.js";

export const SESSION_CATALOG_DATABASE_FILENAME = "session-catalog-v3.sqlite3";
export const SESSION_CATALOG_RECOVERY_FILENAME = "session-catalog-v3.recovery.sqlite3";
const CATALOG_DATABASE_VERSION_SQL = `
  SELECT data.data_version, schema_version.schema_version
  FROM pragma_data_version() AS data
  CROSS JOIN pragma_schema_version() AS schema_version
`;

export interface SessionCatalogRecord {
  fileIdentity: string;
  id: string;
  path: string;
  cwd: string;
  cwdKey: string;
  explicitName?: string;
  automaticName?: string;
  automaticNameSource?: "generated" | "seed";
  pinnedAt?: number;
  archivedAt?: number;
  snoozedUntil?: number;
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

export interface SessionContentIndexMessage {
  messageId: string;
  role: "user" | "assistant";
  createdAt?: number;
  entryOrder: number;
  contentFingerprint: string;
  tokenHashes: readonly string[];
}

export interface SessionContentIndexDocument {
  fileIdentity: string;
  projectionVersion: string;
  indexedEntries: number;
  incomplete: boolean;
  messages: readonly SessionContentIndexMessage[];
}

export interface SessionContentIndexCandidate {
  fileIdentity: string;
  messageId: string;
  role: "user" | "assistant";
  createdAt?: number;
  contentFingerprint: string;
}

export interface SessionContentIndexCoverage {
  sessionCount: number;
  indexedEntries: number;
  incompleteCount: number;
}

interface CatalogDatabaseVersion {
  dataVersion: number;
  schemaVersion: number;
}

export class SessionCatalogChangedExternallyError extends Error {
  readonly code = "SESSION_CATALOG_CHANGED_EXTERNALLY";
  readonly recoverable = true;

  constructor() {
    super("Session Catalog changed outside the active Pi runtime service.");
  }
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
  preserveAutomaticNames?(sourceKey: string, records: SessionCatalogRecord[]): SessionCatalogRecord[];
  contentIndexSalt?(): string;
  contentIndexVersions?(): Map<string, string>;
  replaceContentIndex?(document: SessionContentIndexDocument): void;
  replaceContentIndexes?(documents: readonly SessionContentIndexDocument[]): void;
  removeContentIndex?(fileIdentity: string): void;
  pruneContentIndex?(fileIdentities: ReadonlySet<string>): void;
  queryContentIndex?(cwdKey: string, tokenHashes: readonly string[], limit: number): SessionContentIndexCandidate[];
  contentIndexCoverage?(cwdKey: string): SessionContentIndexCoverage;
  upsert(record: SessionCatalogRecord, minimumRevision: number): SqliteCatalogState;
  upsertMany(records: readonly SessionCatalogRecord[], minimumRevision: number): SqliteCatalogState;
  setIncomplete(incomplete: boolean, skippedCount: number): SqliteCatalogState;
  organize?(path: string, organization: SessionCatalogOrganization, minimumRevision: number): SqliteCatalogState;
  organizeMany?(
    organizations: readonly { path: string; organization: SessionCatalogOrganization }[],
    minimumRevision: number
  ): SqliteCatalogState;
  close(): void;
}

export type IndexedSqliteSessionCatalog = SqliteSessionCatalog & Required<Pick<
  SqliteSessionCatalog,
  | "contentIndexSalt"
  | "contentIndexVersions"
  | "replaceContentIndex"
  | "replaceContentIndexes"
  | "removeContentIndex"
  | "pruneContentIndex"
  | "queryContentIndex"
  | "contentIndexCoverage"
>>;

export function supportsSessionContentIndex(
  catalog: SqliteSessionCatalog
): catalog is IndexedSqliteSessionCatalog {
  return typeof catalog.contentIndexSalt === "function"
    && typeof catalog.contentIndexVersions === "function"
    && typeof catalog.replaceContentIndex === "function"
    && typeof catalog.replaceContentIndexes === "function"
    && typeof catalog.removeContentIndex === "function"
    && typeof catalog.pruneContentIndex === "function"
    && typeof catalog.queryContentIndex === "function"
    && typeof catalog.contentIndexCoverage === "function";
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
    const result = querySqliteSessionCatalog(this.database, query);
    this.assertDatabaseVersion();
    return result;
  }

  contentIndexSalt(): string {
    this.assertDatabaseVersion();
    const salt = this.database.prepare("SELECT salt FROM content_index_state WHERE singleton = 1").get()?.salt;
    if (typeof salt !== "string" || !/^[0-9a-f]{64}$/u.test(salt)) {
      throw new SchemaMismatchError("Content index salt is invalid.");
    }
    return salt;
  }

  contentIndexVersions(): Map<string, string> {
    this.assertDatabaseVersion();
    const rows = this.database.prepare(`
      SELECT file_identity, projection_version FROM session_content_versions
    `).all();
    this.assertDatabaseVersion();
    return new Map(rows.map((row) => {
      if (typeof row.file_identity !== "string" || typeof row.projection_version !== "string") {
        throw new SchemaMismatchError("Content index version is invalid.");
      }
      return [row.file_identity, row.projection_version] as const;
    }));
  }

  replaceContentIndex(document: SessionContentIndexDocument): void {
    this.replaceContentIndexes([document]);
  }

  replaceContentIndexes(documents: readonly SessionContentIndexDocument[]): void {
    if (documents.length === 0) return;
    this.assertDatabaseVersion();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.assertDatabaseVersion();
      const deleteTokens = this.database.prepare("DELETE FROM session_content_tokens WHERE file_identity = ?");
      const deleteMessages = this.database.prepare("DELETE FROM session_content_messages WHERE file_identity = ?");
      const deleteVersion = this.database.prepare("DELETE FROM session_content_versions WHERE file_identity = ?");
      const insertMessage = this.database.prepare(`
        INSERT INTO session_content_messages (
          file_identity, message_id, role, created_at_ms, entry_order, content_fingerprint
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      const insertToken = this.database.prepare(`
        INSERT INTO session_content_tokens (file_identity, message_id, token_hash)
        VALUES (?, ?, ?)
      `);
      const insertVersion = this.database.prepare(`
        INSERT INTO session_content_versions (
          file_identity, projection_version, indexed_entries, incomplete
        ) VALUES (?, ?, ?, ?)
      `);
      for (const document of documents) {
        deleteTokens.run(document.fileIdentity);
        deleteMessages.run(document.fileIdentity);
        deleteVersion.run(document.fileIdentity);
        for (const message of document.messages) {
          insertMessage.run(
            document.fileIdentity,
            message.messageId,
            message.role,
            message.createdAt ?? null,
            message.entryOrder,
            message.contentFingerprint
          );
          for (const tokenHash of message.tokenHashes) {
            insertToken.run(document.fileIdentity, message.messageId, tokenHash);
          }
        }
        insertVersion.run(
          document.fileIdentity,
          document.projectionVersion,
          document.indexedEntries,
          document.incomplete ? 1 : 0
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      rollback(this.database);
      throw error;
    }
  }

  removeContentIndex(fileIdentity: string): void {
    this.assertDatabaseVersion();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("DELETE FROM session_content_tokens WHERE file_identity = ?").run(fileIdentity);
      this.database.prepare("DELETE FROM session_content_messages WHERE file_identity = ?").run(fileIdentity);
      this.database.prepare("DELETE FROM session_content_versions WHERE file_identity = ?").run(fileIdentity);
      this.database.exec("COMMIT");
    } catch (error) {
      rollback(this.database);
      throw error;
    }
  }

  pruneContentIndex(fileIdentities: ReadonlySet<string>): void {
    this.assertDatabaseVersion();
    const indexed = this.database.prepare("SELECT file_identity FROM session_content_versions").all();
    const stale = indexed.flatMap((row) => (
      typeof row.file_identity === "string" && !fileIdentities.has(row.file_identity) ? [row.file_identity] : []
    ));
    if (stale.length === 0) return;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const deleteTokens = this.database.prepare("DELETE FROM session_content_tokens WHERE file_identity = ?");
      const deleteMessages = this.database.prepare("DELETE FROM session_content_messages WHERE file_identity = ?");
      const deleteVersion = this.database.prepare("DELETE FROM session_content_versions WHERE file_identity = ?");
      for (const fileIdentity of stale) {
        deleteTokens.run(fileIdentity);
        deleteMessages.run(fileIdentity);
        deleteVersion.run(fileIdentity);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      rollback(this.database);
      throw error;
    }
  }

  queryContentIndex(
    cwdKey: string,
    tokenHashes: readonly string[],
    limit: number
  ): SessionContentIndexCandidate[] {
    if (tokenHashes.length === 0 || limit < 1) return [];
    this.assertDatabaseVersion();
    const placeholders = tokenHashes.map(() => "?").join(", ");
    const rows = this.database.prepare(`
      SELECT messages.file_identity, messages.message_id, messages.role,
             messages.created_at_ms, messages.content_fingerprint
      FROM session_content_tokens AS tokens
      JOIN session_content_messages AS messages
        USING (file_identity, message_id)
      JOIN sessions ON sessions.file_identity = messages.file_identity
      WHERE sessions.cwd_key = ?
        AND sessions.archived_at_ms IS NULL
        AND tokens.token_hash IN (${placeholders})
      GROUP BY messages.file_identity, messages.message_id
      HAVING COUNT(DISTINCT tokens.token_hash) = ?
      ORDER BY sessions.modified_at_ms DESC,
               CASE messages.role WHEN 'user' THEN 0 ELSE 1 END,
               messages.entry_order ASC
      LIMIT ?
    `).all(cwdKey, ...tokenHashes, tokenHashes.length, limit);
    this.assertDatabaseVersion();
    return rows.map((row) => contentIndexCandidateFromRow(row));
  }

  contentIndexCoverage(cwdKey: string): SessionContentIndexCoverage {
    this.assertDatabaseVersion();
    const row = this.database.prepare(`
      SELECT COUNT(*) AS session_count,
             COALESCE(SUM(versions.indexed_entries), 0) AS indexed_entries,
             COALESCE(SUM(versions.incomplete), 0) AS incomplete_count
      FROM session_content_versions AS versions
      JOIN sessions USING (file_identity)
      WHERE sessions.cwd_key = ? AND sessions.archived_at_ms IS NULL
    `).get(cwdKey);
    this.assertDatabaseVersion();
    return {
      sessionCount: readCount(row?.session_count, "content index session count"),
      indexedEntries: readCount(row?.indexed_entries, "content index entry count"),
      incompleteCount: readCount(row?.incomplete_count, "content index incomplete count")
    };
  }

  replaceAll(
    sourceKey: string,
    records: SessionCatalogRecord[],
    metadata: { reconciledAt: number; incomplete: boolean; skippedCount: number },
    minimumRevision: number
  ): SqliteCatalogState {
    assertSessionCatalogRecordSetConsistency(records);
    this.assertDatabaseVersion();
    const recordsToWrite = this.preserveAutomaticNames(sourceKey, records);
    const insert = this.database.prepare(`
      INSERT INTO sessions (
        file_identity, path, session_id, cwd, cwd_key, explicit_name, automatic_name, automatic_name_source, search_name, search_path, search_id,
        modified_at_ms, message_count, parent_session_path, pinned_at_ms, archived_at_ms, snoozed_until_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.assertDatabaseVersion();
      const revision = Math.max(this.readState().revision, minimumRevision) + 1;
      this.database.exec("DELETE FROM sessions");
      for (const record of recordsToWrite) insert.run(...recordValues(record));
      const currentIdentities = new Set(recordsToWrite.map((record) => record.fileIdentity));
      const indexedIdentities = this.database.prepare("SELECT file_identity FROM session_content_versions").all();
      const deleteTokens = this.database.prepare("DELETE FROM session_content_tokens WHERE file_identity = ?");
      const deleteMessages = this.database.prepare("DELETE FROM session_content_messages WHERE file_identity = ?");
      const deleteVersion = this.database.prepare("DELETE FROM session_content_versions WHERE file_identity = ?");
      for (const row of indexedIdentities) {
        if (typeof row.file_identity !== "string" || currentIdentities.has(row.file_identity)) continue;
        deleteTokens.run(row.file_identity);
        deleteMessages.run(row.file_identity);
        deleteVersion.run(row.file_identity);
      }
      this.database.prepare(`
        UPDATE catalog_state
        SET source_key = ?, revision = ?, reconciled_at_ms = ?, item_count = ?, incomplete = ?, skipped_count = ?
        WHERE singleton = 1
      `).run(
        sourceKey,
        revision,
        metadata.reconciledAt,
        recordsToWrite.length,
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
    return this.upsertMany([record], minimumRevision);
  }

  upsertMany(records: readonly SessionCatalogRecord[], minimumRevision: number): SqliteCatalogState {
    if (records.length === 0) return this.getState();
    this.assertDatabaseVersion();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.assertDatabaseVersion();
      for (const record of records) this.assertUpsertIdentity(record);
      const revision = Math.max(this.readState().revision, minimumRevision) + 1;
      const upsert = this.database.prepare(`
        INSERT INTO sessions (
          file_identity, path, session_id, cwd, cwd_key, explicit_name, automatic_name, automatic_name_source, search_name, search_path, search_id,
          modified_at_ms, message_count, parent_session_path, pinned_at_ms, archived_at_ms, snoozed_until_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_identity) DO UPDATE SET
          path = excluded.path,
          cwd = excluded.cwd,
          cwd_key = excluded.cwd_key,
          explicit_name = excluded.explicit_name,
          automatic_name = excluded.automatic_name,
          automatic_name_source = excluded.automatic_name_source,
          search_name = excluded.search_name,
          search_path = excluded.search_path,
          search_id = excluded.search_id,
          modified_at_ms = excluded.modified_at_ms,
          message_count = excluded.message_count,
          parent_session_path = excluded.parent_session_path,
          pinned_at_ms = excluded.pinned_at_ms,
          archived_at_ms = excluded.archived_at_ms,
          snoozed_until_ms = excluded.snoozed_until_ms
      `);
      for (const record of records) upsert.run(...recordValues(record));
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

  setIncomplete(incomplete: boolean, skippedCount: number): SqliteCatalogState {
    this.assertDatabaseVersion();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.assertDatabaseVersion();
      this.database.prepare(`
        UPDATE catalog_state SET incomplete = ?, skipped_count = ? WHERE singleton = 1
      `).run(incomplete ? 1 : 0, skippedCount);
      this.database.exec("COMMIT");
    } catch (error) {
      rollback(this.database);
      throw error;
    }
    return this.getState();
  }

  organize(
    path: string,
    organization: SessionCatalogOrganization,
    minimumRevision: number
  ): SqliteCatalogState {
    this.assertDatabaseVersion();
    organizeSqliteSessionCatalog(
      this.database,
      path,
      organization,
      minimumRevision,
      () => this.readState().revision
    );
    return this.getState();
  }

  organizeMany(
    organizations: readonly { path: string; organization: SessionCatalogOrganization }[],
    minimumRevision: number
  ): SqliteCatalogState {
    this.assertDatabaseVersion();
    organizeManySqliteSessionCatalog(
      this.database,
      organizations,
      minimumRevision,
      () => this.readState().revision
    );
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

  private assertUpsertIdentity(record: SessionCatalogRecord): void {
    const identityOwner = this.database.prepare(`
      SELECT session_id FROM sessions WHERE file_identity = ?
    `).get(record.fileIdentity);
    if (identityOwner !== undefined && identityOwner.session_id !== record.id) {
      throw new SessionCatalogIdentityConflictError(
        "One physical Session carries contradictory Pi Session IDs."
      );
    }
    const pathOwner = this.database.prepare(`
      SELECT file_identity FROM sessions WHERE path = ?
    `).get(record.path);
    if (pathOwner !== undefined && pathOwner.file_identity !== record.fileIdentity) {
      throw new SessionCatalogIdentityConflictError(
        "The Session locator is already owned by another physical Session."
      );
    }
  }

  preserveAutomaticNames(sourceKey: string, records: SessionCatalogRecord[]): SessionCatalogRecord[] {
    const current = this.readState();
    if (current.sourceKey !== sourceKey) return records;
    const previous = this.database.prepare(`
      SELECT file_identity, path, session_id, cwd, cwd_key, explicit_name, automatic_name, automatic_name_source, search_name, search_path,
             search_id, modified_at_ms, message_count, parent_session_path, pinned_at_ms, archived_at_ms,
             snoozed_until_ms
      FROM sessions
    `).all();
    const namesByIdentity = new Map(previous.map((row) => {
      const record = recordFromRow(row);
      return [record.fileIdentity, record] as const;
    }));
    return records.map((record) => {
      if (record.explicitName !== undefined || record.automaticName !== undefined) return record;
      const old = namesByIdentity.get(record.fileIdentity);
      if (!old || old.automaticName === undefined || !sameSessionProjection(record, old)) return record;
      return {
        ...record,
        automaticName: old.automaticName,
        automaticNameSource: old.automaticNameSource ?? "seed"
      };
    });
  }
}

function sameSessionProjection(next: SessionCatalogRecord, previous: SessionCatalogRecord): boolean {
  return next.fileIdentity === previous.fileIdentity
    && next.id === previous.id
    && next.path === previous.path
    && next.modifiedAt === previous.modifiedAt
    && next.messageCount === previous.messageCount;
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

function readInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SchemaMismatchError(`Catalog ${field} is invalid.`);
  }
  return value;
}

function readCount(value: unknown, field: string): number {
  return readInteger(value, field);
}

function contentIndexCandidateFromRow(row: Record<string, unknown>): SessionContentIndexCandidate {
  if (typeof row.file_identity !== "string"
    || typeof row.message_id !== "string"
    || (row.role !== "user" && row.role !== "assistant")
    || typeof row.content_fingerprint !== "string"
    || !/^[0-9a-f]{64}$/u.test(row.content_fingerprint)) {
    throw new SchemaMismatchError("Content index candidate is invalid.");
  }
  const createdAt = row.created_at_ms === null
    ? undefined
    : readInteger(row.created_at_ms, "content index created_at_ms");
  return {
    fileIdentity: row.file_identity,
    messageId: row.message_id,
    role: row.role,
    contentFingerprint: row.content_fingerprint,
    ...(createdAt === undefined ? {} : { createdAt })
  };
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
