import { ProtocolRequestError, type AgentCommandType, type CommandPayloads, type CommandResults, type PiCredentialRevealResult, type PiProviderConfigurationChanged, type PiProviderConfigurationSnapshot } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { publishNotification } from "../notifications/notification-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useProviderConfigurationStore } from "./provider-configuration-store.js";

const providerLoadFlights = new Map<string, Promise<boolean>>();
const PROVIDER_CONFIGURATION_LOAD_ACK_TIMEOUT_MS = 12_000;
export const GLOBAL_PROVIDER_CONFIGURATION_KEY = "app";

export function loadProviderConfiguration(_workspaceId?: string): Promise<boolean> {
  useProviderConfigurationStore.getState().beginLoad(GLOBAL_PROVIDER_CONFIGURATION_KEY);
  const existing = providerLoadFlights.get(GLOBAL_PROVIDER_CONFIGURATION_KEY);
  if (existing) return existing;
  const flight = performProviderConfigurationLoad();
  providerLoadFlights.set(GLOBAL_PROVIDER_CONFIGURATION_KEY, flight);
  void flight.finally(() => {
    if (providerLoadFlights.get(GLOBAL_PROVIDER_CONFIGURATION_KEY) === flight) {
      providerLoadFlights.delete(GLOBAL_PROVIDER_CONFIGURATION_KEY);
    }
  }).catch(() => undefined);
  return flight;
}

export function loadProjectProviderConfiguration(workspaceId: string): Promise<boolean> {
  const key = projectConfigurationKey(workspaceId);
  useProviderConfigurationStore.getState().beginLoad(key);
  const existing = providerLoadFlights.get(key);
  if (existing) return existing;
  const flight = performProjectProviderConfigurationLoad(workspaceId, key);
  providerLoadFlights.set(key, flight);
  void flight.finally(() => {
    if (providerLoadFlights.get(key) === flight) providerLoadFlights.delete(key);
  }).catch(() => undefined);
  return flight;
}

async function performProviderConfigurationLoad(): Promise<boolean> {
  try {
    await ensureAgentConnection();
    const snapshot = await request(
      "provider.configuration.get",
      {},
      PROVIDER_CONFIGURATION_LOAD_ACK_TIMEOUT_MS
    );
    useProviderConfigurationStore.getState().install(GLOBAL_PROVIDER_CONFIGURATION_KEY, snapshot);
    return true;
  } catch (error) {
    return reportFailure(GLOBAL_PROVIDER_CONFIGURATION_KEY, error);
  }
}

async function performProjectProviderConfigurationLoad(workspaceId: string, key: string): Promise<boolean> {
  try {
    const workspace = rendererWorkbenchStore.getState().workspaces[workspaceId];
    if (!workspace || workspace.availability !== "available") {
      throw new Error("当前 Workspace 需要重新确认后才能读取项目级 Pi 配置。");
    }
    if (workspace.trust !== "trusted") {
      throw new Error("请先信任当前 Workspace，再读取或修改项目级 Pi 配置。");
    }
    if (!await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false })) {
      throw new Error("当前 Workspace 尚未在 Pi 运行服务中初始化。");
    }
    const snapshot = await requestWorkspace(
      workspaceId,
      "provider.projectConfiguration.get",
      {},
      PROVIDER_CONFIGURATION_LOAD_ACK_TIMEOUT_MS
    );
    useProviderConfigurationStore.getState().install(key, snapshot);
    return true;
  } catch (error) {
    return reportFailure(key, error);
  }
}

export function resetProviderConfigurationLoadState(): void {
  providerLoadFlights.clear();
}

export async function saveProviderConfiguration(_workspaceId?: string): Promise<boolean> {
  const state = useProviderConfigurationStore.getState();
  if (state.workspaceId !== GLOBAL_PROVIDER_CONFIGURATION_KEY || !state.draft || !state.baselineRevision) return false;
  state.beginSave();
  return mutateGlobal("provider.configuration.save", {
    expectedRevision: state.baselineRevision,
    provider: state.draft
  }, "Pi Provider 配置已保存");
}

export async function removeProviderConfiguration(
  provider: string,
  _workspaceId?: string
): Promise<boolean> {
  const state = useProviderConfigurationStore.getState();
  const revision = state.baselineRevision;
  if (state.workspaceId !== GLOBAL_PROVIDER_CONFIGURATION_KEY || !revision) return false;
  useProviderConfigurationStore.getState().beginSave();
  return mutateGlobal("provider.configuration.remove", {
    expectedRevision: revision,
    provider
  }, "Pi Provider 已移除");
}

