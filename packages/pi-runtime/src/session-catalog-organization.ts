import {
  MAX_PINNED_CONVERSATION_ORDER_ITEMS,
  MAX_SESSION_CATALOG_PAGE_ITEMS,
  RuntimeError,
  type SessionCatalogCursor,
  type SessionCatalogStatus
} from "@pi67/domain";
import { resolveExistingSessionFileIdentity } from "./session-path-identity.js";
import type { SessionCatalogContext } from "./session-catalog-contract.js";
import type {
  SessionCatalogOrganizationMutation,
  SessionCatalogRecordEnricher
} from "./session-catalog-record-enricher.js";
import type { ValidatedSessionCatalogQuery } from "./session-catalog-projection.js";
import type { SessionCatalogRecord, SqliteSessionCatalog } from "./sqlite-session-catalog.js";

export interface SessionCatalogOrganizationHost {
  recordEnricher: SessionCatalogRecordEnricher;
  now(): number;
  current(): SessionCatalogStatus;
  sqlite(): SqliteSessionCatalog | undefined;
  isCurrentContext(context: SessionCatalogContext, generation: number): boolean;
  readProjection(query: ValidatedSessionCatalogQuery): {
    records: SessionCatalogRecord[];
    hasMore: boolean;
  };
  applySqliteState(state: ReturnType<SqliteSessionCatalog["getState"]>): void;
  demoteSqlite(): void;
  fallbackRecords(): SessionCatalogRecord[];
  commitFallback(records: SessionCatalogRecord[]): void;
  publish(): void;
}

export async function organizeSessionCatalogRecord(
  host: SessionCatalogOrganizationHost,
  path: string,
  mutation: SessionCatalogOrganizationMutation,
  context: SessionCatalogContext,
  contextGeneration: number
): Promise<number> {
  if (!host.isCurrentContext(context, contextGeneration)) return host.current().revision;
  const organization = await host.recordEnricher.organize(
    context.sourceKey,
    await resolveExistingSessionFileIdentity(path),
    mutation,
    host.now()
  );
  if (!host.isCurrentContext(context, contextGeneration)) return host.current().revision;
  const sqlite = host.sqlite();
  if (sqlite && host.current().source === "sqlite") {
    try {
      if (!sqlite.organize) throw new Error("Session Catalog organization projection is unavailable.");
      host.applySqliteState(sqlite.organize(path, organization, host.current().revision));
      host.publish();
      return host.current().revision;
    } catch {
      host.demoteSqlite();
    }
  }
  host.commitFallback(host.recordEnricher.applyOrganization(host.fallbackRecords(), path, organization));
  host.publish();
  return host.current().revision;
}

export async function reorderPinnedSessionCatalogRecords(
  host: SessionCatalogOrganizationHost,
  paths: readonly string[],
  context: SessionCatalogContext,
  contextGeneration: number
): Promise<number> {
  if (!host.isCurrentContext(context, contextGeneration)) return host.current().revision;
  if (
    paths.length === 0
    || paths.length > MAX_PINNED_CONVERSATION_ORDER_ITEMS
    || new Set(paths).size !== paths.length
  ) throw new RuntimeError("INVALID_PAYLOAD", "Pinned conversation order is outside the supported limits.");
  const pinned = readPinnedRecords(host);
  if (pinned.length !== paths.length || pinned.some((record) => !paths.includes(record.path))) {
    throw new RuntimeError("INVALID_PAYLOAD", "Pinned conversation order is stale.");
  }
  const organizations = await host.recordEnricher.reorderPinned(
    context.sourceKey,
    pinned,
    paths,
    host.now()
  );
  if (!host.isCurrentContext(context, contextGeneration)) return host.current().revision;
  const sqlite = host.sqlite();
  if (sqlite && host.current().source === "sqlite") {
    try {
      if (!sqlite.organizeMany) throw new Error("Session Catalog organization projection is unavailable.");
      host.applySqliteState(sqlite.organizeMany(paths.map((path) => ({
        path,
        organization: organizations.get(path)!
      })), host.current().revision));
      host.publish();
      return host.current().revision;
    } catch {
      host.demoteSqlite();
    }
  }
  host.commitFallback(host.recordEnricher.applyOrganizations(host.fallbackRecords(), organizations));
  host.publish();
  return host.current().revision;
}

function readPinnedRecords(host: SessionCatalogOrganizationHost): SessionCatalogRecord[] {
  const records: SessionCatalogRecord[] = [];
  let cursor: SessionCatalogCursor | undefined;
  while (records.length <= MAX_PINNED_CONVERSATION_ORDER_ITEMS) {
    const projection = host.readProjection({
      scope: "workspace",
      view: "active",
      limit: MAX_SESSION_CATALOG_PAGE_ITEMS,
      ...(cursor === undefined ? {} : { cursor })
    });
    for (const record of projection.records) {
      if (record.pinnedAt === undefined) return records;
      records.push(record);
      if (records.length > MAX_PINNED_CONVERSATION_ORDER_ITEMS) {
        throw new RuntimeError("INVALID_PAYLOAD", "Pinned conversation order exceeds the supported limit.");
      }
    }
    if (!projection.hasMore || projection.records.length === 0) return records;
    const last = projection.records.at(-1)!;
    cursor = {
      revision: host.current().revision,
      queryKey: "0".repeat(64),
      ...(last.pinnedAt === undefined ? {} : { pinnedAt: last.pinnedAt }),
      modifiedAt: last.modifiedAt,
      path: last.path
    };
  }
  return records;
}
