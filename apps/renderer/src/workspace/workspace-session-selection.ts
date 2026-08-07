import type { SessionSummary } from "@pi67/domain";
import type { RendererWorkbenchState } from "../workbench/workbench-store.js";
import {
  selectWorkspaceSessionCatalog,
  useSessionCatalogStore,
  type WorkspaceSessionCatalogState
} from "../navigation/session-catalog-store.js";

const WORKSPACE_CATALOG_DECISION_TIMEOUT_MS = 5_000;

export interface WorkspaceOpenSessionTarget {
  sessionPath: string;
  sessionFileIdentity: string;
}

export type WorkspaceCatalogDecision =
  | { kind: "session"; target: WorkspaceOpenSessionTarget }
  | { kind: "empty" }
  | { kind: "pending" };

export function preferredWorkspaceSession(
  workbench: RendererWorkbenchState,
  workspaceId: string
): WorkspaceOpenSessionTarget | undefined {
  const selected = workbench.selectedSurface?.kind === "conversation"
    && workbench.selectedSurface.conversation.kind === "session"
    && workbench.selectedSurface.conversation.workspaceId === workspaceId
    ? workbench.selectedSurface.conversation
    : undefined;
  if (selected) {
    return {
      sessionPath: selected.sessionPath,
      sessionFileIdentity: selected.sessionFileIdentity
    };
  }
  const task = [...workbench.runtimeTaskOrder].reverse()
    .map((taskId) => workbench.tasks[taskId])
    .find((candidate) => (
      candidate?.workspaceId === workspaceId
      && candidate.conversation.kind === "session"
    ));
  return task?.conversation.kind === "session"
    ? {
        sessionPath: task.conversation.sessionPath,
        sessionFileIdentity: task.conversation.sessionFileIdentity
      }
    : undefined;
}

export function waitForWorkspaceCatalogDecision(
  workspaceId: string,
  preferred: WorkspaceOpenSessionTarget | undefined
): Promise<WorkspaceCatalogDecision> {
  const initial = workspaceCatalogDecision(workspaceId, preferred);
  if (initial.kind !== "pending") return Promise.resolve(initial);
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (decision: WorkspaceCatalogDecision) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(decision);
    };
    const timer = setTimeout(() => {
      finish(workspaceCatalogDecision(workspaceId, preferred));
    }, WORKSPACE_CATALOG_DECISION_TIMEOUT_MS);
    unsubscribe = useSessionCatalogStore.subscribe(() => {
      const decision = workspaceCatalogDecision(workspaceId, preferred);
      if (decision.kind !== "pending") finish(decision);
    });
    const current = workspaceCatalogDecision(workspaceId, preferred);
    if (current.kind !== "pending") finish(current);
  });
}

export function workspaceCatalogDecision(
  workspaceId: string,
  preferred: WorkspaceOpenSessionTarget | undefined
): WorkspaceCatalogDecision {
  const catalog = selectWorkspaceSessionCatalog(useSessionCatalogStore.getState(), workspaceId);
  const preferredCatalogSession = preferred
    ? catalog.items.find((session) => (
        session.fileIdentity === preferred.sessionFileIdentity
        || session.path === preferred.sessionPath
      ))
    : undefined;
  if (preferred && (!catalogIsAuthoritativelyReady(catalog) || preferredCatalogSession)) {
    return {
      kind: "session",
      target: preferredCatalogSession
        ? catalogSessionTarget(preferredCatalogSession)
        : preferred
    };
  }
  const first = catalog.items[0];
  if (first) return { kind: "session", target: catalogSessionTarget(first) };
  return catalogIsAuthoritativelyReady(catalog) ? { kind: "empty" } : { kind: "pending" };
}

function catalogIsAuthoritativelyReady(catalog: WorkspaceSessionCatalogState): boolean {
  return catalog.catalogState === "ready"
    && !catalog.rebuilding
    && !catalog.loading
    && !catalog.incomplete
    && catalog.error === undefined;
}

function catalogSessionTarget(session: SessionSummary): WorkspaceOpenSessionTarget {
  return {
    sessionPath: session.path,
    sessionFileIdentity: session.fileIdentity
  };
}
