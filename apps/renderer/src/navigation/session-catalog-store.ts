import {
  MAX_SESSION_CATALOG_SEARCH_CHARS,
  type SessionCatalogCursor,
  type SessionCatalogPage,
  type SessionCatalogSource,
  type SessionCatalogState,
  type SessionCatalogStatus,
  type SessionSummary,
  type WorkspaceId
} from "@pi67/domain";
import { create } from "zustand";

export interface WorkspaceSessionCatalogState {
  items: SessionSummary[];
  total: number;
  nextCursor: SessionCatalogCursor | undefined;
  hasMore: boolean;
  revision: number | undefined;
  query: string;
  loading: boolean;
  loadingMore: boolean;
  rebuilding: boolean;
  source: SessionCatalogSource | undefined;
  catalogState: SessionCatalogState | undefined;
  incomplete: boolean;
  skippedCount: number;
  itemCount: number;
  reconciledAt: number | undefined;
  error: string | undefined;
  requestRevision: number;
}

interface SessionCatalogFirstPageTarget {
  workspaceId: WorkspaceId;
  requestRevision: number;
  query: string;
  refresh: boolean;
}

interface SessionCatalogNextPageTarget {
  workspaceId: WorkspaceId;
  requestRevision: number;
  query: string;
  cursor: SessionCatalogCursor;
}

interface SessionCatalogUiState extends WorkspaceSessionCatalogState {
  byWorkspace: Record<WorkspaceId, WorkspaceSessionCatalogState>;
  lastWorkspaceId: WorkspaceId | undefined;
  beginFirstPage: {
    (workspaceId: WorkspaceId, options?: { query?: string; refresh?: boolean }): SessionCatalogFirstPageTarget;
    (options?: { query?: string; refresh?: boolean }): SessionCatalogFirstPageTarget;
  };
  finishFirstPage: (target: SessionCatalogFirstPageTarget, page: SessionCatalogPage) => boolean;
  failFirstPage: (target: SessionCatalogFirstPageTarget, error: string) => boolean;
  beginNextPage: (workspaceId?: WorkspaceId) => SessionCatalogNextPageTarget | undefined;
  finishNextPage: (target: SessionCatalogNextPageTarget, page: SessionCatalogPage) => boolean;
  failNextPage: (target: SessionCatalogNextPageTarget, error: string) => boolean;
  cancelNextPage: (target: SessionCatalogNextPageTarget) => boolean;
  applyStatus: {
    (workspaceId: WorkspaceId, status: SessionCatalogStatus): void;
    (status: SessionCatalogStatus): void;
  };
  invalidateRevision: {
    (workspaceId: WorkspaceId, revision: number): boolean;
    (revision: number): boolean;
  };
  reset: (workspaceId?: WorkspaceId) => void;
}

const LEGACY_WORKSPACE_ID = "__active-workspace__";
const EMPTY_WORKSPACE_CATALOG = emptyCatalogState();

