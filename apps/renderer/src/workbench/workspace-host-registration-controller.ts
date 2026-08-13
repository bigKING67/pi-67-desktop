import { DEFAULT_APPROVAL_MODE, type WorkspaceDescriptor } from "@pi67/domain";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import {
  cancelSessionCatalogRetries,
  queryFirstSessionCatalog
} from "../navigation/session-catalog-controller.js";
import {
  selectWorkspaceSessionCatalog,
  useSessionCatalogStore
} from "../navigation/session-catalog-store.js";
import { publishNotification } from "../notifications/notification-store.js";
import { rendererWorkbenchStore } from "./workbench-store.js";

const registrationFlights = new Map<string, Promise<void>>();
const registeredWorkspaces = new Set<string>();
const catalogFlights = new Map<string, Promise<void>>();
const queriedCatalogs = new Set<string>();

export async function registerRendererWorkspaceWithHost(
  workspace: WorkspaceDescriptor,
  options: { queryCatalog?: boolean; refreshCatalog?: boolean } = {}
): Promise<boolean> {
  if (workspace.availability !== "available") return false;
  const identity = await ensureAgentConnection();
  const key = workspaceRegistrationKey(identity.hostEpoch, workspace);
  await ensureWorkspaceRegistration(key, workspace);
  if (options.queryCatalog !== false) {
    await ensureWorkspaceCatalog(key, workspace.id, options.refreshCatalog === true);
  }
  return true;
}

async function ensureWorkspaceRegistration(key: string, workspace: WorkspaceDescriptor): Promise<void> {
  if (registeredWorkspaces.has(key)) return;
  const existing = registrationFlights.get(key);
  if (existing) return existing;
  const flight = agentConnectionController.request(
    "workspace.register",
    {
      cwd: workspace.identity.canonicalPath,
      trust: workspace.trust,
      approvalMode: DEFAULT_APPROVAL_MODE
    },
    [],
    { context: { scope: "workspace", workspaceId: workspace.id } }
  ).then(() => {
    registeredWorkspaces.add(key);
  });
  registrationFlights.set(key, flight);
  try {
    await flight;
  } finally {
    if (registrationFlights.get(key) === flight) registrationFlights.delete(key);
  }
}

async function ensureWorkspaceCatalog(
  key: string,
  workspaceId: string,
  refresh: boolean
): Promise<void> {
  if (!refresh && queriedCatalogs.has(key) && catalogIsAuthoritative(workspaceId)) return;
  const existing = catalogFlights.get(key);
  if (existing) return existing;
  const flight = queryFirstSessionCatalog(workspaceId, { refresh }).then((loaded) => {
    if (loaded && catalogIsAuthoritative(workspaceId)) queriedCatalogs.add(key);
  });
  catalogFlights.set(key, flight);
  try {
    await flight;
  } finally {
    if (catalogFlights.get(key) === flight) catalogFlights.delete(key);
  }
}

function catalogIsAuthoritative(workspaceId: string): boolean {
  const catalog = selectWorkspaceSessionCatalog(useSessionCatalogStore.getState(), workspaceId);
  return catalog.catalogState !== undefined
    && catalog.catalogState !== "unavailable"
    && !catalog.rebuilding;
}

function workspaceRegistrationKey(hostEpoch: number, workspace: WorkspaceDescriptor): string {
  return JSON.stringify([
    hostEpoch,
    workspace.id,
    workspace.identity.canonicalPath,
    workspace.trust
  ]);
}

export function resetWorkspaceHostRegistrationState(): void {
  registrationFlights.clear();
  registeredWorkspaces.clear();
  catalogFlights.clear();
  queriedCatalogs.clear();
  cancelSessionCatalogRetries();
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
