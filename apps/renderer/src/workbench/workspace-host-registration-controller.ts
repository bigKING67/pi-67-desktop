import type { WorkspaceDescriptor } from "@pi67/domain";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { queryFirstSessionCatalog } from "../navigation/session-catalog-controller.js";
import { publishNotification } from "../notifications/notification-store.js";
import { rendererWorkbenchStore } from "./workbench-store.js";

export async function registerRendererWorkspaceWithHost(
  workspace: WorkspaceDescriptor,
  options: { queryCatalog?: boolean; refreshCatalog?: boolean } = {}
): Promise<boolean> {
  if (workspace.availability !== "available") return false;
  await ensureAgentConnection();
  await agentConnectionController.request(
    "workspace.register",
    {
      cwd: workspace.identity.canonicalPath,
      trust: workspace.trust,
      approvalMode: "guided"
    },
    [],
    { context: { scope: "workspace", workspaceId: workspace.id } }
  );
  if (options.queryCatalog !== false) {
    await queryFirstSessionCatalog(workspace.id, { refresh: options.refreshCatalog === true });
  }
  return true;
}

export async function registerAvailableRendererWorkspaces(): Promise<void> {
  const workbench = rendererWorkbenchStore.getState();
  const available = workbench.workspaceOrder.flatMap((workspaceId) => {
    const workspace = workbench.workspaces[workspaceId];
    return workspace?.availability === "available" ? [workspace] : [];
  });
  await Promise.all(available.map(async (workspace) => {
    try {
      await registerRendererWorkspaceWithHost(workspace);
    } catch (error) {
      publishNotification({
        level: "warning",
        title: `无法加载 ${workspace.displayName} 的会话`,
        message: errorMessage(error)
      });
    }
  }));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Pi 运行服务暂时无法注册工作区。";
}
