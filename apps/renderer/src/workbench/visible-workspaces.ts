import { useMemo } from "react";
import type { WorkspaceId } from "@pi67/domain";
import type { RendererWorkbenchState } from "./workbench-store-contract.js";
import { useWorkbenchStore } from "./workbench-store.js";

/**
 * The Workspaces the user manages in the folder tree, pickers and counts: every
 * registered Workspace except the creative library, which is reached only from
 * `图像` (ADR 0010). Host registration and recovery keep using the full order.
 */
export function visibleWorkspaceOrder(state: Pick<RendererWorkbenchState, "workspaceOrder" | "imageLibraryWorkspaceId">): WorkspaceId[] {
  return state.imageLibraryWorkspaceId === undefined ? state.workspaceOrder : state.workspaceOrder.filter((id) => id !== state.imageLibraryWorkspaceId);
}

export function useVisibleWorkspaceOrder(): WorkspaceId[] {
  const workspaceOrder = useWorkbenchStore((state) => state.workspaceOrder);
  const imageLibraryWorkspaceId = useWorkbenchStore((state) => state.imageLibraryWorkspaceId);
  return useMemo(() => visibleWorkspaceOrder({ workspaceOrder, imageLibraryWorkspaceId }), [workspaceOrder, imageLibraryWorkspaceId]);
}

/** A reordered visible list back into Main's full order, with the library kept at the end. */
export function fullWorkspaceOrder(visible: readonly WorkspaceId[], imageLibraryWorkspaceId: WorkspaceId | undefined): WorkspaceId[] {
  return imageLibraryWorkspaceId === undefined ? [...visible] : [...visible, imageLibraryWorkspaceId];
}
