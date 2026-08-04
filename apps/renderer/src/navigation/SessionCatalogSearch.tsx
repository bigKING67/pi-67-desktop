import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceId } from "@pi67/domain";
import {
  Button,
  Input,
  SearchField
} from "react-aria-components";
import { messages } from "../localization/message-catalog.js";
import { queryWorkspaceSessionCatalogs } from "./session-catalog-controller.js";
import { useSessionCatalogStore } from "./session-catalog-store.js";
import styles from "./NavigationRail.module.css";

export function useSessionCatalogSearch(
  connected: boolean,
  expandedWorkspaceIds: readonly WorkspaceId[],
  searchableWorkspaceIds: readonly WorkspaceId[] = expandedWorkspaceIds
) {
  const [query, setQuery] = useState("");
  const workspaceIds = query ? searchableWorkspaceIds : expandedWorkspaceIds;
  const hasFilteredCatalog = useSessionCatalogStore((state) => workspaceIds.some((workspaceId) => (
    Boolean(state.byWorkspace[workspaceId]?.query)
  )));
  const requestQuery = query ? query : hasFilteredCatalog ? "" : undefined;

  useEffect(() => {
    if (!connected || workspaceIds.length === 0 || requestQuery === undefined) return;
    const timer = window.setTimeout(() => {
      void queryWorkspaceSessionCatalogs(workspaceIds, { query: requestQuery });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [connected, requestQuery, workspaceIds]);

  return { query, setQuery };
}

export function SessionCatalogSearch({
  focusRevision,
  handledRevision,
  query,
  onFocusHandled,
  onQueryChange
}: {
  focusRevision: number;
  handledRevision: number;
  query: string;
  onFocusHandled: (revision: number) => void;
  onQueryChange: (query: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusRevision <= handledRevision) return;
    requestAnimationFrame(() => inputRef.current?.focus());
    onFocusHandled(focusRevision);
  }, [focusRevision, handledRevision, onFocusHandled]);

  return (
    <SearchField
      aria-label={messages.navigation.search}
      className={styles.search!}
      value={query}
      onChange={onQueryChange}
    >
      <Search aria-hidden="true" size={14} />
      <Input ref={inputRef} className={styles.searchInput!} placeholder={messages.navigation.search} />
      {query ? (
        <Button
          className={styles.clearButton!}
          aria-label={messages.navigation.clearSearch}
          onPress={() => onQueryChange("")}
        >
          <X aria-hidden="true" size={13} />
        </Button>
      ) : null}
    </SearchField>
  );
}
