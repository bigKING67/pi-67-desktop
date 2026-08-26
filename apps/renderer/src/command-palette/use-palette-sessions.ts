import { DEFAULT_SESSION_CATALOG_PAGE_ITEMS, type SessionSummary } from "@pi67/domain";
import { useMemo } from "react";
import { appLocale, messages } from "../localization/message-catalog.js";
import {
  normalizeSessionCatalogQuery,
  selectWorkspaceSessionCatalog,
  useSessionCatalogStore
} from "../navigation/session-catalog-store.js";
import { createRendererReadQueryRequest } from "../query/renderer-read-query-client.js";
import { useDebouncedQueryValue } from "../query/use-debounced-query-value.js";
import { useRendererReadQuery } from "../query/use-renderer-read-query.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import { MAX_SESSION_CANDIDATES } from "./command-palette-model.js";

export type PaletteSessionSearchState =
  | { status: "idle"; query: ""; sessions: SessionSummary[] }
  | { status: "loading"; query: string; sessions: SessionSummary[] }
  | { status: "refreshing"; query: string; sessions: SessionSummary[] }
  | { status: "ready"; query: string; sessions: SessionSummary[] }
  | { status: "unavailable"; query: string; sessions: SessionSummary[] }
  | { status: "failed"; query: string; sessions: SessionSummary[]; error: string };

export function usePaletteSessions(options: {
  open: boolean;
  connected: boolean;
  query: string;
}): PaletteSessionSearchState {
  const workspaceId = useWorkbenchStore((state) => state.currentWorkspaceId);
  const recentSessions = useSessionCatalogStore((state) => (
    workspaceId ? selectWorkspaceSessionCatalog(state, workspaceId).items : EMPTY_SESSIONS
  ));
  const query = normalizeSessionCatalogQuery(options.query);
  const fallback = useMemo(
    () => filterPaletteSessionFallback(recentSessions, query),
    [query, recentSessions]
  );
  const settledQuery = useDebouncedQueryValue(
    query,
    options.open && workspaceId !== undefined && query.length > 0
  );
  const request = useMemo(() => workspaceId && settledQuery
    ? createRendererReadQueryRequest(
        "session.catalog.query",
        {
          scope: "workspace",
          limit: DEFAULT_SESSION_CATALOG_PAGE_ITEMS,
          search: settledQuery
        },
        { scope: "workspace", workspaceId }
      )
    : undefined, [settledQuery, workspaceId]);
  const remote = useRendererReadQuery(request);
  const remoteSessions = remote.data?.items ?? fallback;

  if (!options.open || !query) {
    return { status: "idle", query: "", sessions: recentSessions.slice(0, MAX_SESSION_CANDIDATES) };
  }
  if (!options.connected) {
    return { status: "unavailable", query, sessions: remoteSessions };
  }
  if (!request) return { status: "loading", query, sessions: fallback };
  if (remote.status === "error") {
    return {
      status: "failed",
      query,
      sessions: remoteSessions,
      error: messages.commandPalette.sessionSearchFallback
    };
  }
  if (remote.status === "unavailable") {
    return { status: "unavailable", query, sessions: remoteSessions };
  }
  return { status: remote.status, query, sessions: remoteSessions };
}

const EMPTY_SESSIONS: SessionSummary[] = [];

export function filterPaletteSessionFallback(
  sessions: readonly SessionSummary[],
  query: string
): SessionSummary[] {
  const normalizedQuery = normalizeSessionCatalogQuery(query).toLocaleLowerCase(appLocale);
  if (!normalizedQuery) return sessions.slice(0, MAX_SESSION_CANDIDATES);
  return sessions
    .filter((session) => (
      `${session.name} ${session.id} ${session.path} ${session.cwd}`
        .normalize("NFKC")
        .toLocaleLowerCase(appLocale)
        .includes(normalizedQuery)
    ))
    .slice(0, MAX_SESSION_CANDIDATES);
}
