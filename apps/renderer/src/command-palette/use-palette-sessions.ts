import type { SessionSummary } from "@pi67/domain";
import { useEffect, useMemo, useState } from "react";
import { appLocale, messages } from "../localization/message-catalog.js";
import { querySessionCatalogPage } from "../navigation/session-catalog-controller.js";
import {
  normalizeSessionCatalogQuery,
  useSessionCatalogStore
} from "../navigation/session-catalog-store.js";
import { MAX_SESSION_CANDIDATES } from "./command-palette-model.js";

export type PaletteSessionSearchState =
  | { status: "idle"; query: ""; sessions: SessionSummary[] }
  | { status: "loading"; query: string; sessions: SessionSummary[] }
  | { status: "ready"; query: string; sessions: SessionSummary[] }
  | { status: "unavailable"; query: string; sessions: SessionSummary[] }
  | { status: "failed"; query: string; sessions: SessionSummary[]; error: string };

type RemoteSearchState =
  | { owner: string; status: "loading"; sessions: SessionSummary[] }
  | { owner: string; status: "ready"; sessions: SessionSummary[] }
  | { owner: string; status: "failed"; sessions: SessionSummary[]; error: string };

export function usePaletteSessions(options: {
  open: boolean;
  connected: boolean;
  hostEpoch: number | undefined;
  query: string;
}): PaletteSessionSearchState {
  const recentSessions = useSessionCatalogStore((state) => state.items);
  const [remote, setRemote] = useState<RemoteSearchState>();
  const query = normalizeSessionCatalogQuery(options.query);
  const fallback = useMemo(
    () => filterPaletteSessionFallback(recentSessions, query),
    [query, recentSessions]
  );
  const owner = `${options.hostEpoch ?? "disconnected"}:${query}`;

  useEffect(() => {
    if (!options.open || !options.connected || options.hostEpoch === undefined || !query) {
      setRemote(undefined);
      return;
    }
    let active = true;
    setRemote({ owner, status: "loading", sessions: fallback });
    const timer = window.setTimeout(() => {
      void querySessionCatalogPage({ query })
        .then((page) => {
          if (active) setRemote({ owner, status: "ready", sessions: page.items });
        })
        .catch(() => {
          if (active) {
            setRemote({
              owner,
              status: "failed",
              sessions: fallback,
              error: messages.commandPalette.sessionSearchFallback
            });
          }
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [fallback, options.connected, options.hostEpoch, options.open, owner, query]);

  if (!options.open || !query) {
    return { status: "idle", query: "", sessions: recentSessions.slice(0, MAX_SESSION_CANDIDATES) };
  }
  if (!options.connected || options.hostEpoch === undefined) {
    return { status: "unavailable", query, sessions: fallback };
  }
  if (!remote || remote.owner !== owner) return { status: "loading", query, sessions: fallback };
  return remote.status === "failed"
    ? { status: "failed", query, sessions: remote.sessions, error: remote.error }
    : { status: remote.status, query, sessions: remote.sessions };
}

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
