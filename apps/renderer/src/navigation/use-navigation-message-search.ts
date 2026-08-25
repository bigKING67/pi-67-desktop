import type { WorkspaceMessageSearchItem } from "@pi67/domain";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";

const SEARCH_DELAY_MS = 180;

export interface NavigationMessageSearchWorkspaceState {
  status: "idle" | "loading" | "ready" | "failed";
  items: WorkspaceMessageSearchItem[];
  incomplete: boolean;
}

export function useNavigationMessageSearch(
  query: string,
  workspaceIds: readonly string[]
): Record<string, NavigationMessageSearchWorkspaceState> {
  const connected = useAppStore((state) => state.connected);
  const hostEpoch = useAppStore((state) => state.hostEpoch);
  const workspaces = useWorkbenchStore((state) => state.workspaces);
  const [byWorkspace, setByWorkspace] = useState<Record<string, NavigationMessageSearchWorkspaceState>>({});
  const revision = useRef(0);
  const normalized = query.normalize("NFKC").trim();

  useEffect(() => {
    const requestRevision = ++revision.current;
    const controller = new AbortController();
    if (Array.from(normalized).length < 2 || !connected || hostEpoch === undefined) {
      setByWorkspace({});
      return () => controller.abort();
    }
    setByWorkspace(Object.fromEntries(workspaceIds.map((workspaceId) => [workspaceId, {
      status: "loading" as const,
      items: [],
      incomplete: false
    }])));
    const timer = window.setTimeout(() => {
      void Promise.all(workspaceIds.map(async (workspaceId) => {
        const workspace = workspaces[workspaceId];
        if (!workspace || workspace.availability !== "available") return undefined;
        try {
          await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
          if (controller.signal.aborted || revision.current !== requestRevision) return undefined;
          const result = await agentConnectionController.request(
            "session.catalog.contentSearch",
            { query: normalized },
            [],
            {
              context: { scope: "workspace", workspaceId },
              signal: controller.signal
            }
          );
          return [workspaceId, {
            status: "ready" as const,
            items: result.items,
            incomplete: result.incomplete
          }] as const;
        } catch {
          if (controller.signal.aborted) return undefined;
          return [workspaceId, {
            status: "failed" as const,
            items: [],
            incomplete: true
          }] as const;
        }
      })).then((results) => {
        if (controller.signal.aborted || revision.current !== requestRevision) return;
        setByWorkspace(Object.fromEntries(results.filter((result) => result !== undefined)));
      });
    }, SEARCH_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [connected, hostEpoch, normalized, workspaceIds, workspaces]);

  return byWorkspace;
}
