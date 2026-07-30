import { ProtocolRequestError } from "@pi67/protocol";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { useSessionCatalogStore } from "../navigation/session-catalog-store.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import { resumeRendererTask } from "./task-activation-controller.js";
import { rendererWorkbenchStore, selectedWorkbenchTask } from "./workbench-store.js";
import { registerRendererWorkspaceWithHost } from "./workspace-host-registration-controller.js";

export type WorkspaceRemovalDisposition =
  | "allowed"
  | "workspace-missing"
  | "tasks-open"
  | "workspace-active"
  | "host-busy";

export function workspaceRemovalDisposition(workspaceId: string): WorkspaceRemovalDisposition {
  const workbench = rendererWorkbenchStore.getState();
  const workspace = workbench.workspaces[workspaceId];
  if (!workspace) return "workspace-missing";
  if (Object.values(workbench.tasks).some((task) => (
    task.workspaceId === workspaceId
    && (
      task.runtime.phase !== "stopped"
      || task.conversation.kind === "provisional"
      || task.hasDraft
      || task.attachmentCount > 0
    )
  ))) return "tasks-open";
  if (useAppStore.getState().workspace === workspace.identity.canonicalPath) return "workspace-active";
  return "allowed";
}

export async function removeRendererWorkspace(workspaceId: string): Promise<WorkspaceRemovalDisposition> {
  const disposition = workspaceRemovalDisposition(workspaceId);
  if (disposition !== "allowed") return disposition;
  try {
    await ensureAgentConnection();
    await agentConnectionController.request(
      "workspace.unregister",
      {},
      [],
      { context: { scope: "workspace", workspaceId } }
    );
  } catch (error) {
    if (error instanceof ProtocolRequestError && error.code === "BUSY") return "host-busy";
    throw error;
  }
  const currentDisposition = workspaceRemovalDisposition(workspaceId);
  if (currentDisposition !== "allowed") {
    const workspace = rendererWorkbenchStore.getState().workspaces[workspaceId];
    if (workspace) await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
    return currentDisposition;
  }
  await window.pi67.system.removeWorkspace(workspaceId);
  if (!rendererWorkbenchStore.getState().unregisterWorkspace(workspaceId)) return "workspace-missing";
  useSessionCatalogStore.getState().reset(workspaceId);
  return "allowed";
}

export async function moveRendererWorkspace(
  workspaceId: string,
  direction: "up" | "down"
): Promise<boolean> {
  const workbench = rendererWorkbenchStore.getState();
  const index = workbench.workspaceOrder.indexOf(workspaceId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= workbench.workspaceOrder.length) return false;
  const workspaceOrder = [...workbench.workspaceOrder];
  [workspaceOrder[index], workspaceOrder[target]] = [workspaceOrder[target]!, workspaceOrder[index]!];
  await window.pi67.system.reorderWorkspaces(workspaceOrder);
  return rendererWorkbenchStore.getState().reorderWorkspaces(workspaceOrder);
}

export function workspaceOrderAfterDrop(
  workspaceOrder: readonly string[],
  draggedWorkspaceId: string,
  targetWorkspaceId: string
): string[] | undefined {
  const sourceIndex = workspaceOrder.indexOf(draggedWorkspaceId);
  const targetIndex = workspaceOrder.indexOf(targetWorkspaceId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return undefined;
  const reordered = workspaceOrder.filter((workspaceId) => workspaceId !== draggedWorkspaceId);
  const remainingTargetIndex = reordered.indexOf(targetWorkspaceId);
  const insertionIndex = sourceIndex < targetIndex ? remainingTargetIndex + 1 : remainingTargetIndex;
  reordered.splice(insertionIndex, 0, draggedWorkspaceId);
  return reordered;
}

export async function repairAndOpenRendererWorkspace(workspaceId: string): Promise<boolean> {
  const repaired = await window.pi67.system.repairWorkspace(workspaceId);
  if (!repaired) return false;
  const workbench = rendererWorkbenchStore.getState();
  const selectedTaskBeforeRepair = selectedWorkbenchTask(workbench);
  workbench.registerWorkspace(repaired);
  workbench.selectWorkspace(repaired.id);
  await registerRendererWorkspaceWithHost(repaired, { refreshCatalog: true });
  if (
    selectedTaskBeforeRepair?.workspaceId === repaired.id
    && selectedTaskBeforeRepair.sessionPath
  ) return resumeRendererTask(selectedTaskBeforeRepair.id);
  await openRendererWorkspaceDescriptor(repaired);
  return useAppStore.getState().workspace === repaired.identity.canonicalPath;
}
