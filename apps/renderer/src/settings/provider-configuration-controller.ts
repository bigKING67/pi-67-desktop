import { ProtocolRequestError, type AgentCommandType, type CommandPayloads, type CommandResults, type PiCredentialRevealResult, type PiProviderConfigurationChanged, type PiProviderConfigurationSnapshot } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { shouldSuppressAgentHostFollowup } from "../connection/agent-host-startup-state.js";
import { publishNotification } from "../notifications/notification-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useProviderConfigurationStore } from "./provider-configuration-store.js";

const providerLoadFlights = new Map<string, Promise<boolean>>();
const PROVIDER_CONFIGURATION_LOAD_ACK_TIMEOUT_MS = 12_000;

export function loadProviderConfiguration(workspaceId?: string): Promise<boolean> {
  const target = resolveWorkspace(workspaceId);
  if (!target) return Promise.resolve(false);
  const existing = providerLoadFlights.get(target.id);
  if (existing) return existing;
  const flight = performProviderConfigurationLoad(target.id);
  providerLoadFlights.set(target.id, flight);
  void flight.finally(() => {
    if (providerLoadFlights.get(target.id) === flight) providerLoadFlights.delete(target.id);
  }).catch(() => undefined);
  return flight;
}

async function performProviderConfigurationLoad(workspaceId: string): Promise<boolean> {
  const target = resolveWorkspace(workspaceId);
  if (!target) return false;
  useProviderConfigurationStore.getState().beginLoad(target.id);
  try {
    await ensureAgentConnection();
    await registerRendererWorkspaceWithHost(target, { queryCatalog: false });
    const snapshot = await request(
      target.id,
      "provider.configuration.get",
      {},
      PROVIDER_CONFIGURATION_LOAD_ACK_TIMEOUT_MS
    );
    useProviderConfigurationStore.getState().install(target.id, snapshot);
    return true;
  } catch (error) {
    return reportFailure(target.id, "无法读取 Pi Provider 配置", error);
  }
}

export function resetProviderConfigurationLoadState(): void {
  providerLoadFlights.clear();
}

export async function saveProviderConfiguration(workspaceId?: string): Promise<boolean> {
  const target = resolveWorkspace(workspaceId);
  const state = useProviderConfigurationStore.getState();
  if (!target || state.workspaceId !== target.id || !state.draft || !state.baselineRevision) return false;
  state.beginSave();
  return mutate(target.id, "provider.configuration.save", {
    expectedRevision: state.baselineRevision,
    provider: state.draft
  }, "Pi Provider 配置已保存");
}

export async function removeProviderConfiguration(
  provider: string,
  workspaceId?: string
): Promise<boolean> {
  const target = resolveWorkspace(workspaceId);
  const revision = useProviderConfigurationStore.getState().baselineRevision;
  if (!target || !revision) return false;
  useProviderConfigurationStore.getState().beginSave();
  return mutate(target.id, "provider.configuration.remove", {
    expectedRevision: revision,
    provider
  }, "Pi Provider 已移除");
}

export async function storePersistentCredential(
  workspaceId: string,
  provider: string,
  apiKey: string
): Promise<boolean> {
  const state = useProviderConfigurationStore.getState();
  if (state.workspaceId !== workspaceId || !state.baselineRevision) {
    if (!await loadProviderConfiguration(workspaceId)) return false;
  }
  const revision = useProviderConfigurationStore.getState().baselineRevision;
  if (!revision) return false;
  return mutate(workspaceId, "provider.credential.store", {
    expectedRevision: revision,
    provider,
    apiKey
  }, "凭据已保存到 Pi auth.json");
}

export async function removePersistentCredential(
  workspaceId: string,
  provider: string
): Promise<boolean> {
  const revision = useProviderConfigurationStore.getState().baselineRevision;
  if (!revision) return false;
  return mutate(workspaceId, "provider.credential.remove", {
    expectedRevision: revision,
    provider
  }, "Pi 持久凭据已移除");
}

