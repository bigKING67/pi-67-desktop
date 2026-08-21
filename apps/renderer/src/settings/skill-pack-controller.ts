import { taskConsumesRunSlot } from "@pi67/domain";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { publishNotification } from "../notifications/notification-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useSkillPackStore } from "./skill-pack-store.js";

export async function loadSkillPacks(workspaceId?: string): Promise<boolean> {
  const target = resolveWorkspace(workspaceId, false);
  if (!target) return false;
  useSkillPackStore.getState().begin(target.id, "loading");
  try {
    await ensureAgentConnection();
    const result = await agentConnectionController.request(
      "skill.pack.list",
      {},
      [],
      { context: workspaceContext(target.id) }
    );
    useSkillPackStore.getState().install(target.id, result.items, result.checkedAt);
    return true;
  } catch (error) {
    return reportFailure(target.id, error);
  }
}

export async function checkSkillPackUpdates(workspaceId?: string): Promise<boolean> {
  const target = resolveWorkspace(workspaceId, true);
  if (!target) return false;
  useSkillPackStore.getState().begin(target.id, "checking");
  try {
    await ensureAgentConnection();
    const result = await agentConnectionController.request(
      "skill.pack.checkUpdates",
      {},
      [],
      { context: workspaceContext(target.id) }
    );
    useSkillPackStore.getState().install(target.id, result.items, result.checkedAt);
    return true;
  } catch (error) {
    return reportFailure(target.id, error);
  }
}

export async function installSkillPack(id: string, workspaceId?: string): Promise<boolean> {
  const target = resolveWorkspace(workspaceId, true);
  if (!target || !preflightGlobalMutation()) return false;
  useSkillPackStore.getState().begin(target.id, "installing");
  try {
    await ensureAgentConnection();
    const result = await agentConnectionController.request(
      "skill.pack.install",
      { id },
      [],
      { context: workspaceContext(target.id) }
    );
    useSkillPackStore.getState().install(target.id, result.items, result.checkedAt);
    const installed = result.items.find((entry) => entry.id === id);
    if (installed?.updateStatus === "sync-pending") {
      publishNotification({
        level: "warning",
        title: "Lark CLI 已安装，Skills 待同步",
        message: "CLI 已完成验证并保留；官方全局 Skills 同步未完成，可在套件详情直接重试，无需重新下载 CLI。"
      });
      return true;
    }
    publishNotification({
      level: "success",
      title: "Lark CLI 已安装",
      message: result.changed
        ? "官方 Lark CLI 与全局办公 Skills 已安装；Pi-67 和其他兼容 Agent 可复用 ~/.agents/skills。"
        : "当前已经存在可用的 Lark CLI。"
    });
    return true;
  } catch (error) {
    return reportMutationFailure(target.id, id, error);
  }
}

export async function updateSkillPack(id: string, workspaceId?: string): Promise<boolean> {
  const target = resolveWorkspace(workspaceId, true);
  if (!target || !preflightGlobalMutation()) return false;
  useSkillPackStore.getState().begin(target.id, "updating");
  try {
    await ensureAgentConnection();
    const result = await agentConnectionController.request(
      "skill.pack.update",
      { id },
      [],
      { context: workspaceContext(target.id) }
    );
    useSkillPackStore.getState().install(target.id, result.items, result.checkedAt);
    const updated = result.items.find((entry) => entry.id === id);
    if (updated?.updateStatus === "sync-pending") {
      publishNotification({
        level: "warning",
        title: "Lark CLI 已更新，Skills 待同步",
        message: `CLI ${updated.installedVersion ?? "目标版本"} 已完成验证并保留；可在套件详情直接重试官方 Skills 同步，无需重新下载 CLI。`
      });
      return true;
    }
    publishNotification({
      level: "success",
      title: "技能套件已更新",
      message: result.changed ? "Pi 已重新加载所有项目可用的受管技能。" : "技能套件已经是最新版本。"
    });
    return true;
  } catch (error) {
    return reportMutationFailure(target.id, id, error);
  }
}

export async function restoreSkillPack(id: string, workspaceId?: string): Promise<boolean> {
  const target = resolveWorkspace(workspaceId, true);
  if (!target || !preflightGlobalMutation()) return false;
  useSkillPackStore.getState().begin(target.id, "restoring");
  try {
    await ensureAgentConnection();
    const result = await agentConnectionController.request(
      "skill.pack.restore",
      { id },
      [],
      { context: workspaceContext(target.id) }
    );
    useSkillPackStore.getState().install(target.id, result.items, result.checkedAt);
    publishNotification({
      level: "success",
      title: "已恢复内置技能套件",
      message: result.changed
        ? "受管 Overlay 已移除，Pi 已重新加载所有项目的内置基线。"
        : "当前已经使用内置基线。"
    });
    return true;
  } catch (error) {
    return reportFailure(target.id, error);
  }
}

function preflightGlobalMutation(): boolean {
  const workbench = rendererWorkbenchStore.getState();
  const busy = Object.values(workbench.tasks).some((task) => taskConsumesRunSlot(task.lifecycle));
  if (!busy) return true;
  publishNotification({
    level: "warning",
    title: "技能套件暂不可更改",
    message: "请先完成或停止所有正在运行或等待输入的任务。"
  });
  return false;
}

function resolveWorkspace(workspaceId: string | undefined, notify: boolean) {
  const workbench = rendererWorkbenchStore.getState();
  const id = workspaceId ?? workbench.settingsWorkspaceId ?? workbench.currentWorkspaceId;
  if (id && workbench.workspaces[id]) return workbench.workspaces[id];
  if (notify) {
    publishNotification({
      level: "warning",
      title: "没有可用的 Workspace",
      message: "请先从左侧添加或选择一个 Workspace。"
    });
  }
  return undefined;
}

function workspaceContext(workspaceId: string) {
  return { scope: "workspace" as const, workspaceId };
}

function reportFailure(workspaceId: string, error: unknown): false {
  const message = error instanceof Error ? error.message : "未知错误";
  useSkillPackStore.getState().fail(workspaceId, message);
  return false;
}

async function reportMutationFailure(
  workspaceId: string,
  id: string,
  error: unknown
): Promise<false> {
  const message = error instanceof Error ? error.message : "未知错误";
  useSkillPackStore.getState().invalidate(workspaceId, id, message);
  try {
    const result = await agentConnectionController.request(
      "skill.pack.checkUpdates",
      {},
      [],
      { context: workspaceContext(workspaceId) }
    );
    useSkillPackStore.getState().install(workspaceId, result.items, result.checkedAt);
  } catch {
    // Keep the affected Pack explicitly unverified when the recovery check also fails.
  }
  useSkillPackStore.getState().fail(workspaceId, message);
  return false;
}
