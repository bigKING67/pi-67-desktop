import type { WorkspaceMessageSearchItem } from "@pi67/domain";
import { useEffect, useRef, useState } from "react";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import { selectedWorkbenchTask, useWorkbenchStore } from "../workbench/workbench-store.js";

const SEARCH_DELAY_MS = 180;

export interface PaletteMessageSearchState {
  status: "idle" | "loading" | "ready" | "failed" | "unavailable";
  items: WorkspaceMessageSearchItem[];
  incomplete: boolean;
  error: string | undefined;
}

export function usePaletteMessageSearch(options: {
  open: boolean;
  connected: boolean;
  hostEpoch: number | undefined;
  query: string;
}): PaletteMessageSearchState {
  const workspace = useWorkbenchStore((state) => {
    const task = selectedWorkbenchTask(state);
    const workspaceId = task?.workspaceId ?? state.currentWorkspaceId;
    return workspaceId ? state.workspaces[workspaceId] : undefined;
  });
  const [state, setState] = useState<PaletteMessageSearchState>({
    status: "idle",
    items: [],
    incomplete: false,
    error: undefined
  });
  const revision = useRef(0);
  const normalized = options.query.normalize("NFKC").trim();

  useEffect(() => {
    const requestRevision = ++revision.current;
    if (!options.open || normalized.length < 2) {
      setState({ status: "idle", items: [], incomplete: false, error: undefined });
      return;
    }
    if (!options.connected || options.hostEpoch === undefined || !workspace) {
      setState({ status: "unavailable", items: [], incomplete: false, error: undefined });
      return;
    }
    setState((current) => ({ ...current, status: "loading", error: undefined }));
    const timer = window.setTimeout(() => {
      void executeSearch().catch((error: unknown) => {
        if (revision.current !== requestRevision) return;
        setState({
          status: "failed",
          items: [],
          incomplete: false,
          error: error instanceof Error ? error.message : "对话正文搜索失败。"
        });
      });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);

    async function executeSearch(): Promise<void> {
      await registerRendererWorkspaceWithHost(workspace!, { queryCatalog: false });
      if (revision.current !== requestRevision) return;
      const result = await agentConnectionController.request(
        "session.catalog.contentSearch",
        { query: normalized },
        [],
        { context: { scope: "workspace", workspaceId: workspace!.id } }
      );
      if (revision.current !== requestRevision || result.workspaceId !== workspace!.id) return;
      setState({
        status: "ready",
        items: result.items,
        incomplete: result.incomplete,
        error: undefined
      });
    }
  }, [normalized, options.connected, options.hostEpoch, options.open, workspace]);

  return state;
}
