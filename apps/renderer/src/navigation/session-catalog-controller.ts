import {
  DEFAULT_SESSION_CATALOG_PAGE_ITEMS,
  type SessionCatalogChangedReason,
  type SessionCatalogCursor,
  type SessionCatalogPage,
  type SessionSummary,
  type SessionCatalogView,
  type WorkspaceId
} from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import {
  normalizeSessionCatalogQuery,
  selectWorkspaceSessionCatalog,
  useSessionCatalogStore,
  type WorkspaceSessionCatalogState
} from "./session-catalog-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";

const SESSION_CATALOG_RETRY_DELAYS_MS = [1_000, 3_000, 10_000] as const;
let nextRetryGeneration = 1;
const retrySequences = new Map<WorkspaceId, {
  generation: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}>();

export async function queryFirstSessionCatalog(
  workspaceId: WorkspaceId,
  options: { query?: string; refresh?: boolean } = {}
): Promise<boolean> {
  const generation = startRetrySequence(workspaceId);
  return runFirstSessionCatalogQuery(workspaceId, options, generation, 0);
}

async function runFirstSessionCatalogQuery(
  workspaceId: WorkspaceId,
  options: { query?: string; refresh?: boolean },
  retryGeneration: number,
  retryAttempt: number
): Promise<boolean> {
  const store = useSessionCatalogStore.getState();
  const target = store.beginFirstPage(workspaceId, options);
  try {
    const page = await querySessionCatalogPage({
      workspaceId,
      query: target.query,
      ...(target.refresh ? { refresh: true } : {})
    });
    const committed = store.finishFirstPage(target, page);
    if (committed) {
      reconcileMaterializedSessions(
        workspaceId,
        selectWorkspaceSessionCatalog(useSessionCatalogStore.getState(), workspaceId)
      );
      if (page.state === "unavailable") {
        scheduleSessionCatalogRetry(workspaceId, options, retryGeneration, retryAttempt);
      } else {
        finishRetrySequence(workspaceId, retryGeneration);
      }
    }
    return committed;
  } catch (error) {
    if (store.failFirstPage(target, errorMessage(error))) {
      scheduleSessionCatalogRetry(workspaceId, options, retryGeneration, retryAttempt);
    }
    return false;
  }
}

export function cancelSessionCatalogRetries(workspaceId?: WorkspaceId): void {
  if (workspaceId) {
    const sequence = retrySequences.get(workspaceId);
    if (sequence?.timer) clearTimeout(sequence.timer);
    retrySequences.delete(workspaceId);
    return;
  }
  for (const sequence of retrySequences.values()) {
    if (sequence.timer) clearTimeout(sequence.timer);
  }
  retrySequences.clear();
}

