import {
  DEFAULT_SESSION_CATALOG_PAGE_ITEMS,
  type SessionCatalogCursor,
  type SessionCatalogPage
} from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import {
  normalizeSessionCatalogQuery,
  useSessionCatalogStore
} from "./session-catalog-store.js";

export async function queryFirstSessionCatalog(
  options: { query?: string; refresh?: boolean } = {}
): Promise<void> {
  const store = useSessionCatalogStore.getState();
  const target = store.beginFirstPage(options);
  try {
    const page = await querySessionCatalogPage({
      query: target.query,
      ...(target.refresh ? { refresh: true } : {})
    });
    store.finishFirstPage(target, page);
  } catch (error) {
    store.failFirstPage(target, errorMessage(error));
  }
}

export async function loadMoreSessionCatalog(): Promise<void> {
  const store = useSessionCatalogStore.getState();
  const target = store.beginNextPage();
  if (!target) return;
  try {
    const page = await querySessionCatalogPage({ query: target.query, cursor: target.cursor });
    store.finishNextPage(target, page);
  } catch (error) {
    if (error instanceof ProtocolRequestError && error.code === "STALE_SESSION_CATALOG") {
      if (store.cancelNextPage(target)) await queryFirstSessionCatalog({ query: target.query });
      return;
    }
    store.failNextPage(target, errorMessage(error));
  }
}

export function handleSessionCatalogChanged(revision: number): void {
  const store = useSessionCatalogStore.getState();
  if (store.invalidateRevision(revision)) void queryFirstSessionCatalog({ query: store.query });
}

export function querySessionCatalogPage(options: {
  query?: string;
  cursor?: SessionCatalogCursor;
  refresh?: boolean;
} = {}): Promise<SessionCatalogPage> {
  const query = normalizeSessionCatalogQuery(options.query ?? "");
  return agentConnectionController.request("session.catalog.query", {
    scope: "workspace",
    limit: DEFAULT_SESSION_CATALOG_PAGE_ITEMS,
    ...(query ? { search: query } : {}),
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...(options.refresh ? { refresh: true } : {})
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "无法加载 Session 目录";
}
