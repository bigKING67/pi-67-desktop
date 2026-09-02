import { conversationKeyIdentity, type WorkbenchSurface } from "@pi67/domain";
import type {
  RendererWorkbenchState,
  RendererWorkbenchTask
} from "./workbench-store-contract.js";

export function taskRemovalSurfaces(
  current: Pick<RendererWorkbenchState, "runtimeTaskOrder" | "selectedSurface" | "settingsReturnSurface">,
  removed: RendererWorkbenchTask,
  remainingTasks: RendererWorkbenchState["tasks"]
): Pick<RendererWorkbenchState, "selectedSurface" | "settingsReturnSurface"> {
  if (removed.conversation.kind !== "provisional") return {
    selectedSurface: current.selectedSurface,
    settingsReturnSurface: current.settingsReturnSurface
  };
  const replacement = provisionalReplacement(current.runtimeTaskOrder, remainingTasks, removed.workspaceId);
  return {
    selectedSurface: matchesRemoved(current.selectedSurface, removed) ? replacement : current.selectedSurface,
    settingsReturnSurface: matchesRemoved(current.settingsReturnSurface, removed)
      ? replacement
      : current.settingsReturnSurface
  };
}

function provisionalReplacement(
  taskOrder: readonly string[],
  tasks: RendererWorkbenchState["tasks"],
  workspaceId: string
): WorkbenchSurface {
  const sibling = [...taskOrder].reverse().find((id) => {
    const candidate = tasks[id];
    return candidate?.workspaceId === workspaceId && candidate.conversation.kind === "provisional";
  });
  const task = sibling ? tasks[sibling] : undefined;
  return task
    ? { kind: "conversation", conversation: task.conversation }
    : { kind: "workspace", workspaceId };
}

function matchesRemoved(surface: WorkbenchSurface | undefined, removed: RendererWorkbenchTask): boolean {
  return surface?.kind === "conversation"
    && conversationKeyIdentity(surface.conversation) === conversationKeyIdentity(removed.conversation);
}