export async function loadMoreSessionCatalog(workspaceId: WorkspaceId): Promise<void> {
  const store = useSessionCatalogStore.getState();
  const target = store.beginNextPage(workspaceId);
  if (!target) return;
  try {
    const page = await querySessionCatalogPage({ workspaceId, query: target.query, cursor: target.cursor });
    if (store.finishNextPage(target, page)) {
      reconcileMaterializedSessions(
        workspaceId,
        selectWorkspaceSessionCatalog(useSessionCatalogStore.getState(), workspaceId)
      );
    }
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
  revision: number,
  reason?: SessionCatalogChangedReason
): void {
  const store = useSessionCatalogStore.getState();
  const catalog = store.byWorkspace[workspaceId];
  if (reason === "automatic-title") {
    void queryFirstSessionCatalog(workspaceId, { query: catalog?.query ?? "" });
    return;
  }
  if (store.invalidateRevision(workspaceId, revision)) {
    void queryFirstSessionCatalog(workspaceId, { query: catalog?.query ?? "" });
  }
}

export function querySessionCatalogPage(options: {
  workspaceId: WorkspaceId;
  query?: string;
  cursor?: SessionCatalogCursor;
  refresh?: boolean;
  view?: SessionCatalogView;
}): Promise<SessionCatalogPage> {
  const { workspaceId } = options;
  const query = normalizeSessionCatalogQuery(options.query ?? "");
  return agentConnectionController.request("session.catalog.query", {
    scope: "workspace",
    limit: DEFAULT_SESSION_CATALOG_PAGE_ITEMS,
    ...(options.view && options.view !== "active" ? { view: options.view } : {}),
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

export type SessionCatalogRecoveryLookup =
  | { status: "found"; session: SessionSummary }
  | { status: "missing" }
  | { status: "unavailable"; detail: string };

export async function findSessionForRecovery(
  workspaceId: WorkspaceId,
  sessionId: string,
  sessionPath: string
): Promise<SessionCatalogRecoveryLookup> {
  const loaded = await queryFirstSessionCatalog(workspaceId, { query: "", refresh: true });
  if (!loaded) return unavailableRecoveryLookup(workspaceId);

  const visitedCursors = new Set<string>();
  while (true) {
    const catalog = useSessionCatalogStore.getState().byWorkspace[workspaceId];
    if (!catalog) return { status: "unavailable", detail: "对话目录尚未就绪，请稍后重试。" };
    const session = catalog.items.find((candidate) => (
      candidate.id === sessionId && candidate.path === sessionPath
    ));
    if (session) return { status: "found", session };
    if (catalog.error) return { status: "unavailable", detail: "对话目录暂时不可用，请稍后重试。" };
    if (!catalog.hasMore) {
      return isAuthoritativeCompleteCatalog(catalog)
        ? { status: "missing" }
        : { status: "unavailable", detail: "对话目录仍在重建，请稍后重试。" };
    }
    if (!catalog.nextCursor) {
      return { status: "unavailable", detail: "对话目录尚未完整加载，请稍后重试。" };
    }
    const cursorKey = JSON.stringify(catalog.nextCursor);
    if (visitedCursors.has(cursorKey)) {
      return { status: "unavailable", detail: "对话目录分页未能继续，请稍后重试。" };
    }
    visitedCursors.add(cursorKey);
    await loadMoreSessionCatalog(workspaceId);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "无法加载 Session 目录";
}

function startRetrySequence(workspaceId: WorkspaceId): number {
  cancelSessionCatalogRetries(workspaceId);
  const generation = nextRetryGeneration++;
  retrySequences.set(workspaceId, { generation, timer: undefined });
  return generation;
}

function scheduleSessionCatalogRetry(
  workspaceId: WorkspaceId,
  options: { query?: string; refresh?: boolean },
  generation: number,
  retryAttempt: number
): void {
  const sequence = retrySequences.get(workspaceId);
  const delay = SESSION_CATALOG_RETRY_DELAYS_MS[retryAttempt];
  if (!sequence || sequence.generation !== generation || delay === undefined) {
    finishRetrySequence(workspaceId, generation);
    return;
  }
  if (sequence.timer) clearTimeout(sequence.timer);
  sequence.timer = setTimeout(() => {
    const current = retrySequences.get(workspaceId);
    if (!current || current.generation !== generation) return;
    current.timer = undefined;
    void runFirstSessionCatalogQuery(workspaceId, options, generation, retryAttempt + 1);
  }, delay);
}

function finishRetrySequence(workspaceId: WorkspaceId, generation: number): void {
  const sequence = retrySequences.get(workspaceId);
  if (!sequence || sequence.generation !== generation) return;
  if (sequence.timer) clearTimeout(sequence.timer);
  retrySequences.delete(workspaceId);
}

function unavailableRecoveryLookup(workspaceId: WorkspaceId): SessionCatalogRecoveryLookup {
  const catalog = useSessionCatalogStore.getState().byWorkspace[workspaceId];
  return {
    status: "unavailable",
    detail: catalog?.error
      ? "对话目录暂时不可用，请稍后重试。"
      : "对话目录尚未就绪，请稍后重试。"
  };
}

function isAuthoritativeCompleteCatalog(
  catalog: WorkspaceSessionCatalogState
): boolean {
  return catalog.source === "sqlite"
    && catalog.catalogState === "ready"
    && !catalog.rebuilding
    && !catalog.incomplete
    && !catalog.loading
    && !catalog.loadingMore
    && !catalog.error;
}

function reconcileMaterializedSessions(
  workspaceId: WorkspaceId,
  catalog: WorkspaceSessionCatalogState
): void {
  const workbench = rendererWorkbenchStore.getState();
  for (const session of catalog.items) {
    const task = Object.values(workbench.tasks).find((candidate) => (
      candidate.workspaceId === workspaceId
      && candidate.sessionId === session.id
    ));
    if (
      !task
      || task.conversation.kind === "session"
      || task.creationStatus !== undefined
      || task.creationId !== undefined
    ) continue;
    workbench.updateTask(task.id, {
      conversation: { kind: "session", workspaceId, sessionPath: session.path },
      sessionPath: session.path,
      title: session.name,
      titleSource: session.nameSource,
      creationId: undefined,
      creationStatus: undefined,
      pendingTitle: undefined
    });
  }
}
