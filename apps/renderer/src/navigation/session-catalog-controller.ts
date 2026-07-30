import {
  DEFAULT_SESSION_CATALOG_PAGE_ITEMS,
  type SessionCatalogCursor,
  type SessionCatalogPage,
  type WorkspaceId
} from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import {
  normalizeSessionCatalogQuery,
  useSessionCatalogStore
} from "./session-catalog-store.js";

export async function queryFirstSessionCatalog(
  workspaceId: WorkspaceId,
  options: { query?: string; refresh?: boolean } = {}
): Promise<boolean> {
  const store = useSessionCatalogStore.getState();
  const target = store.beginFirstPage(workspaceId, options);
  try {
    const page = await querySessionCatalogPage({
      workspaceId,
      query: target.query,
      ...(target.refresh ? { refresh: true } : {})
    });
    return store.finishFirstPage(target, page);
  } catch (error) {
    store.failFirstPage(target, errorMessage(error));
    return false;
  }
}

export async function loadMoreSessionCatalog(workspaceId: WorkspaceId): Promise<void> {
  const store = useSessionCatalogStore.getState();
  const target = store.beginNextPage(workspaceId);
  if (!target) return;
  try {
    const page = await querySessionCatalogPage({ workspaceId, query: target.query, cursor: target.cursor });
    store.finishNextPage(target, page);
  } catch (error) {
    if (error instanceof ProtocolRequestError && error.code === "STALE_SESSION_CATALOG") {
      if (store.cancelNextPage(target)) await queryFirstSessionCatalog(workspaceId, { query: target.query });
      return;
    }
    store.failNextPage(target, errorMessage(error));
  }
}

export function handleSessionCatalogChanged(
  workspaceId: WorkspaceId,
  revision: number
): void {
  const store = useSessionCatalogStore.getState();
  const catalog = store.byWorkspace[workspaceId];
  if (store.invalidateRevision(workspaceId, revision)) {
    void queryFirstSessionCatalog(workspaceId, { query: catalog?.query ?? "" });
  }
}

export function querySessionCatalogPage(options: {
  workspaceId: WorkspaceId;
  query?: string;
  cursor?: SessionCatalogCursor;
  refresh?: boolean;
}): Promise<SessionCatalogPage> {
  const { workspaceId } = options;
  const query = normalizeSessionCatalogQuery(options.query ?? "");
  return agentConnectionController.request("session.catalog.query", {
    scope: "workspace",
    limit: DEFAULT_SESSION_CATALOG_PAGE_ITEMS,
    ...(query ? { search: query } : {}),
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...(options.refresh ? { refresh: true } : {})
  }, [], { context: { scope: "workspace", workspaceId } });
}

export async function queryWorkspaceSessionCatalogs(
  workspaceIds: readonly WorkspaceId[],
  options: { query?: string; refresh?: boolean } = {}
): Promise<void> {
  await Promise.all(workspaceIds.map((workspaceId) => queryFirstSessionCatalog(workspaceId, options)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "无法加载 Session 目录";
}
