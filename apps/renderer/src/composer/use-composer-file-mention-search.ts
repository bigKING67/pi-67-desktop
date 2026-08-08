import type { WorkspaceDescriptor } from "@pi67/domain";
import { useEffect, useRef, useState } from "react";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import type { WorkspaceFileMentionPickerState } from "./WorkspaceFileMentionPicker.js";

const SEARCH_DELAY_MS = 100;

const IDLE_STATE: WorkspaceFileMentionPickerState = {
  status: "idle",
  entries: [],
  truncated: false
};

export function useComposerFileMentionSearch(
  workspace: WorkspaceDescriptor | undefined,
  query: string | undefined,
  hostEpoch: number | undefined
): WorkspaceFileMentionPickerState {
  const [state, setState] = useState<WorkspaceFileMentionPickerState>(IDLE_STATE);
  const revision = useRef(0);

  useEffect(() => {
    const currentRevision = ++revision.current;
    if (!workspace || query === undefined || query.length === 0) {
      setState(IDLE_STATE);
      return;
    }
    setState({ status: "loading", entries: [], truncated: false });
    const timer = globalThis.setTimeout(() => {
      void searchWorkspaceFiles(workspace, query).then(
        (result) => {
          if (revision.current !== currentRevision) return;
          const entries = result.entries.filter((entry) => entry.kind === "file");
          setState({
            status: "ready",
            entries,
            truncated: result.truncated || entries.length !== result.entries.length
          });
        },
        (error: unknown) => {
          if (revision.current !== currentRevision) return;
          setState({
            status: "failed",
            entries: [],
            truncated: false,
            error: error instanceof Error ? error.message : "文件搜索失败，请重试。"
          });
        }
      );
    }, SEARCH_DELAY_MS);
    return () => globalThis.clearTimeout(timer);
  }, [hostEpoch, query, workspace]);

  return state;
}

async function searchWorkspaceFiles(workspace: WorkspaceDescriptor, query: string) {
  await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
  return agentConnectionController.request(
    "workspace.file.search",
    { query },
    [],
    { context: { scope: "workspace", workspaceId: workspace.id } }
  );
}