export async function revealPersistentCredential(
  workspaceId: string,
  provider: string
): Promise<PiCredentialRevealResult> {
  const state = useProviderConfigurationStore.getState();
  if (state.workspaceId !== workspaceId || !state.baselineRevision) {
    if (!await loadProviderConfiguration(workspaceId)) {
      throw new Error("Pi Provider 配置尚未就绪。");
    }
  }
  const revision = useProviderConfigurationStore.getState().baselineRevision;
  if (!revision) throw new Error("Pi Provider 配置缺少有效 revision。");
  return request(workspaceId, "provider.credential.reveal", {
    expectedRevision: revision,
    provider
  });
}

export async function setDefaultModelConfiguration(
  scope: "global" | "project",
  selection: { provider: string; model: string } | undefined,
  workspaceId?: string
): Promise<boolean> {
  const target = resolveWorkspace(workspaceId);
  const revision = useProviderConfigurationStore.getState().baselineRevision;
  if (!target || !revision) return false;
  return mutate(target.id, "model.default.set", {
    expectedRevision: revision,
    scope,
    ...selection
  }, scope === "global" ? "Pi 全局默认模型已更新" : "Pi 项目默认模型已更新");
}

export async function reloadProviderConfiguration(workspaceId?: string): Promise<boolean> {
  const target = resolveWorkspace(workspaceId);
  if (!target) return false;
  try {
    const snapshot = await request(
      target.id,
      "provider.configuration.reload",
      {},
      PROVIDER_CONFIGURATION_LOAD_ACK_TIMEOUT_MS
    );
    useProviderConfigurationStore.getState().install(target.id, snapshot);
    publishNotification({ level: "info", title: "已从 Pi 配置文件重新加载" });
    return true;
  } catch (error) {
    return reportFailure(target.id, "无法重新加载 Pi 配置", error);
  }
}

export function handleProviderConfigurationChanged(
  workspaceId: string,
  change: PiProviderConfigurationChanged
): void {
  useProviderConfigurationStore.getState().observeExternal(workspaceId, change);
}

async function mutate<T extends ConfigurationMutationType>(
  workspaceId: string,
  type: T,
  payload: CommandPayloads[T],
  successTitle: string
): Promise<boolean> {
  try {
    const snapshot = await request(workspaceId, type, payload) as PiProviderConfigurationSnapshot;
    useProviderConfigurationStore.getState().install(workspaceId, snapshot);
    publishNotification({ level: "info", title: successTitle });
    return true;
  } catch (error) {
    const store = useProviderConfigurationStore.getState();
    const message = error instanceof Error ? error.message : "未知错误";
    store.fail(workspaceId, message);
    if (error instanceof ProtocolRequestError && error.code === "CONFIGURATION_CHANGED_EXTERNALLY") {
      publishNotification({
        level: "warning",
        title: "Pi 配置已在外部修改",
        message: "当前草稿未保存。请比较并重新加载最新配置后再保存。"
      });
      return false;
    }
    publishNotification({ level: "error", title: "Pi 配置操作失败", message });
    return false;
  }
}

type ConfigurationMutationType = Extract<AgentCommandType,
  | "provider.configuration.save"
  | "provider.configuration.remove"
  | "provider.credential.store"
  | "provider.credential.remove"
  | "model.default.set">;

function request<T extends AgentCommandType>(
  workspaceId: string,
  type: T,
  payload: CommandPayloads[T],
  ackTimeoutMs?: number
): Promise<CommandResults[T]> {
  return agentConnectionController.request(type, payload, [], {
    context: { scope: "workspace", workspaceId },
    ...(ackTimeoutMs === undefined ? {} : { ackTimeoutMs })
  });
}

function resolveWorkspace(workspaceId?: string) {
  const workbench = rendererWorkbenchStore.getState();
  const id = workspaceId ?? workbench.settingsWorkspaceId ?? workbench.currentWorkspaceId;
  return id ? workbench.workspaces[id] : undefined;
}

function reportFailure(workspaceId: string, title: string, error: unknown): false {
  const message = error instanceof Error ? error.message : "未知错误";
  useProviderConfigurationStore.getState().fail(workspaceId, message);
  if (!shouldSuppressAgentHostFollowup(error)) {
    publishNotification({ level: "error", title, message });
  }
  return false;
}
