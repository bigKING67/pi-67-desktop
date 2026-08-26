import {
  SchemaMismatchError,
  type DatabaseLike
} from "./sqlite-session-catalog-schema.js";

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

export class SqliteSessionContentIndex {
  constructor(
    private readonly database: DatabaseLike,
    private readonly assertDatabaseVersion: () => void
  ) {}

  salt(): string {
    this.assertDatabaseVersion();
    const salt = this.database.prepare("SELECT salt FROM content_index_state WHERE singleton = 1").get()?.salt;
    if (typeof salt !== "string" || !/^[0-9a-f]{64}$/u.test(salt)) {
      throw new SchemaMismatchError("Content index salt is invalid.");
    }
    return salt;
  }

  versions(): Map<string, string> {
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

  replace(document: SessionContentIndexDocument): void {
    this.replaceMany([document]);
  }

  replaceMany(documents: readonly SessionContentIndexDocument[]): void {
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

  remove(fileIdentity: string): void {
    this.assertDatabaseVersion();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.removeRows(fileIdentity);
      this.database.exec("COMMIT");
    } catch (error) {
      rollback(this.database);
      throw error;
    }
  }

  prune(fileIdentities: ReadonlySet<string>): void {
    this.assertDatabaseVersion();
    const indexed = this.database.prepare("SELECT file_identity FROM session_content_versions").all();
    const stale = indexed.flatMap((row) => (
      typeof row.file_identity === "string" && !fileIdentities.has(row.file_identity) ? [row.file_identity] : []
    ));
    if (stale.length === 0) return;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const fileIdentity of stale) this.removeRows(fileIdentity);
      this.database.exec("COMMIT");
    } catch (error) {
      rollback(this.database);
      throw error;
    }
  }

  query(
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
    return rows.map(contentIndexCandidateFromRow);
  }

  coverage(cwdKey: string): SessionContentIndexCoverage {
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
      sessionCount: readInteger(row?.session_count, "content index session count"),
      indexedEntries: readInteger(row?.indexed_entries, "content index entry count"),
      incompleteCount: readInteger(row?.incomplete_count, "content index incomplete count")
    };
  }

  private removeRows(fileIdentity: string): void {
    this.database.prepare("DELETE FROM session_content_tokens WHERE file_identity = ?").run(fileIdentity);
    this.database.prepare("DELETE FROM session_content_messages WHERE file_identity = ?").run(fileIdentity);
    this.database.prepare("DELETE FROM session_content_versions WHERE file_identity = ?").run(fileIdentity);
  }
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

function readInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SchemaMismatchError(`Catalog ${field} is invalid.`);
  }
  return value;
}

function rollback(database: DatabaseLike): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Preserve the original transaction failure.
  }
}
