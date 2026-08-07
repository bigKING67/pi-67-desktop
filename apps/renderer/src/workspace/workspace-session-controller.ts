import type { WorkspaceDescriptor } from "@pi67/domain";
import { useAppStore } from "../app/app-store.js";
import { beginRendererSessionIntent } from "../session/session-lifecycle-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { selectRendererWorkspaceDescriptor } from "./workspace-open-controller.js";

export async function beginRendererSessionIntentInWorkspace(
  workspace: WorkspaceDescriptor
): Promise<void> {
  const state = useAppStore.getState();
  if (state.sessionTransitionPending || state.workspaceOpenPending) return;
  if (state.workspace !== workspace.identity.canonicalPath) {
    const selected = await selectRendererWorkspaceDescriptor(workspace);
    if (!selected) return;
  } else {
    rendererWorkbenchStore.getState().selectWorkspace(workspace.id);
  }
  beginRendererSessionIntent(workspace.id);
}
