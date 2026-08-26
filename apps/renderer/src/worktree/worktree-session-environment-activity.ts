import type { WorktreeCreationActivityResult } from "@pi67/protocol";
import { useAppStore } from "../app/app-store.js";
import { messages } from "../localization/message-catalog.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask
} from "../workbench/workbench-store.js";

export function markCancelledWorktreeTask(taskId: string): { status: "failed"; error: string } {
  const error = messages.runtime.worktreeCreation.cancelled;
  const runtime = { phase: "stopped" as const, detail: error, recoverable: true };
  rendererWorkbenchStore.getState().updateTask(taskId, {
    lifecycle: "draft",
    creationId: undefined,
    creationStatus: undefined,
    environmentCreationId: undefined,
    environmentSourceWorkspaceId: undefined,
    environmentCreationState: undefined,
    runtime
  });
  if (selectedWorkbenchTask(rendererWorkbenchStore.getState())?.id === taskId) {
    useAppStore.setState({
      sessionTransitionPending: false,
      sessionBootstrapTransitionPending: false,
      runtime
    });
  }
  return { status: "failed", error };
}

export function trackWorktreeCreationActivity(
  taskId: string,
  creationId: string,
  query: (creationId: string) => Promise<WorktreeCreationActivityResult>
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    try {
      const result = await query(creationId);
      if (!stopped && result.status === "active") {
        const detail = messages.runtime.worktreeCreation.stages[result.activity.stage];
        const runtime = { phase: "starting" as const, detail, recoverable: true };
        rendererWorkbenchStore.getState().updateTask(taskId, { runtime });
        if (selectedWorkbenchTask(rendererWorkbenchStore.getState())?.id === taskId) {
          useAppStore.setState({ runtime });
        }
      }
    } catch {
      // Progress is supplemental; the authoritative create result still controls completion.
    }
    if (!stopped) timer = setTimeout(() => void poll(), 250);
  };
  void poll();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
