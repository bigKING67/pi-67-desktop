import type { ProviderSummary } from "@pi67/domain";
import { useAppStore } from "../app/app-store.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { configureRuntimeProviderKey } from "../session/session-control-controller.js";
import { currentRendererSessionAuthority } from "../session/session-authority.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import {
  rendererWorkbenchStore,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import { workbenchProtocolContextForTask } from "../workbench/workbench-protocol-context.js";

export async function loadWorkspaceProviderCatalog(workspaceId: string): Promise<ProviderSummary[]> {
  const task = activeWorkspaceTask(workspaceId);
  const sessionProviders = useSessionProjectionStore.getState().modelCatalog?.providers;
  if (task && sessionProviders) return sessionProviders;

  const workspace = rendererWorkbenchStore.getState().workspaces[workspaceId];
  if (!workspace) throw new Error("当前设置没有可用的工作区。");
  await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
  return agentConnectionController.request(
    "provider.list",
    {},
    [],
    { context: { scope: "workspace", workspaceId } }
  );
}

export async function configureWorkspaceProviderKey(
  workspaceId: string,
  provider: string,
  apiKey: string
): Promise<ProviderSummary[] | undefined> {
  const task = activeWorkspaceTask(workspaceId);
  if (task) {
    const configured = await configureRuntimeProviderKey(
      provider,
      apiKey,
      workbenchProtocolContextForTask(task)
    );
    return configured
      ? useSessionProjectionStore.getState().modelCatalog?.providers
      : undefined;
  }

  try {
    const providers = await agentConnectionController.request(
      "provider.setRuntimeKey",
      { provider, apiKey },
      [],
      { context: { scope: "workspace", workspaceId } }
    );
    publishNotification({
      level: "info",
      title: messages.credentials.enabledTitle(provider),
      message: messages.credentials.ephemeralNotice
    });
    return providers;
  } catch (error) {
    publishNotification({
      level: "error",
      title: messages.credentials.enableFailedTitle,
      message: error instanceof Error ? error.message : "未知错误"
    });
    return undefined;
  }
}

function activeWorkspaceTask(workspaceId: string): RendererWorkbenchTask | undefined {
  const authority = useSessionProjectionStore.getState().authority;
  const appAuthority = currentRendererSessionAuthority(useAppStore.getState());
  if (
    authority.phase !== "active"
    || !appAuthority
    || appAuthority.sessionId !== authority.sessionId
    || appAuthority.sessionGeneration !== authority.sessionGeneration
  ) return undefined;
  return Object.values(rendererWorkbenchStore.getState().tasks).find((task) => (
    task.workspaceId === workspaceId
    && task.sessionId === authority.sessionId
    && task.sessionGeneration === authority.sessionGeneration
  ));
}