export async function storePersistentCredential(
  _workspaceId: string,
  provider: string,
  apiKey: string
): Promise<boolean> {
  const state = useProviderConfigurationStore.getState();
  if (state.workspaceId !== GLOBAL_PROVIDER_CONFIGURATION_KEY || !state.baselineRevision) {
    if (!await loadProviderConfiguration()) return false;
  }
  const current = useProviderConfigurationStore.getState();
  const revision = current.baselineRevision;
  if (current.workspaceId !== GLOBAL_PROVIDER_CONFIGURATION_KEY || !revision) return false;
  return mutateGlobal("provider.credential.store", {
    expectedRevision: revision,
    provider,
    apiKey
  }, "凭据已保存到 Pi auth.json");
}

export async function removePersistentCredential(
  _workspaceId: string,
  provider: string
): Promise<boolean> {
  const state = useProviderConfigurationStore.getState();
  const revision = state.baselineRevision;
  if (state.workspaceId !== GLOBAL_PROVIDER_CONFIGURATION_KEY || !revision) return false;
  return mutateGlobal("provider.credential.remove", {
    expectedRevision: revision,
    provider
  }, "Pi 持久凭据已移除");
}

export async function revealPersistentCredential(
  _workspaceId: string,
  provider: string
): Promise<PiCredentialRevealResult> {
  const state = useProviderConfigurationStore.getState();
  if (state.workspaceId !== GLOBAL_PROVIDER_CONFIGURATION_KEY || !state.baselineRevision) {
    if (!await loadProviderConfiguration()) {
      throw new Error("Pi Provider 配置尚未就绪。");
    }
  }
  const current = useProviderConfigurationStore.getState();
  const revision = current.baselineRevision;
  if (current.workspaceId !== GLOBAL_PROVIDER_CONFIGURATION_KEY || !revision) {
    throw new Error("Pi Provider 配置缺少有效 revision。");
  }
  return request("provider.credential.reveal", {
    expectedRevision: revision,
    provider
  });
}

export async function setDefaultModelConfiguration(
  scope: "global" | "project",
  selection: { provider: string; model: string } | undefined,
  _workspaceId?: string
): Promise<boolean> {
  const state = useProviderConfigurationStore.getState();
  const revision = state.baselineRevision;
  if (!revision) return false;
  if (scope === "global") {
    if (state.workspaceId !== GLOBAL_PROVIDER_CONFIGURATION_KEY) return false;
    return mutateGlobal("model.default.set", {
      expectedRevision: revision,
      scope,
      ...selection
    }, "Pi 全局默认模型已更新");
  }
  if (!_workspaceId || state.workspaceId !== projectConfigurationKey(_workspaceId)) return false;
  return mutateProject(_workspaceId, "model.projectDefault.set", {
    expectedRevision: revision,
    ...selection
  }, "Pi 项目默认模型已更新");
}

export async function setGlobalVisionAssistantConfiguration(
  selection: { provider: string; model: string } | undefined
): Promise<boolean> {
  const state = useProviderConfigurationStore.getState();
  const revision = state.baselineRevision;
  if (state.workspaceId !== GLOBAL_PROVIDER_CONFIGURATION_KEY || !revision) return false;
  return mutateGlobal("vision.assistant.global.set", {
    expectedRevision: revision,
    ...selection
  }, selection ? "全局视觉辅助模型已更新" : "全局视觉辅助已关闭");
}

export async function setProjectVisionAssistantConfiguration(
  workspaceId: string,
  override:
    | { mode: "inherit" | "disabled" }
    | { mode: "model"; provider: string; model: string }
): Promise<boolean> {
  const state = useProviderConfigurationStore.getState();
  const revision = state.baselineRevision;
  if (!revision || state.workspaceId !== projectConfigurationKey(workspaceId)) return false;
  return mutateProject(workspaceId, "vision.assistant.project.set", {
    expectedRevision: revision,
    ...override
  }, "Pi 项目视觉辅助设置已更新");
}

