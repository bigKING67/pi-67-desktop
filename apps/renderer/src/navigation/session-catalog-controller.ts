import {
  DEFAULT_SESSION_CATALOG_PAGE_ITEMS,
  type SessionCatalogCursor,
  type SessionCatalogPage,
  type WorkspaceId
} from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import {
  normalizeSessionCatalogQuery,
  useSessionCatalogStore
} from "./session-catalog-store.js";

export async function queryFirstSessionCatalog(
  workspaceOrOptions: WorkspaceId | { query?: string; refresh?: boolean } = {},
  maybeOptions: { query?: string; refresh?: boolean } = {}
): Promise<boolean> {
  const { workspaceId, options } = catalogRequestArguments(workspaceOrOptions, maybeOptions);
  if (!workspaceId) return false;
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

export async function loadMoreSessionCatalog(workspaceId = currentWorkspaceId()): Promise<void> {
  if (!workspaceId) return;
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
  workspaceOrRevision: WorkspaceId | number,
  maybeRevision?: number
): void {
  const workspaceId = typeof workspaceOrRevision === "string"
    ? workspaceOrRevision
    : currentWorkspaceId();
  const revision = typeof workspaceOrRevision === "string"
    ? maybeRevision
    : workspaceOrRevision;
  if (!workspaceId || revision === undefined) return;
  const store = useSessionCatalogStore.getState();
  const catalog = store.byWorkspace[workspaceId];
  if (store.invalidateRevision(workspaceId, revision)) {
    void queryFirstSessionCatalog(workspaceId, { query: catalog?.query ?? "" });
  }
}

export function querySessionCatalogPage(options: {
  workspaceId?: WorkspaceId;
  query?: string;
  cursor?: SessionCatalogCursor;
  refresh?: boolean;
} = {}): Promise<SessionCatalogPage> {
  const workspaceId = options.workspaceId ?? currentWorkspaceId();
  if (!workspaceId) return Promise.reject(new Error("没有可查询的工作区。"));
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

function catalogRequestArguments(
  workspaceOrOptions: WorkspaceId | { query?: string; refresh?: boolean },
  maybeOptions: { query?: string; refresh?: boolean }
): { workspaceId: WorkspaceId | undefined; options: { query?: string; refresh?: boolean } } {
  return typeof workspaceOrOptions === "string"
    ? { workspaceId: workspaceOrOptions, options: maybeOptions }
    : { workspaceId: currentWorkspaceId(), options: workspaceOrOptions };
}

function currentWorkspaceId(): WorkspaceId | undefined {
  return rendererWorkbenchStore.getState().currentWorkspaceId;
}
