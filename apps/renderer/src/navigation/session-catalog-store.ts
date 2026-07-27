import {
  MAX_SESSION_CATALOG_SEARCH_CHARS,
  type SessionCatalogCursor,
  type SessionCatalogPage,
  type SessionCatalogSource,
  type SessionCatalogState,
  type SessionCatalogStatus,
  type SessionSummary
} from "@pi67/domain";
import { create } from "zustand";

interface SessionCatalogFirstPageTarget {
  requestRevision: number;
  query: string;
  refresh: boolean;
}

interface SessionCatalogNextPageTarget {
  requestRevision: number;
  query: string;
  cursor: SessionCatalogCursor;
}

interface SessionCatalogUiState {
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
  beginFirstPage: (options?: { query?: string; refresh?: boolean }) => SessionCatalogFirstPageTarget;
  finishFirstPage: (target: SessionCatalogFirstPageTarget, page: SessionCatalogPage) => boolean;
  failFirstPage: (target: SessionCatalogFirstPageTarget, error: string) => boolean;
  beginNextPage: () => SessionCatalogNextPageTarget | undefined;
  finishNextPage: (target: SessionCatalogNextPageTarget, page: SessionCatalogPage) => boolean;
  failNextPage: (target: SessionCatalogNextPageTarget, error: string) => boolean;
  cancelNextPage: (target: SessionCatalogNextPageTarget) => boolean;
  applyStatus: (status: SessionCatalogStatus) => void;
  invalidateRevision: (revision: number) => boolean;
  reset: () => void;
}

export const useSessionCatalogStore = create<SessionCatalogUiState>((set, get) => ({
  ...emptyCatalogState(),

  beginFirstPage(options = {}) {
    const query = normalizeSessionCatalogQuery(options.query ?? get().query);
    const current = get();
    const requestRevision = current.requestRevision + 1;
    const replacingQuery = query !== current.query;
    set({
      ...(replacingQuery ? { items: [], total: 0, nextCursor: undefined, hasMore: false } : {}),
      query,
      loading: true,
      loadingMore: false,
      error: undefined,
      requestRevision
    });
    return { requestRevision, query, refresh: options.refresh === true };
  },

  finishFirstPage(target, page) {
    if (!isCurrentRequest(get(), target.requestRevision)) return false;
    set({ ...pageState(page), query: target.query, loading: false });
    return true;
  },

  failFirstPage(target, error) {
    if (!isCurrentRequest(get(), target.requestRevision)) return false;
    set({ loading: false, loadingMore: false, error });
    return true;
  },

  beginNextPage() {
    const state = get();
    if (state.loading || state.loadingMore || !state.hasMore || !state.nextCursor) return undefined;
    const requestRevision = state.requestRevision + 1;
    set({ loadingMore: true, error: undefined, requestRevision });
    return { requestRevision, query: state.query, cursor: state.nextCursor };
  },

  finishNextPage(target, page) {
    if (!isCurrentRequest(get(), target.requestRevision)) return false;
    set((current) => ({
      ...pageState(page),
      items: mergeByPath(current.items, page.items),
      query: current.query,
      loadingMore: false
    }));
    return true;
  },

  failNextPage(target, error) {
    if (!isCurrentRequest(get(), target.requestRevision)) return false;
    set({ loadingMore: false, error });
    return true;
  },

  cancelNextPage(target) {
    if (!isCurrentRequest(get(), target.requestRevision)) return false;
    set({ loadingMore: false });
    return true;
  },

  applyStatus(status) {
    const current = get();
    const revisionChanged = current.revision !== status.revision;
    set({
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

  invalidateRevision(revision) {
    const current = get();
    if (current.revision === revision && !current.rebuilding) return false;
    if (current.revision !== revision) {
      set({
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

  reset() {
    set(emptyCatalogState(get().requestRevision + 1));
  }
}));

function emptyCatalogState(requestRevision = 0) {
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

function pageState(page: SessionCatalogPage) {
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

function mergeByPath(current: SessionSummary[], next: SessionSummary[]): SessionSummary[] {
  const seen = new Set(current.map((session) => session.path));
  return [...current, ...next.filter((session) => !seen.has(session.path))];
}

export function normalizeSessionCatalogQuery(query: string): string {
  return query.normalize("NFKC").trim().slice(0, MAX_SESSION_CATALOG_SEARCH_CHARS);
}

function isCurrentRequest(state: SessionCatalogUiState, requestRevision: number): boolean {
  return state.requestRevision === requestRevision;
}