export const useSessionCatalogStore = create<SessionCatalogUiState>((set, get) => ({
  ...emptyCatalogState(),
  byWorkspace: {},
  lastWorkspaceId: undefined,

  beginFirstPage(
    workspaceOrOptions: WorkspaceId | { query?: string; refresh?: boolean } = {},
    maybeOptions: { query?: string; refresh?: boolean } = {}
  ) {
    const { workspaceId, options } = firstPageArguments(workspaceOrOptions, maybeOptions);
    const current = catalogForWorkspace(get(), workspaceId);
    const query = normalizeSessionCatalogQuery(options.query ?? current.query);
    const requestRevision = current.requestRevision + 1;
    const replacingQuery = query !== current.query;
    installWorkspaceCatalog(set, get, workspaceId, {
      ...current,
      ...(replacingQuery ? { items: [], total: 0, nextCursor: undefined, hasMore: false } : {}),
      query,
      loading: true,
      loadingMore: false,
      error: undefined,
      requestRevision
    });
    return { workspaceId, requestRevision, query, refresh: options.refresh === true };
  },

  finishFirstPage(target, page) {
    if (!isCurrentRequest(get(), target)) return false;
    installWorkspaceCatalog(set, get, target.workspaceId, {
      ...pageState(page),
      query: target.query,
      loading: false,
      loadingMore: false,
      requestRevision: target.requestRevision
    });
    return true;
  },

  failFirstPage(target, error) {
    if (!isCurrentRequest(get(), target)) return false;
    const current = catalogForWorkspace(get(), target.workspaceId);
    installWorkspaceCatalog(set, get, target.workspaceId, {
      ...current,
      loading: false,
      loadingMore: false,
      error
    });
    return true;
  },

  beginNextPage(workspaceId = LEGACY_WORKSPACE_ID) {
    const current = catalogForWorkspace(get(), workspaceId);
    if (current.loading || current.loadingMore || !current.hasMore || !current.nextCursor) return undefined;
    const requestRevision = current.requestRevision + 1;
    installWorkspaceCatalog(set, get, workspaceId, {
      ...current,
      loadingMore: true,
      error: undefined,
      requestRevision
    });
    return { workspaceId, requestRevision, query: current.query, cursor: current.nextCursor };
  },

  finishNextPage(target, page) {
    if (!isCurrentRequest(get(), target)) return false;
    const current = catalogForWorkspace(get(), target.workspaceId);
    installWorkspaceCatalog(set, get, target.workspaceId, {
      ...pageState(page),
      items: mergeByPath(current.items, page.items),
      query: current.query,
      loading: false,
      loadingMore: false,
      requestRevision: target.requestRevision
    });
    return true;
  },

  failNextPage(target, error) {
    if (!isCurrentRequest(get(), target)) return false;
    const current = catalogForWorkspace(get(), target.workspaceId);
    installWorkspaceCatalog(set, get, target.workspaceId, { ...current, loadingMore: false, error });
    return true;
  },

  cancelNextPage(target) {
    if (!isCurrentRequest(get(), target)) return false;
    const current = catalogForWorkspace(get(), target.workspaceId);
    installWorkspaceCatalog(set, get, target.workspaceId, { ...current, loadingMore: false });
    return true;
  },

  applyStatus(
    workspaceOrStatus: WorkspaceId | SessionCatalogStatus,
    maybeStatus?: SessionCatalogStatus
  ) {
    const workspaceId = typeof workspaceOrStatus === "string" ? workspaceOrStatus : LEGACY_WORKSPACE_ID;
    const status = typeof workspaceOrStatus === "string" ? maybeStatus! : workspaceOrStatus;
    const current = catalogForWorkspace(get(), workspaceId);
    const revisionChanged = current.revision !== status.revision;
    installWorkspaceCatalog(set, get, workspaceId, {
      ...current,
      ...(revisionChanged ? {
        items: [],
        total: 0,
        nextCursor: undefined,
        hasMore: false,
        loading: false,
        loadingMore: false,
        error: undefined
      } : {}),
      revision: status.revision,
      rebuilding: status.rebuilding,
      source: status.source,
      catalogState: status.state,
      incomplete: status.incomplete,
      skippedCount: status.skippedCount,
      itemCount: status.itemCount,
      reconciledAt: status.reconciledAt,
      requestRevision: revisionChanged ? current.requestRevision + 1 : current.requestRevision
    });
  },

  invalidateRevision(workspaceOrRevision: WorkspaceId | number, maybeRevision?: number) {
    const workspaceId = typeof workspaceOrRevision === "string" ? workspaceOrRevision : LEGACY_WORKSPACE_ID;
    const revision = typeof workspaceOrRevision === "string" ? maybeRevision! : workspaceOrRevision;
    const current = catalogForWorkspace(get(), workspaceId);
    if (current.revision === revision && !current.rebuilding) return false;
    if (current.revision !== revision) {
      installWorkspaceCatalog(set, get, workspaceId, {
        ...current,
        items: [],
        total: 0,
        nextCursor: undefined,
        hasMore: false,
        revision,
        loading: false,
        loadingMore: false,
        error: undefined,
        requestRevision: current.requestRevision + 1
      });
    }
    return true;
  },

  reset(workspaceId) {
    if (workspaceId) {
      const current = catalogForWorkspace(get(), workspaceId);
      installWorkspaceCatalog(set, get, workspaceId, emptyCatalogState(current.requestRevision + 1));
      return;
    }
    set((current) => ({
      ...emptyCatalogState(current.requestRevision + 1),
      byWorkspace: {},
      lastWorkspaceId: undefined
    }));
  }
}));

