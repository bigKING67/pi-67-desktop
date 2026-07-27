import {
  DEFAULT_SESSION_CATALOG_PAGE_ITEMS,
  MAX_SESSION_CATALOG_ID_CHARS,
  MAX_SESSION_CATALOG_NAME_CHARS,
  MAX_SESSION_CATALOG_PAGE_ITEMS,
  MAX_SESSION_CATALOG_PAGE_JSON_BYTES,
  MAX_SESSION_CATALOG_PATH_CHARS,
  MAX_SESSION_CATALOG_SEARCH_CHARS,
  RuntimeError,
  type SessionCatalogPage,
  type SessionCatalogQuery,
  type SessionCatalogStatus,
  type SessionSummary
} from "@pi67/domain";
import type { SessionCatalogRecord, SqliteCatalogQueryResult } from "./sqlite-session-catalog.js";

const UNTITLED_SESSION_NAME = "Untitled session";

export type ValidatedSessionCatalogQuery = SessionCatalogQuery & { limit: number };

export interface SessionCatalogDiscoveryResult {
  records: SessionCatalogRecord[];
  incomplete: boolean;
  skippedCount: number;
}

export function validateSessionCatalogQuery(query: SessionCatalogQuery): ValidatedSessionCatalogQuery {
  const limit = query.limit ?? DEFAULT_SESSION_CATALOG_PAGE_ITEMS;
  if ((query.scope !== "workspace" && query.scope !== "all")
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > MAX_SESSION_CATALOG_PAGE_ITEMS
    || (query.search !== undefined && query.search.length > MAX_SESSION_CATALOG_SEARCH_CHARS)) {
    throw new RuntimeError("INVALID_PAYLOAD", "Session Catalog query is outside the supported limits.");
  }
  return { ...query, limit };
}

export function validateSessionCatalogContext(context: { sourceKey: string; workspaceCwd: string }): void {
  if (context.sourceKey.trim().length === 0
    || context.sourceKey.length > 512
    || !validText(context.workspaceCwd, MAX_SESSION_CATALOG_PATH_CHARS)) {
    throw new RuntimeError("INVALID_PAYLOAD", "Session Catalog context is invalid.");
  }
}

export function sanitizeSessionCatalogDiscovery(
  result: SessionCatalogDiscoveryResult
): SessionCatalogDiscoveryResult {
  const records = new Map<string, SessionCatalogRecord>();
  let skippedCount = Math.max(0, Number.isSafeInteger(result.skippedCount) ? result.skippedCount : 0);
  for (const record of result.records) {
    const safe = sanitizeSessionCatalogRecord(record);
    if (safe) records.set(safe.path, safe);
    else skippedCount += 1;
  }
  return {
    records: sortSessionCatalogRecords([...records.values()]),
    incomplete: result.incomplete || skippedCount > result.skippedCount,
    skippedCount
  };
}

export function sanitizeSessionCatalogRecord(record: SessionCatalogRecord): SessionCatalogRecord | undefined {
  const explicitName = record.explicitName?.trim() || undefined;
  if (!validText(record.id, MAX_SESSION_CATALOG_ID_CHARS)
    || !validText(record.path, MAX_SESSION_CATALOG_PATH_CHARS)
    || !validText(record.cwd, MAX_SESSION_CATALOG_PATH_CHARS)
    || !validText(record.cwdKey, MAX_SESSION_CATALOG_PATH_CHARS)
    || (explicitName !== undefined && !validText(explicitName, MAX_SESSION_CATALOG_NAME_CHARS))
    || (record.parentSessionPath !== undefined && !validText(record.parentSessionPath, MAX_SESSION_CATALOG_PATH_CHARS))
    || !Number.isSafeInteger(record.modifiedAt)
    || !Number.isSafeInteger(record.messageCount)
    || record.modifiedAt < 0
    || record.messageCount < 0) return undefined;
  const safe = { ...record };
  if (explicitName === undefined) delete safe.explicitName;
  else safe.explicitName = explicitName;
  return safe;
}

export function querySessionCatalogFallback(
  records: SessionCatalogRecord[],
  cwdKey: string,
  query: ValidatedSessionCatalogQuery
): SqliteCatalogQueryResult {
  const search = query.search === undefined ? undefined : normalizeSessionCatalogSearch(query.search);
  const matching = records.filter((record) => (
    (query.scope === "all" || record.cwdKey === cwdKey)
    && (search === undefined || search.length === 0 || [
      record.explicitName ?? UNTITLED_SESSION_NAME,
      record.path,
      record.id
    ].some((value) => normalizeSessionCatalogSearch(value).includes(search)))
  ));
  const afterCursor = query.cursor
    ? matching.filter((record) => record.modifiedAt < query.cursor!.modifiedAt
      || (record.modifiedAt === query.cursor!.modifiedAt
        && comparePathBinary(record.path, query.cursor!.path) < 0))
    : matching;
  return {
    records: afterCursor.slice(0, query.limit),
    total: matching.length,
    hasMore: afterCursor.length > query.limit
  };
}

export function createBoundedSessionCatalogPage(
  result: SqliteCatalogQueryResult,
  status: SessionCatalogStatus,
  limit: number,
  queryKey: string
): SessionCatalogPage {
  const items = result.records.slice(0, limit).map(toSummary);
  const full = pageWithItems(items, result.total, result.hasMore, status, queryKey);
  if (Buffer.byteLength(JSON.stringify(full), "utf8") <= MAX_SESSION_CATALOG_PAGE_JSON_BYTES) return full;
  let low = 0;
  let high = items.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = pageWithItems(items.slice(0, middle), result.total, true, status, queryKey);
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") <= MAX_SESSION_CATALOG_PAGE_JSON_BYTES) low = middle;
    else high = middle - 1;
  }
  return pageWithItems(items.slice(0, low), result.total, true, status, queryKey);
}

export function sortSessionCatalogRecords(records: SessionCatalogRecord[]): SessionCatalogRecord[] {
  return records.sort((left, right) => (
    right.modifiedAt - left.modifiedAt || comparePathBinary(right.path, left.path)
  ));
}

export function normalizeSessionCatalogSearch(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function pageWithItems(
  items: SessionSummary[],
  total: number,
  hasMore: boolean,
  status: SessionCatalogStatus,
  queryKey: string
): SessionCatalogPage {
  const more = hasMore && items.length > 0;
  const last = more ? items.at(-1) : undefined;
  return {
    ...status,
    items,
    total,
    hasMore: more,
    ...(last ? {
      nextCursor: { revision: status.revision, queryKey, modifiedAt: last.modifiedAt, path: last.path }
    } : {})
  };
}

function toSummary(record: SessionCatalogRecord): SessionSummary {
  return {
    id: record.id,
    path: record.path,
    cwd: record.cwd,
    name: record.explicitName ?? UNTITLED_SESSION_NAME,
    modifiedAt: record.modifiedAt,
    messageCount: record.messageCount,
    ...(record.parentSessionPath === undefined ? {} : { parentSessionPath: record.parentSessionPath })
  };
}

function validText(value: string, maximum: number): boolean {
  return value.trim().length > 0 && value.length <= maximum;
}

function comparePathBinary(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
