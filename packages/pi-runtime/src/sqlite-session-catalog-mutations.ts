import {
  organizeManySqliteSessionCatalog,
  organizeSqliteSessionCatalog,
  type SessionCatalogOrganization
} from "./sqlite-session-catalog-organization.js";
import {
  assertSessionCatalogRecordSetConsistency,
  SessionCatalogIdentityConflictError
} from "./session-catalog-record-identity.js";
import {
  recordFromRow,
  recordValues,
  type DatabaseLike
} from "./sqlite-session-catalog-schema.js";
import { removeSessionCatalogRecoverySync } from "./session-catalog-storage.js";
import type {
  SessionCatalogRecord,
  SqliteCatalogState
} from "./sqlite-session-catalog-contract.js";

export interface SqliteSessionCatalogMutationsOptions {
  database: DatabaseLike;
  recoveryPath: string;
  getState(): SqliteCatalogState;
  readState(): SqliteCatalogState;
  assertDatabaseVersion(): void;
}

export class SqliteSessionCatalogMutations {
  constructor(private readonly options: SqliteSessionCatalogMutationsOptions) {}

  replaceAll(
    sourceKey: string,
    records: SessionCatalogRecord[],
    metadata: { reconciledAt: number; incomplete: boolean; skippedCount: number },
    minimumRevision: number
  ): SqliteCatalogState {
    assertSessionCatalogRecordSetConsistency(records);
    this.options.assertDatabaseVersion();
    const recordsToWrite = this.preserveAutomaticNames(sourceKey, records);
    const insert = this.options.database.prepare(`
      INSERT INTO sessions (
        file_identity, path, session_id, cwd, cwd_key, explicit_name, automatic_name, automatic_name_source, search_name, search_path, search_id,
        modified_at_ms, message_count, parent_session_path, pinned_at_ms, archived_at_ms, snoozed_until_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.options.database.exec("BEGIN IMMEDIATE");
    try {
      this.options.assertDatabaseVersion();
      const revision = Math.max(this.options.readState().revision, minimumRevision) + 1;
      this.options.database.exec("DELETE FROM sessions");
      for (const record of recordsToWrite) insert.run(...recordValues(record));
      this.pruneStaleContentIndexes(new Set(recordsToWrite.map((record) => record.fileIdentity)));
      this.options.database.prepare(`
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
      this.options.database.exec("COMMIT");
    } catch (error) {
      rollback(this.options.database);
      throw error;
    }
    const state = this.options.getState();
    try {
      removeSessionCatalogRecoverySync(this.options.recoveryPath);
    } catch {
      // Recovery cleanup is best-effort after the committed state is captured.
    }
    return state;
  }

  upsert(record: SessionCatalogRecord, minimumRevision: number): SqliteCatalogState {
    return this.upsertMany([record], minimumRevision);
  }

  upsertMany(
    records: readonly SessionCatalogRecord[],
    minimumRevision: number
  ): SqliteCatalogState {
    if (records.length === 0) return this.options.getState();
    this.options.assertDatabaseVersion();
    this.options.database.exec("BEGIN IMMEDIATE");
    try {
      this.options.assertDatabaseVersion();
      for (const record of records) this.assertUpsertIdentity(record);
      const revision = Math.max(this.options.readState().revision, minimumRevision) + 1;
      const upsert = this.options.database.prepare(`
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
      this.options.database.prepare(`
        UPDATE catalog_state
        SET revision = ?, item_count = (SELECT COUNT(*) FROM sessions)
        WHERE singleton = 1
      `).run(revision);
      this.options.database.exec("COMMIT");
    } catch (error) {
      rollback(this.options.database);
      throw error;
    }
    return this.options.getState();
  }

  setIncomplete(incomplete: boolean, skippedCount: number): SqliteCatalogState {
    this.options.assertDatabaseVersion();
    this.options.database.exec("BEGIN IMMEDIATE");
    try {
      this.options.assertDatabaseVersion();
      this.options.database.prepare(`
        UPDATE catalog_state SET incomplete = ?, skipped_count = ? WHERE singleton = 1
      `).run(incomplete ? 1 : 0, skippedCount);
      this.options.database.exec("COMMIT");
    } catch (error) {
      rollback(this.options.database);
      throw error;
    }
    return this.options.getState();
  }

  organize(
    path: string,
    organization: SessionCatalogOrganization,
    minimumRevision: number
  ): SqliteCatalogState {
    this.options.assertDatabaseVersion();
    organizeSqliteSessionCatalog(
      this.options.database,
      path,
      organization,
      minimumRevision,
      () => this.options.readState().revision
    );
    return this.options.getState();
  }

  organizeMany(
    organizations: readonly { path: string; organization: SessionCatalogOrganization }[],
    minimumRevision: number
  ): SqliteCatalogState {
    this.options.assertDatabaseVersion();
    organizeManySqliteSessionCatalog(
      this.options.database,
      organizations,
      minimumRevision,
      () => this.options.readState().revision
    );
    return this.options.getState();
  }

  preserveAutomaticNames(
    sourceKey: string,
    records: SessionCatalogRecord[]
  ): SessionCatalogRecord[] {
    const current = this.options.readState();
    if (current.sourceKey !== sourceKey) return records;
    const previous = this.options.database.prepare(`
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

  private assertUpsertIdentity(record: SessionCatalogRecord): void {
    const identityOwner = this.options.database.prepare(`
      SELECT session_id FROM sessions WHERE file_identity = ?
    `).get(record.fileIdentity);
    if (identityOwner !== undefined && identityOwner.session_id !== record.id) {
      throw new SessionCatalogIdentityConflictError(
        "One physical Session carries contradictory Pi Session IDs."
      );
    }
    const pathOwner = this.options.database.prepare(`
      SELECT file_identity FROM sessions WHERE path = ?
    `).get(record.path);
    if (pathOwner !== undefined && pathOwner.file_identity !== record.fileIdentity) {
      throw new SessionCatalogIdentityConflictError(
        "The Session locator is already owned by another physical Session."
      );
    }
  }

  private pruneStaleContentIndexes(currentIdentities: ReadonlySet<string>): void {
    const indexedIdentities = this.options.database.prepare(
      "SELECT file_identity FROM session_content_versions"
    ).all();
    const deleteTokens = this.options.database.prepare(
      "DELETE FROM session_content_tokens WHERE file_identity = ?"
    );
    const deleteMessages = this.options.database.prepare(
      "DELETE FROM session_content_messages WHERE file_identity = ?"
    );
    const deleteVersion = this.options.database.prepare(
      "DELETE FROM session_content_versions WHERE file_identity = ?"
    );
    for (const row of indexedIdentities) {
      if (typeof row.file_identity !== "string" || currentIdentities.has(row.file_identity)) continue;
      deleteTokens.run(row.file_identity);
      deleteMessages.run(row.file_identity);
      deleteVersion.run(row.file_identity);
    }
  }
}

function sameSessionProjection(next: SessionCatalogRecord, previous: SessionCatalogRecord): boolean {
  return next.fileIdentity === previous.fileIdentity
    && next.id === previous.id
    && next.path === previous.path
    && next.modifiedAt === previous.modifiedAt
    && next.messageCount === previous.messageCount;
}

function rollback(database: DatabaseLike): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Preserve the original transaction failure.
  }
}
