type SessionCatalogSource = "sqlite" | "sdk-fallback";
type SessionCatalogState = "ready" | "rebuilding" | "fallback" | "unavailable";
export type SessionCatalogDegradedReason = "busy" | "unavailable" | "runtime-load" | "storage-prepare"
  | "storage-inspect" | "database-open" | "database-verify" | "schema-prepare" | "recovery-prepare"
  | "recovery-open" | "recovery-verify" | "recovery-schema" | "runtime-query";

export interface FixtureSessionSummary {
  id: string;
  fileIdentity: string;
  path: string;
  cwd: string;
  name: string;
  nameSource?: "explicit" | "generated" | "seed" | "fallback";
  pinnedAt?: number;
  snoozedUntil?: number;
  archivedAt?: number;
  modifiedAt: number;
  messageCount: number;
  parentSessionPath?: string;
}

export interface FixtureSessionCatalogStatus {
  revision: number;
  source: SessionCatalogSource;
  state: SessionCatalogState;
  rebuilding: boolean;
  degradedReason?: SessionCatalogDegradedReason;
  reconciledAt?: number;
  itemCount: number;
  incomplete: boolean;
  skippedCount: number;
}

interface FixtureSessionCatalogPage extends FixtureSessionCatalogStatus {
  items: FixtureSessionSummary[];
  total: number;
  hasMore: boolean;
  nextCursor?: FixtureSessionCatalogCursor;
}

interface FixtureSessionCatalogCursor {
  revision: number;
  queryKey: string;
  pinnedAt?: number;
  archivedAt?: number;
  modifiedAt: number;
  path: string;
}

export interface SessionCatalogFixtureOptions {
  items?: FixtureSessionSummary[];
  revision?: number;
  source?: SessionCatalogSource;
  state?: SessionCatalogState;
  rebuilding?: boolean;
  degradedReason?: SessionCatalogDegradedReason;
  reconciledAt?: number;
  incomplete?: boolean;
  skippedCount?: number;
}

export type SessionCatalogFixturePatch = SessionCatalogFixtureOptions;

export interface SessionCatalogRequestRecord {
  hostEpoch: number;
  payload: {
    scope?: string;
    view?: "active" | "archived";
    search?: string;
    cursor?: FixtureSessionCatalogCursor;
    limit?: number;
    refresh?: boolean;
  };
}

const FIXTURE_QUERY_KEY = "0".repeat(64);

export const MOCK_SESSION_CATALOG_STATUS: FixtureSessionCatalogStatus = {
  revision: 1,
  source: "sqlite",
  state: "ready",
  rebuilding: false,
  reconciledAt: 1_753_000_000_000,
  itemCount: 0,
  incomplete: false,
  skippedCount: 0
};

export function mockSessionCatalogPage(sessions: FixtureSessionSummary[]): FixtureSessionCatalogPage {
  return createPage(sessions, MOCK_SESSION_CATALOG_STATUS, {}, 50);
}

export function normalizedSessionCatalogOptions(options: SessionCatalogFixtureOptions) {
  return {
    items: options.items ?? [],
    revision: options.revision ?? MOCK_SESSION_CATALOG_STATUS.revision,
    source: options.source ?? MOCK_SESSION_CATALOG_STATUS.source,
    state: options.state ?? MOCK_SESSION_CATALOG_STATUS.state,
    rebuilding: options.rebuilding ?? MOCK_SESSION_CATALOG_STATUS.rebuilding,
    ...(options.degradedReason === undefined ? {} : { degradedReason: options.degradedReason }),
    ...(options.reconciledAt === undefined
      ? { reconciledAt: MOCK_SESSION_CATALOG_STATUS.reconciledAt }
      : { reconciledAt: options.reconciledAt }),
    incomplete: options.incomplete ?? MOCK_SESSION_CATALOG_STATUS.incomplete,
    skippedCount: options.skippedCount ?? MOCK_SESSION_CATALOG_STATUS.skippedCount
  };
}

function createPage(
  sessions: FixtureSessionSummary[],
  status: FixtureSessionCatalogStatus,
  cursor: Partial<FixtureSessionCatalogCursor>,
  limit: number
): FixtureSessionCatalogPage {
  const sorted = sessions
    .filter((session) => session.archivedAt === undefined)
    .map((session) => ({ ...session, nameSource: session.nameSource ?? "explicit" as const }))
    .sort((left, right) => (right.pinnedAt ?? -1) - (left.pinnedAt ?? -1)
      || right.modifiedAt - left.modifiedAt
      || right.path.localeCompare(left.path));
  const start = cursor.path === undefined
    ? 0
    : Math.max(0, sorted.findIndex((item) => item.path === cursor.path && item.modifiedAt === cursor.modifiedAt) + 1);
  const items = sorted.slice(start, start + limit);
  const hasMore = start + items.length < sorted.length;
  const last = items.at(-1);
  return {
    ...status,
    itemCount: sessions.length,
    items,
    total: sessions.length,
    hasMore,
    ...(hasMore && last ? {
      nextCursor: {
        revision: status.revision,
        queryKey: FIXTURE_QUERY_KEY,
        ...(last.pinnedAt === undefined ? {} : { pinnedAt: last.pinnedAt }),
        modifiedAt: last.modifiedAt,
        path: last.path
      }
    } : {})
  };
}
