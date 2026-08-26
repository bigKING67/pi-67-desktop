import type { WorkspaceMessageSearchItem } from "@pi67/domain";
import { useMemo } from "react";
import { createRendererReadQueryRequest } from "../query/renderer-read-query-client.js";
import { useDebouncedQueryValue } from "../query/use-debounced-query-value.js";
import { useRendererReadQueries } from "../query/use-renderer-read-query.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";

export interface NavigationMessageSearchWorkspaceState {
  status: "idle" | "loading" | "refreshing" | "ready" | "failed" | "unavailable";
  items: WorkspaceMessageSearchItem[];
  incomplete: boolean;
}

export function useNavigationMessageSearch(
  query: string,
  workspaceIds: readonly string[]
): Record<string, NavigationMessageSearchWorkspaceState> {
  const workspaces = useWorkbenchStore((state) => state.workspaces);
  const normalized = query.normalize("NFKC").trim();
  const enabled = Array.from(normalized).length >= 2;
  const settledQuery = useDebouncedQueryValue(normalized, enabled);
  const requests = useMemo(() => settledQuery ? workspaceIds.flatMap((workspaceId) => {
    const workspace = workspaces[workspaceId];
    return workspace?.availability === "available"
      ? [createRendererReadQueryRequest(
          "session.catalog.contentSearch",
          { query: settledQuery },
          { scope: "workspace", workspaceId }
        )]
      : [];
  }) : [], [settledQuery, workspaceIds, workspaces]);
  const results = useRendererReadQueries(requests);

  return useMemo(() => {
    if (!enabled) return {};
    if (!settledQuery) return loadingStates(workspaceIds);
    return Object.fromEntries(requests.map((request, index) => {
      const result = results[index];
      const data = result?.data?.workspaceId === request.context.workspaceId ? result.data : undefined;
      if (!result || (result.data && !data)) {
        return [request.context.workspaceId, failedState()] as const;
      }
      const status = result.status === "error" ? "failed" : result.status;
      return [request.context.workspaceId, {
        status,
        items: data?.items ?? [],
        incomplete: data?.incomplete ?? status === "failed"
      }] as const;
    }));
  }, [enabled, requests, results, settledQuery, workspaceIds]);
}

function loadingStates(
  workspaceIds: readonly string[]
): Record<string, NavigationMessageSearchWorkspaceState> {
  return Object.fromEntries(workspaceIds.map((workspaceId) => [workspaceId, {
    status: "loading",
    items: [],
    incomplete: false
  }]));
}

function failedState(): NavigationMessageSearchWorkspaceState {
  return { status: "failed", items: [], incomplete: true };
}
