import type { TeamSessionScope, WorkspaceDescriptor } from "@pi67/domain";
import { useAppStore } from "../app/app-store.js";
import { beginRendererSessionIntent } from "../session/session-lifecycle-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { selectRendererWorkspaceDescriptor } from "./workspace-open-controller.js";

/** Selects the Workspace and opens a draft there; returns the draft task id when created. */
export async function beginRendererSessionIntentInWorkspace(
  workspace: WorkspaceDescriptor,
  options: { teamScope?: TeamSessionScope } = {}
): Promise<string | undefined> {
  const state = useAppStore.getState();
  if (state.sessionTransitionPending || state.workspaceOpenPending) return undefined;
  if (state.workspace !== workspace.identity.canonicalPath) {
    const selected = await selectRendererWorkspaceDescriptor(workspace);
    if (!selected) return undefined;
  } else {
    rendererWorkbenchStore.getState().selectWorkspace(workspace.id);
  }
  return options.teamScope
    ? beginRendererSessionIntent(workspace.id, { teamScope: options.teamScope })
    : beginRendererSessionIntent(workspace.id);
}
