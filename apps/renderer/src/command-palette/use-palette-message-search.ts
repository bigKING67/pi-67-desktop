import type { WorkspaceMessageSearchItem } from "@pi67/domain";
import { useMemo } from "react";
import { createRendererReadQueryRequest } from "../query/renderer-read-query-client.js";
import { useDebouncedQueryValue } from "../query/use-debounced-query-value.js";
import { useRendererReadQuery } from "../query/use-renderer-read-query.js";
import { selectedWorkbenchTask, useWorkbenchStore } from "../workbench/workbench-store.js";

export interface PaletteMessageSearchState {
  status: "idle" | "loading" | "refreshing" | "ready" | "failed" | "unavailable";
  items: WorkspaceMessageSearchItem[];
  incomplete: boolean;
  error: string | undefined;
}

export function usePaletteMessageSearch(options: {
  open: boolean;
  query: string;
}): PaletteMessageSearchState {
  const workspace = useWorkbenchStore((state) => {
    const task = selectedWorkbenchTask(state);
    const workspaceId = task?.workspaceId ?? state.currentWorkspaceId;
    return workspaceId ? state.workspaces[workspaceId] : undefined;
  });
  const normalized = options.query.normalize("NFKC").trim();
  const enabled = options.open && workspace !== undefined && Array.from(normalized).length >= 2;
  const settledQuery = useDebouncedQueryValue(normalized, enabled);
  const request = useMemo(() => workspace && settledQuery
    ? createRendererReadQueryRequest(
        "session.catalog.contentSearch",
        { query: settledQuery },
        { scope: "workspace", workspaceId: workspace.id }
      )
    : undefined, [settledQuery, workspace]);
  const result = useRendererReadQuery(request);
  const data = result.data?.workspaceId === workspace?.id ? result.data : undefined;

  if (!options.open || Array.from(normalized).length < 2) return idleState();
  if (!workspace) return unavailableState();
  if (!request) return { ...idleState(), status: "loading" };
  if (result.data && !data) {
    return { ...unavailableState(), status: "failed", error: "对话正文搜索结果不属于当前工作区。" };
  }
  const projected = {
    items: data?.items ?? [],
    incomplete: data?.incomplete ?? false,
    error: result.status === "error" ? result.error ?? "对话正文搜索失败。" : undefined
  };
  if (result.status === "error") return { ...projected, status: "failed" };
  return { ...projected, status: result.status };
}

function idleState(): PaletteMessageSearchState {
  return { status: "idle", items: [], incomplete: false, error: undefined };
}

function unavailableState(): PaletteMessageSearchState {
  return { status: "unavailable", items: [], incomplete: false, error: undefined };
}
