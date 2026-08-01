import { ProtocolRequestError, type AgentCommandType, type CommandPayloads, type CommandResults } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { ensureAgentConnection } from "../connection/connection-recovery.js";
import { publishNotification } from "../notifications/notification-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { useContextFileStore } from "./context-file-store.js";

const catalogFlights = new Map<string, Promise<boolean>>();

export function loadContextFileCatalog(workspaceId?: string): Promise<boolean> {
  const target = resolveWorkspace(workspaceId);
  if (!target) return Promise.resolve(false);
  const existing = catalogFlights.get(target.id);
  if (existing) return existing;
  const flight = performCatalogLoad(target.id);
  catalogFlights.set(target.id, flight);
  void flight.finally(() => {
    if (catalogFlights.get(target.id) === flight) catalogFlights.delete(target.id);
  }).catch(() => undefined);
  return flight;
}

async function performCatalogLoad(workspaceId: string): Promise<boolean> {
  const target = resolveWorkspace(workspaceId);
  if (!target) return false;
  useContextFileStore.getState().beginCatalogLoad(workspaceId);
  try {
    await ensureAgentConnection();
    await registerRendererWorkspaceWithHost(target, { queryCatalog: false });
    const catalog = await request(workspaceId, "context.file.list", {});
    useContextFileStore.getState().installCatalog(workspaceId, catalog);
    return true;
  } catch (error) {
    return reportFailure(workspaceId, "无法读取规则与上下文文件", error);
  }
}

export async function readContextFile(id: string, workspaceId?: string): Promise<boolean> {
  const target = resolveWorkspace(workspaceId);
  if (!target) return false;
  useContextFileStore.getState().beginRead(target.id, id);
  try {
    const result = await request(target.id, "context.file.read", { id });
    useContextFileStore.getState().installRead(target.id, id, result);
    return true;
  } catch (error) {
    return reportFailure(target.id, "无法读取 Markdown 文件", error);
  }
}

export async function saveSelectedContextFile(workspaceId?: string): Promise<boolean> {
  const target = resolveWorkspace(workspaceId);
  const state = useContextFileStore.getState();
  if (
    !target
    || state.workspaceId !== target.id
    || !state.selectedItem
    || state.draft === undefined
    || !state.baselineRevision
    || state.externalConflict
  ) return false;
  const id = state.selectedItem.id;
  const content = state.draft;
  state.beginSave();
  try {
    const result = await request(target.id, "context.file.save", {
      id,
      expectedRevision: state.baselineRevision,
      content
    });
    useContextFileStore.getState().installSave(target.id, id, content, result);
    publishNotification({
      level: "success",
      title: `${result.item.name} 已保存`,
      message: `${scopeLabel(result.item.scope)} · Pi 资源已重新加载。`
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    if (error instanceof ProtocolRequestError && error.code === "RESOURCE_CHANGED_EXTERNALLY") {
      useContextFileStore.getState().markConflict(message);
      publishNotification({
        level: "warning",
        title: "文件已在外部修改",
        message: "当前草稿仍被保留。重新读取最新文件后才能继续保存。"
      });
      return false;
    }
    useContextFileStore.getState().fail(target.id, message);
    publishNotification({ level: "error", title: "Markdown 文件保存失败", message });
    return false;
  }
}

export function resetContextFileLoadState(): void {
  catalogFlights.clear();
  useContextFileStore.getState().reset();
}

function request<T extends ContextFileCommandType>(
  workspaceId: string,
  type: T,
  payload: CommandPayloads[T]
): Promise<CommandResults[T]> {
  return agentConnectionController.request(type, payload, [], {
    context: { scope: "workspace", workspaceId }
  });
}

type ContextFileCommandType = Extract<AgentCommandType,
  "context.file.list" | "context.file.read" | "context.file.save">;

function resolveWorkspace(workspaceId?: string) {
  const workbench = rendererWorkbenchStore.getState();
  const id = workspaceId ?? workbench.settingsWorkspaceId ?? workbench.currentWorkspaceId;
  return id ? workbench.workspaces[id] : undefined;
}

function reportFailure(workspaceId: string, title: string, error: unknown): false {
  const message = error instanceof Error ? error.message : "未知错误";
  useContextFileStore.getState().fail(workspaceId, message);
  publishNotification({ level: "error", title, message });
  return false;
}

function scopeLabel(scope: "managed" | "global" | "project" | "inherited"): string {
  if (scope === "global") return "全局可用";
  if (scope === "project") return "项目专属";
  if (scope === "managed") return "Desktop 托管";
  return "继承上下文";
}