export async function reloadProviderConfiguration(_workspaceId?: string): Promise<boolean> {
  try {
    const snapshot = await request(
      "provider.configuration.reload",
      {},
      PROVIDER_CONFIGURATION_LOAD_ACK_TIMEOUT_MS
    );
    useProviderConfigurationStore.getState().install(GLOBAL_PROVIDER_CONFIGURATION_KEY, snapshot);
    publishNotification({ level: "info", title: "已从 Pi 配置文件重新加载" });
    return true;
  } catch (error) {
    return reportFailure(GLOBAL_PROVIDER_CONFIGURATION_KEY, error);
  }
}

export async function reloadProjectProviderConfiguration(workspaceId: string): Promise<boolean> {
  const key = projectConfigurationKey(workspaceId);
  try {
    const snapshot = await requestWorkspace(
      workspaceId,
      "provider.projectConfiguration.reload",
      {},
      PROVIDER_CONFIGURATION_LOAD_ACK_TIMEOUT_MS
    );
    useProviderConfigurationStore.getState().install(key, snapshot);
    publishNotification({ level: "info", title: "已从项目 Pi 配置文件重新加载" });
    return true;
  } catch (error) {
    return reportFailure(key, error);
  }
}

export function handleProviderConfigurationChanged(
  change: PiProviderConfigurationChanged
): void {
  const store = useProviderConfigurationStore.getState();
  if (store.workspaceId === GLOBAL_PROVIDER_CONFIGURATION_KEY) {
    store.observeExternal(GLOBAL_PROVIDER_CONFIGURATION_KEY, change);
  }
}

export function handleProjectProviderConfigurationChanged(
  workspaceId: string,
  change: PiProviderConfigurationChanged
): void {
  useProviderConfigurationStore.getState().observeExternal(projectConfigurationKey(workspaceId), change);
}

async function mutateGlobal<T extends GlobalConfigurationMutationType>(
  type: T,
  payload: CommandPayloads[T],
  successTitle: string
): Promise<boolean> {
  try {
    const snapshot = await request(type, payload) as PiProviderConfigurationSnapshot;
    useProviderConfigurationStore.getState().install(GLOBAL_PROVIDER_CONFIGURATION_KEY, snapshot);
    publishNotification({ level: "info", title: successTitle });
    return true;
  } catch (error) {
    const store = useProviderConfigurationStore.getState();
    const message = error instanceof Error ? error.message : "未知错误";
    store.fail(GLOBAL_PROVIDER_CONFIGURATION_KEY, message);
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

async function mutateProject<T extends ProjectConfigurationMutationType>(
  workspaceId: string,
  type: T,
  payload: CommandPayloads[T],
  successTitle: string
): Promise<boolean> {
  const key = projectConfigurationKey(workspaceId);
  try {
    const snapshot = await requestWorkspace(workspaceId, type, payload) as PiProviderConfigurationSnapshot;
    useProviderConfigurationStore.getState().install(key, snapshot);
    publishNotification({ level: "info", title: successTitle });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    useProviderConfigurationStore.getState().fail(key, message);
    if (error instanceof ProtocolRequestError && error.code === "CONFIGURATION_CHANGED_EXTERNALLY") {
      publishNotification({
        level: "warning",
        title: "Pi 项目配置已在外部修改",
        message: "请重新加载最新配置后再保存。"
      });
      return false;
    }
    publishNotification({ level: "error", title: "Pi 项目配置操作失败", message });
    return false;
  }
}

type GlobalConfigurationMutationType = Extract<AgentCommandType,
  | "provider.configuration.save"
  | "provider.configuration.remove"
  | "provider.credential.store"
  | "provider.credential.remove"
  | "model.default.set"
  | "vision.assistant.global.set">;
type ProjectConfigurationMutationType = Extract<AgentCommandType,
  | "model.projectDefault.set"
  | "vision.assistant.project.set">;

function request<T extends AgentCommandType>(
  type: T,
  payload: CommandPayloads[T],
  ackTimeoutMs?: number
): Promise<CommandResults[T]> {
  return agentConnectionController.request(type, payload, [], {
    context: { scope: "app" },
    ...(ackTimeoutMs === undefined ? {} : { ackTimeoutMs })
  });
}

function requestWorkspace<T extends AgentCommandType>(
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

export function projectConfigurationKey(workspaceId: string): string {
  return `project:${workspaceId}`;
}

function reportFailure(workspaceId: string, error: unknown): false {
  const message = error instanceof Error ? error.message : "未知错误";
  useProviderConfigurationStore.getState().fail(workspaceId, message);
  return false;
}
