import {
  taskConsumesRunSlot,
  type ExtensionPackageMutationResult,
  type ExtensionPackageScope
} from "@pi67/domain";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { publishNotification } from "../notifications/notification-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useExtensionPackageStore } from "./extension-package-store.js";

export async function loadExtensionPackages(workspaceId?: string): Promise<boolean> {
  const target = resolveWorkspace(workspaceId);
  if (!target) return false;
  const store = useExtensionPackageStore.getState();
  store.begin(target.id, "loading");
  try {
    await ensureAgentConnection();
    const result = await agentConnectionController.request(
      "extension.package.list",
      {},
      [],
      { context: workspaceContext(target.id) }
    );
    store.installList(target.id, result.items);
    return true;
  } catch (error) {
    return reportFailure(target.id, "无法读取 Pi 资源包", error);
  }
}

export async function checkExtensionPackageUpdates(workspaceId?: string): Promise<boolean> {
  const target = resolveWorkspace(workspaceId);
  if (!target) return false;
  useExtensionPackageStore.getState().begin(target.id, "checking");
  try {
    await ensureAgentConnection();
    const result = await agentConnectionController.request(
      "extension.package.checkUpdates",
      {},
      [],
      { context: workspaceContext(target.id) }
    );
    useExtensionPackageStore.getState().installUpdates(target.id, result.items);
    publishNotification({
      level: "info",
      title: "资源包更新检查完成",
      message: result.total === 0 ? "当前没有可用更新。" : `发现 ${result.total} 个可用更新。`
    });
    return true;
  } catch (error) {
    return reportFailure(target.id, "无法检查资源包更新", error);
  }
}

export async function installExtensionPackage(
  source: string,
  scope: ExtensionPackageScope,
  workspaceId?: string
): Promise<boolean> {
  return mutate("extension.package.install", { source, scope }, scope, workspaceId, "资源包已安装");
}

export async function updateExtensionPackage(
  source: string,
  scope: ExtensionPackageScope,
  workspaceId?: string
): Promise<boolean> {
  return mutate("extension.package.update", { source, scope }, scope, workspaceId, "资源包已更新");
}

export async function setExtensionPackageEnabled(
  source: string,
  scope: ExtensionPackageScope,
  enabled: boolean,
  workspaceId?: string,
  resourceType: import("@pi67/domain").PackageResourceType = "extension"
): Promise<boolean> {
  const label = resourceType === "skill"
    ? "技能"
    : resourceType === "prompt"
      ? "指令模板"
      : resourceType === "theme"
        ? "主题"
        : "扩展";
  return mutate(
    "extension.package.setEnabled",
    { source, scope, enabled, resourceType },
    scope,
    workspaceId,
    enabled ? `${label} 已启用` : `${label} 已停用`
  );
}

export async function restoreExtensionPackageInheritance(
  source: string,
  workspaceId?: string
): Promise<boolean> {
  return mutate(
    "extension.package.restoreInheritance",
    { source },
    "project",
    workspaceId,
    "资源包已恢复继承"
  );
}

export async function uninstallExtensionPackage(
  source: string,
  scope: ExtensionPackageScope,
  workspaceId?: string
): Promise<boolean> {
  return mutate(
    "extension.package.uninstall",
    { source, scope },
    scope,
    workspaceId,
    "资源包已卸载"
  );
}

async function mutate<T extends MutationType>(
  type: T,
  payload: MutationPayload<T>,
  scope: ExtensionPackageScope,
  workspaceId: string | undefined,
  successTitle: string
): Promise<boolean> {
  const target = resolveWorkspace(workspaceId);
  if (!target || !preflightMutation(target.id, scope)) return false;
  useExtensionPackageStore.getState().begin(target.id, "mutating");
  try {
    await ensureAgentConnection();
    const result = await agentConnectionController.request(
      type,
      payload,
      [],
      { context: workspaceContext(target.id) }
    ) as ExtensionPackageMutationResult;
    const store = useExtensionPackageStore.getState();
    store.installList(target.id, result.items);
    if (
      (type === "extension.package.update" || type === "extension.package.uninstall")
      && "scope" in payload
    ) store.removeUpdate(target.id, payload.source, payload.scope);
    publishNotification({
      level: "success",
      title: successTitle,
      message: result.changed ? "Pi Settings 已更新。" : "配置已经是目标状态。"
    });
    return true;
  } catch (error) {
    return reportFailure(target.id, "资源包操作失败", error);
  }
}

function preflightMutation(workspaceId: string, scope: ExtensionPackageScope): boolean {
  const workbench = rendererWorkbenchStore.getState();
  const workspace = workbench.workspaces[workspaceId];
  if (!workspace) return false;
  if (scope === "project" && workspace.trust !== "trusted") {
    publishNotification({
      level: "error",
      title: "项目资源包设置未更改",
      message: "请先信任当前 Workspace。"
    });
    return false;
  }
  const busy = Object.values(workbench.tasks).some((task) => (
    taskConsumesRunSlot(task.lifecycle)
    && (scope === "global" || task.workspaceId === workspaceId)
  ));
  if (busy) {
    publishNotification({
      level: "warning",
      title: "资源包操作暂不可用",
      message: scope === "global"
        ? "请先完成或停止所有正在运行或等待输入的任务。"
        : "请先完成或停止当前 Workspace 中正在运行或等待输入的任务。"
    });
    return false;
  }
  return true;
}

function resolveWorkspace(workspaceId?: string) {
  const workbench = rendererWorkbenchStore.getState();
  const id = workspaceId ?? workbench.settingsWorkspaceId ?? workbench.currentWorkspaceId;
  if (!id || !workbench.workspaces[id]) {
    publishNotification({
      level: "warning",
      title: "没有可用的 Workspace",
      message: "请先从左侧添加或选择一个 Workspace。"
    });
    return undefined;
  }
  return workbench.workspaces[id];
}

function workspaceContext(workspaceId: string) {
  return { scope: "workspace" as const, workspaceId };
}

function reportFailure(workspaceId: string, title: string, error: unknown): false {
  const message = error instanceof Error ? error.message : "未知错误";
  useExtensionPackageStore.getState().fail(workspaceId, message);
  publishNotification({ level: "error", title, message });
  return false;
}

type MutationType =
  | "extension.package.install"
  | "extension.package.update"
  | "extension.package.setEnabled"
  | "extension.package.restoreInheritance"
  | "extension.package.uninstall";

type MutationPayload<T extends MutationType> = Parameters<AgentConnectionControllerRequest<T>>[1];
type AgentConnectionControllerRequest<T extends MutationType> = (
  type: T,
  payload: import("@pi67/protocol").CommandPayloads[T]
) => unknown;
