import type {
  SessionCatalogCursor,
  SessionCatalogScope,
  SessionCatalogView
} from "@pi67/domain";
import {
  recordFromRow,
  SchemaMismatchError,
  type DatabaseLike,
  type SqlValue
} from "./sqlite-session-catalog-schema.js";

export interface SqliteCatalogQuery {
  scope: SessionCatalogScope;
  view?: SessionCatalogView;
  cwdKey: string;
  search?: string;
  cursor?: Pick<SessionCatalogCursor, "pinnedAt" | "archivedAt" | "modifiedAt" | "path">;
  limit: number;
}

export interface SqliteCatalogQueryResult {
  records: Array<ReturnType<typeof recordFromRow>>;
  total: number;
  hasMore: boolean;
}

export function querySqliteSessionCatalog(
  database: DatabaseLike,
  query: SqliteCatalogQuery
): SqliteCatalogQueryResult {
  const view = query.view ?? "active";
  const filters: string[] = [];
  const values: SqlValue[] = [];
  if (query.scope === "workspace") {
    filters.push("cwd_key = ?");
    values.push(query.cwdKey);
  }
  filters.push(view === "archived" ? "archived_at_ms IS NOT NULL" : "archived_at_ms IS NULL");
  if (query.search !== undefined && query.search.length > 0) {
    filters.push("(search_name LIKE ? ESCAPE '\\' OR search_path LIKE ? ESCAPE '\\' OR search_id LIKE ? ESCAPE '\\')");
    const pattern = `%${escapeLikePattern(query.search)}%`;
    values.push(pattern, pattern, pattern);
  }
  const countWhere = filters.length > 0 ? ` WHERE ${filters.join(" AND ")}` : "";
  const totalRow = database.prepare(`SELECT COUNT(*) AS total FROM sessions${countWhere}`).get(...values);
  const total = readTotal(totalRow?.total);

  const pageFilters = [...filters];
  const pageValues = [...values];
  if (query.cursor) {
    if (view === "archived") {
      pageFilters.push("(archived_at_ms < ? OR (archived_at_ms = ? AND (modified_at_ms < ? OR (modified_at_ms = ? AND path < ?))))");
      pageValues.push(
        query.cursor.archivedAt ?? 0,
        query.cursor.archivedAt ?? 0,
        query.cursor.modifiedAt,
        query.cursor.modifiedAt,
        query.cursor.path
      );
    } else {
      const pinnedAt = query.cursor.pinnedAt ?? -1;
      pageFilters.push("(COALESCE(pinned_at_ms, -1) < ? OR (COALESCE(pinned_at_ms, -1) = ? AND (modified_at_ms < ? OR (modified_at_ms = ? AND path < ?))))");
      pageValues.push(pinnedAt, pinnedAt, query.cursor.modifiedAt, query.cursor.modifiedAt, query.cursor.path);
    }
  }
  const pageWhere = pageFilters.length > 0 ? ` WHERE ${pageFilters.join(" AND ")}` : "";
  const rows = database.prepare(`
    SELECT file_identity, path, session_id, cwd, cwd_key, explicit_name, automatic_name, automatic_name_source, modified_at_ms, message_count,
           parent_session_path, pinned_at_ms, archived_at_ms, snoozed_until_ms
    FROM sessions${pageWhere}
    ORDER BY ${view === "archived"
      ? "archived_at_ms DESC, modified_at_ms DESC, path DESC"
      : "COALESCE(pinned_at_ms, -1) DESC, modified_at_ms DESC, path DESC"}
    LIMIT ?
  `).all(...pageValues, query.limit + 1);
  return {
    records: rows.slice(0, query.limit).map(recordFromRow),
    total,
    hasMore: rows.length > query.limit
  };
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function readTotal(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SchemaMismatchError("Catalog total is invalid.");
  }
  return value;
}