export function selectWorkspaceSessionCatalog(
  state: SessionCatalogUiState,
  workspaceId: WorkspaceId
): WorkspaceSessionCatalogState {
  return state.byWorkspace[workspaceId] ?? EMPTY_WORKSPACE_CATALOG;
}

function emptyCatalogState(requestRevision = 0): WorkspaceSessionCatalogState {
  return {
    items: [],
    total: 0,
    nextCursor: undefined,
    hasMore: false,
    revision: undefined,
    query: "",
    loading: false,
    loadingMore: false,
    rebuilding: false,
    source: undefined,
    catalogState: undefined,
    incomplete: false,
    skippedCount: 0,
    itemCount: 0,
    reconciledAt: undefined,
    error: undefined,
    requestRevision
  };
}

function pageState(page: SessionCatalogPage): Omit<WorkspaceSessionCatalogState, "query" | "loading" | "loadingMore" | "requestRevision"> {
  return {
    items: page.items,
    total: page.total,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    revision: page.revision,
    rebuilding: page.rebuilding,
    source: page.source,
    catalogState: page.state,
    incomplete: page.incomplete,
    skippedCount: page.skippedCount,
    itemCount: page.itemCount,
    reconciledAt: page.reconciledAt,
    error: undefined
  };
}

function catalogForWorkspace(state: SessionCatalogUiState, workspaceId: WorkspaceId): WorkspaceSessionCatalogState {
  if (workspaceId !== LEGACY_WORKSPACE_ID) return state.byWorkspace[workspaceId] ?? EMPTY_WORKSPACE_CATALOG;
  return pickCatalogSnapshot(state);
}

function installWorkspaceCatalog(
  set: (partial: Partial<SessionCatalogUiState> | ((state: SessionCatalogUiState) => Partial<SessionCatalogUiState>)) => void,
  get: () => SessionCatalogUiState,
  workspaceId: WorkspaceId,
  catalog: WorkspaceSessionCatalogState
): void {
  if (workspaceId === LEGACY_WORKSPACE_ID) {
    set({ ...catalog, lastWorkspaceId: undefined });
    return;
  }
  set({
    ...catalog,
    byWorkspace: { ...get().byWorkspace, [workspaceId]: catalog },
    lastWorkspaceId: workspaceId
  });
}

function pickCatalogSnapshot(state: SessionCatalogUiState): WorkspaceSessionCatalogState {
  const {
    items, total, nextCursor, hasMore, revision, query, loading, loadingMore,
    rebuilding, source, catalogState, incomplete, skippedCount, itemCount,
    reconciledAt, error, requestRevision
  } = state;
  return {
    items, total, nextCursor, hasMore, revision, query, loading, loadingMore,
    rebuilding, source, catalogState, incomplete, skippedCount, itemCount,
    reconciledAt, error, requestRevision
  };
}

function firstPageArguments(
  workspaceOrOptions: WorkspaceId | { query?: string; refresh?: boolean },
  maybeOptions: { query?: string; refresh?: boolean }
): { workspaceId: WorkspaceId; options: { query?: string; refresh?: boolean } } {
  return typeof workspaceOrOptions === "string"
    ? { workspaceId: workspaceOrOptions, options: maybeOptions }
    : { workspaceId: LEGACY_WORKSPACE_ID, options: workspaceOrOptions };
}

function mergeByPath(current: SessionSummary[], next: SessionSummary[]): SessionSummary[] {
  const seen = new Set(current.map((session) => session.path));
  return [...current, ...next.filter((session) => !seen.has(session.path))];
}

export function normalizeSessionCatalogQuery(query: string): string {
  return query.normalize("NFKC").trim().slice(0, MAX_SESSION_CATALOG_SEARCH_CHARS);
}

function isCurrentRequest(
  state: SessionCatalogUiState,
  target: SessionCatalogFirstPageTarget | SessionCatalogNextPageTarget
): boolean {
  return catalogForWorkspace(state, target.workspaceId).requestRevision === target.requestRevision;
}
