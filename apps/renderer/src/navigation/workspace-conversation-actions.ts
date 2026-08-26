import type { WorkspaceDescriptor } from "@pi67/domain";
import { useAppStore } from "../app/app-store.js";
import { importRendererSessionFile } from "../session/session-import-controller.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import { queryFirstSessionCatalog } from "./session-catalog-controller.js";

export async function refreshWorkspaceConversations(workspace: WorkspaceDescriptor): Promise<void> {
  await queryFirstSessionCatalog(workspace.id, { refresh: true });
}

export async function importSessionIntoWorkspace(workspace: WorkspaceDescriptor): Promise<void> {
  if (useAppStore.getState().workspace !== workspace.identity.canonicalPath) {
    await openRendererWorkspaceDescriptor(workspace);
  }
  await importRendererSessionFile();
}
