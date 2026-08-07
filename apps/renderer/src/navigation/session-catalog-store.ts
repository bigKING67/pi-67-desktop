import {
  MAX_SESSION_CATALOG_SEARCH_CHARS,
  type ConversationKey,
  type SessionCatalogCursor,
  type SessionCatalogDegradedReason,
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
  degradedReason: SessionCatalogDegradedReason | undefined;
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

interface SessionCatalogUiState {
  byWorkspace: Record<WorkspaceId, WorkspaceSessionCatalogState>;
  beginFirstPage: (
    workspaceId: WorkspaceId,
    options?: { query?: string; refresh?: boolean }
  ) => SessionCatalogFirstPageTarget;
  finishFirstPage: (target: SessionCatalogFirstPageTarget, page: SessionCatalogPage) => boolean;
  failFirstPage: (target: SessionCatalogFirstPageTarget, error: string) => boolean;
  beginNextPage: (workspaceId: WorkspaceId) => SessionCatalogNextPageTarget | undefined;
  finishNextPage: (target: SessionCatalogNextPageTarget, page: SessionCatalogPage) => boolean;
  failNextPage: (target: SessionCatalogNextPageTarget, error: string) => boolean;
  cancelNextPage: (target: SessionCatalogNextPageTarget) => boolean;
  applyStatus: (workspaceId: WorkspaceId, status: SessionCatalogStatus) => void;
  invalidateRevision: (workspaceId: WorkspaceId, revision: number) => boolean;
  reset: (workspaceId?: WorkspaceId) => void;
}

const EMPTY_WORKSPACE_CATALOG = emptyCatalogState();
let nextRequestRevision = 1;

export const useSessionCatalogStore = create<SessionCatalogUiState>((set, get) => ({
  byWorkspace: {},

  beginFirstPage(workspaceId, options = {}) {
    const current = catalogForWorkspace(get(), workspaceId);
    const query = normalizeSessionCatalogQuery(options.query ?? current.query);
    const requestRevision = claimRequestRevision();
    const replacingQuery = query !== current.query;
    installWorkspaceCatalog(set, workspaceId, {
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
    installWorkspaceCatalog(set, target.workspaceId, {
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
    installWorkspaceCatalog(set, target.workspaceId, {
      ...current,
      loading: false,
      loadingMore: false,
      error
    });
    return true;
  },

  beginNextPage(workspaceId) {
    const current = catalogForWorkspace(get(), workspaceId);
    if (current.loading || current.loadingMore || !current.hasMore || !current.nextCursor) return undefined;
    const requestRevision = claimRequestRevision();
    installWorkspaceCatalog(set, workspaceId, {
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
    installWorkspaceCatalog(set, target.workspaceId, {
      ...pageState(page),
      items: mergeByFileIdentity(current.items, page.items),
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
    installWorkspaceCatalog(set, target.workspaceId, { ...current, loadingMore: false, error });
    return true;
  },

  cancelNextPage(target) {
    if (!isCurrentRequest(get(), target)) return false;
    const current = catalogForWorkspace(get(), target.workspaceId);
    installWorkspaceCatalog(set, target.workspaceId, { ...current, loadingMore: false });
    return true;
  },

  applyStatus(workspaceId, status) {
    const current = catalogForWorkspace(get(), workspaceId);
    const revisionChanged = current.revision !== status.revision;
    installWorkspaceCatalog(set, workspaceId, {
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
      degradedReason: status.degradedReason,
      source: status.source,
      catalogState: status.state,
      incomplete: status.incomplete,
      skippedCount: status.skippedCount,
      itemCount: status.itemCount,
      reconciledAt: status.reconciledAt,
      requestRevision: revisionChanged ? claimRequestRevision() : current.requestRevision
    });
  },

  invalidateRevision(workspaceId, revision) {
    const current = catalogForWorkspace(get(), workspaceId);
    if (current.revision === revision && !current.rebuilding) return false;
    if (current.revision !== revision) {
      installWorkspaceCatalog(set, workspaceId, {
        ...current,
        items: [],
        total: 0,
        nextCursor: undefined,
        hasMore: false,
        revision,
        loading: false,
        loadingMore: false,
        error: undefined,
        requestRevision: claimRequestRevision()
      });
    }
    return true;
  },

  reset(workspaceId) {
    if (workspaceId) {
      installWorkspaceCatalog(set, workspaceId, emptyCatalogState(claimRequestRevision()));
      return;
    }
    set({ byWorkspace: {} });
  }
}));

export function selectWorkspaceSessionCatalog(
  state: SessionCatalogUiState,
  workspaceId: WorkspaceId
): WorkspaceSessionCatalogState {
  return state.byWorkspace[workspaceId] ?? EMPTY_WORKSPACE_CATALOG;
}

export function selectConversationSessionSummary(
  state: SessionCatalogUiState,
  conversation: ConversationKey | undefined
): SessionSummary | undefined {
  if (conversation?.kind !== "session") return undefined;
  return selectWorkspaceSessionCatalog(state, conversation.workspaceId).items.find((session) => (
    session.fileIdentity === conversation.sessionFileIdentity
  ));
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
    degradedReason: undefined,
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
    degradedReason: page.degradedReason,
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
  return state.byWorkspace[workspaceId] ?? EMPTY_WORKSPACE_CATALOG;
}

function installWorkspaceCatalog(
  set: (partial: Partial<SessionCatalogUiState> | ((state: SessionCatalogUiState) => Partial<SessionCatalogUiState>)) => void,
  workspaceId: WorkspaceId,
  catalog: WorkspaceSessionCatalogState
): void {
  set((state) => ({
    byWorkspace: { ...state.byWorkspace, [workspaceId]: catalog }
  }));
}

function mergeByFileIdentity(current: SessionSummary[], next: SessionSummary[]): SessionSummary[] {
  const nextByIdentity = new Map(next.map((session) => [session.fileIdentity, session]));
  const merged = current.map((session) => nextByIdentity.get(session.fileIdentity) ?? session);
  const seen = new Set(current.map((session) => session.fileIdentity));
  return [
    ...merged,
    ...[...nextByIdentity.values()].filter((session) => !seen.has(session.fileIdentity))
  ];
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

function claimRequestRevision(): number {
  const revision = nextRequestRevision;
  nextRequestRevision += 1;
  return revision;
}
