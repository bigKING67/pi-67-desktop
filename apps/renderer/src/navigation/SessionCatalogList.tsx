import type { SessionCatalogSource, SessionCatalogState } from "@pi67/domain";
import { useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import { useAppStore } from "../app/app-store.js";
import { messages } from "../localization/message-catalog.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  selectSessionId,
  selectSessionPath
} from "../session/session-projection-selectors.js";
import { openRendererSession } from "../session/session-lifecycle-controller.js";
import styles from "./NavigationRail.module.css";
import { loadMoreSessionCatalog } from "./session-catalog-controller.js";
import { useSessionCatalogStore } from "./session-catalog-store.js";
import { SessionNavigationRowView } from "./SessionNavigationRow.js";
import { buildSessionNavigationRows } from "./session-navigation.js";

export function SessionCatalogList({ query }: { query: string }) {
  const sessionId = useSessionProjectionStore(selectSessionId);
  const sessionPath = useSessionProjectionStore(selectSessionPath);
  const operation = useAppStore((state) => state.operation);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const sessions = useSessionCatalogStore((state) => state.items);
  const total = useSessionCatalogStore((state) => state.total);
  const loading = useSessionCatalogStore((state) => state.loading);
  const rebuilding = useSessionCatalogStore((state) => state.rebuilding);
  const catalogState = useSessionCatalogStore((state) => state.catalogState);
  const catalogSource = useSessionCatalogStore((state) => state.source);
  const incomplete = useSessionCatalogStore((state) => state.incomplete);
  const skippedCount = useSessionCatalogStore((state) => state.skippedCount);
  const catalogError = useSessionCatalogStore((state) => state.error);

  const rows = useMemo(() => buildSessionNavigationRows({
    sessions,
    ...(sessionPath ? { activePath: sessionPath } : {}),
    ...(sessionId ? { activeSessionId: sessionId } : {}),
    ...(operation ? { operation } : {})
  }), [operation, sessionId, sessionPath, sessions]);
  const catalogNotice = catalogError
    ? messages.navigation.catalogUnavailable(catalogError)
    : catalogStatusNotice({
      state: catalogState,
      source: catalogSource,
      incomplete,
      skippedCount
    });

  return (
    <div className={styles.listRegion}>
      <p className="sr-only" role="status">
        {query ? messages.navigation.matchingCount(total) : messages.navigation.totalCount(total)}
      </p>
      {catalogNotice ? (
        <p className={styles.catalogNotice} role="status">{catalogNotice}</p>
      ) : null}
      {rows.length === 0 ? (
        <p className={styles.empty}>{catalogEmptyState({
          query,
          loading,
          rebuilding,
          error: catalogError,
          state: catalogState,
          incomplete
        })}</p>
      ) : (
        <nav className={styles.sessionList} aria-label={messages.navigation.sessionList}>
          <Virtuoso
            data={rows}
            endReached={() => void loadMoreSessionCatalog()}
            computeItemKey={(_index, row) => row.kind === "group" ? `group-${row.id}` : row.key}
            itemContent={(_index, row) => (
              <SessionNavigationRowView
                row={row}
                disabled={sessionTransitionPending}
                onOpen={(path) => void openRendererSession(path)}
              />
            )}
            overscan={200}
          />
        </nav>
      )}
    </div>
  );
}

function catalogEmptyState(options: {
  query: string;
  loading: boolean;
  rebuilding: boolean;
  error: string | undefined;
  state: SessionCatalogState | undefined;
  incomplete: boolean;
}): string {
  if (options.rebuilding) return messages.navigation.catalogRebuilding;
  if (options.loading) return messages.navigation.catalogLoading;
  if (options.error) return messages.navigation.catalogUnavailable(options.error);
  if (options.state === "unavailable") {
    return messages.navigation.catalogTemporarilyUnavailable;
  }
  if (options.incomplete) return messages.navigation.catalogIncompleteEmpty;
  return options.query ? messages.navigation.noMatches : messages.navigation.noSessions;
}

function catalogStatusNotice(options: {
  state: SessionCatalogState | undefined;
  source: SessionCatalogSource | undefined;
  incomplete: boolean;
  skippedCount: number;
}): string | undefined {
  if (options.state === "rebuilding") return undefined;
  if (options.state === "unavailable") {
    return messages.navigation.catalogRetry;
  }
  const notices: string[] = [];
  if (options.state === "fallback" || options.source === "sdk-fallback") {
    notices.push(messages.navigation.catalogFallback);
  }
  if (options.incomplete && options.skippedCount > 0) {
    notices.push(messages.navigation.skippedSessions(options.skippedCount));
  } else if (options.incomplete) {
    notices.push(messages.navigation.catalogIncomplete);
  }
  return notices.length > 0 ? notices.join(" ") : undefined;
}
