import {
  FilePlus2,
  FolderOpen
} from "lucide-react";
import type { RefObject } from "react";
import { Button } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { messages } from "../localization/message-catalog.js";
import { importRendererSessionFile } from "../session/session-import-controller.js";
import { createRendererSession } from "../session/session-lifecycle-controller.js";
import { openRendererWorkspace } from "../workspace/workspace-open-controller.js";
import styles from "./NavigationRail.module.css";
import { queryFirstSessionCatalog } from "./session-catalog-controller.js";
import { useSessionCatalogStore } from "./session-catalog-store.js";
import { SessionCatalogList } from "./SessionCatalogList.js";
import { SessionCatalogMenu } from "./SessionCatalogMenu.js";
import {
  SessionCatalogSearch,
  useSessionCatalogSearch
} from "./SessionCatalogSearch.js";

export function NavigationRail({
  containerRef
}: {
  containerRef?: RefObject<HTMLElement | null>;
}) {
  const workspace = useAppStore((state) => state.workspace);
  const connected = useAppStore((state) => state.connected);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const catalogQuery = useSessionCatalogStore((state) => state.query);
  const loadingMore = useSessionCatalogStore((state) => state.loadingMore);
  const { query, setQuery } = useSessionCatalogSearch(connected, catalogQuery);

  return (
    <aside ref={containerRef} className="navigation-rail" id="session-navigation" aria-label={messages.navigation.region}>
      <div className="workspace-switcher">
        <div>
          <span className="section-label">{messages.navigation.workspace}</span>
          <strong title={workspace}>{basename(workspace ?? "")}</strong>
        </div>
        <Button className="icon-button" aria-label={messages.navigation.switchWorkspace} onPress={() => void openRendererWorkspace()}>
          <FolderOpen aria-hidden="true" size={15} />
        </Button>
      </div>

      <div className={styles.actions}>
        <Button
          className={styles.createButton!}
          isDisabled={sessionTransitionPending}
          onPress={() => void createRendererSession()}
        >
          <FilePlus2 aria-hidden="true" size={15} />
          {messages.navigation.createSession}
        </Button>
        <SessionCatalogSearch query={query} onQueryChange={setQuery} />
      </div>

      <SessionCatalogList query={query} />

      <footer className={`navigation-footer ${styles.footer}`}>
        {loadingMore ? <span className={styles.loadingMore}>{messages.navigation.loadingMore}</span> : null}
        <SessionCatalogMenu
          disabled={sessionTransitionPending}
          onImport={() => void importRendererSessionFile()}
          onRefresh={() => void queryFirstSessionCatalog({ query, refresh: true })}
        />
      </footer>
    </aside>
  );
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
