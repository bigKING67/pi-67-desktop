import type { PiProviderConfigurationSnapshot } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import {
  registerRendererWorkspaceWithHost
} from "../workbench/workspace-host-registration-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";

const CONFIGURATION_ACK_TIMEOUT_MS = 12_000;

export async function loadNewSessionRuntimeConfiguration(
  workspaceId: string | undefined
): Promise<PiProviderConfigurationSnapshot> {
  await ensureAgentConnection();
  const workspace = workspaceId
    ? rendererWorkbenchStore.getState().workspaces[workspaceId]
    : undefined;
  if (
    workspace
    && workspace.availability === "available"
    && workspace.trust === "trusted"
  ) {
    if (!await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false })) {
      throw new Error("当前 Workspace 尚未在 Pi 运行服务中初始化。");
    }
    return requireCurrentConfiguration(await agentConnectionController.request(
      "provider.projectConfiguration.get",
      {},
      [],
      {
        context: { scope: "workspace", workspaceId: workspace.id },
        ackTimeoutMs: CONFIGURATION_ACK_TIMEOUT_MS
      }
    ));
  }
  return requireCurrentConfiguration(await agentConnectionController.request(
    "provider.configuration.get",
    {},
    [],
    { context: { scope: "app" }, ackTimeoutMs: CONFIGURATION_ACK_TIMEOUT_MS }
  ));
}

function requireCurrentConfiguration(
  snapshot: PiProviderConfigurationSnapshot
): PiProviderConfigurationSnapshot {
  if (snapshot.syncState === "current") return snapshot;
  const detail = snapshot.diagnostics[0]?.message;
  throw new Error(detail
    ? `Pi 模型配置当前无效：${detail}`
    : "Pi 模型配置当前无效，请先在设置中修复。");
}
