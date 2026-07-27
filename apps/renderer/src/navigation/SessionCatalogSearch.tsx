import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  Input,
  SearchField
} from "react-aria-components";
import { messages } from "../localization/message-catalog.js";
import { queryFirstSessionCatalog } from "./session-catalog-controller.js";
import styles from "./NavigationRail.module.css";

export function useSessionCatalogSearch(
  connected: boolean,
  catalogQuery: string
) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!connected || query === catalogQuery) return;
    const timer = window.setTimeout(
      () => void queryFirstSessionCatalog({ query }),
      180
    );
    return () => window.clearTimeout(timer);
  }, [catalogQuery, connected, query]);

  return { query, setQuery };
}

export function SessionCatalogSearch({
  query,
  onQueryChange
}: {
  query: string;
  onQueryChange: (query: string) => void;
}) {
  return (
    <SearchField
      aria-label={messages.navigation.search}
      className={styles.search!}
      value={query}
      onChange={onQueryChange}
    >
      <Search aria-hidden="true" size={14} />
      <Input className={styles.searchInput!} placeholder={messages.navigation.search} />
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
