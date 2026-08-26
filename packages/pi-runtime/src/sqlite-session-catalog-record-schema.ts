import {
  MAX_SESSION_CATALOG_ID_CHARS,
  MAX_SESSION_CATALOG_NAME_CHARS,
  MAX_SESSION_CATALOG_PATH_CHARS,
  MAX_SESSION_FILE_IDENTITY_CHARS
} from "@pi67/domain";
import {
  readNonNegativeInteger,
  SchemaMismatchError,
  type SqlValue
} from "./sqlite-session-catalog-schema-core.js";
import type {
  SessionCatalogRecord,
  SqliteCatalogState
} from "./sqlite-session-catalog-contract.js";

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
    fileIdentity: readText(row.file_identity, "file_identity", MAX_SESSION_FILE_IDENTITY_CHARS),
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
  if (incomplete !== 0 && incomplete !== 1) {
    throw new SchemaMismatchError("Catalog incomplete is invalid.");
  }
  return {
    sourceKey: readString(row.source_key, "source_key", 512),
    revision: readNonNegativeInteger(row.revision, "revision"),
    ...(reconciledAt === undefined ? {} : { reconciledAt }),
    itemCount: readNonNegativeInteger(row.item_count, "item_count"),
    incomplete: incomplete === 1,
    skippedCount: readNonNegativeInteger(row.skipped_count, "skipped_count")
  };
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
