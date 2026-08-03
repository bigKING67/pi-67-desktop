import type {
  WorkspaceDescriptor,
  WorkspaceEntryContextAction,
  WorkspaceEntryRequest,
  WorkspaceFileEntry
} from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import { workspaceFileStore } from "./workspace-file-store.js";

async function openWorkspaceFile(
  workspace: WorkspaceDescriptor,
  entry: WorkspaceFileEntry,
  options: { discardDraft?: boolean; hostRegistered?: boolean; notifyFailure?: boolean } = {}
): Promise<boolean> {
  if (entry.kind !== "file") return false;
  workspaceFileStore.getState().beginOpen(workspace.id, entry);
  if (!workspaceFileStore.getState().workspaces[workspace.id]?.byPath[entry.relativePath]) {
    publishNotification({
      level: "warning",
      title: "无法打开更多文件",
      message: workspaceFileStore.getState().persistenceError ?? "请先关闭不需要的文件标签。"
    });
    return false;
  }
  try {
    if (!options.hostRegistered) {
      await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
    }
    const result = await agentConnectionController.request(
      "workspace.file.open",
      { id: entry.id },
      [],
      { context: { scope: "workspace", workspaceId: workspace.id } }
    );
    workspaceFileStore.getState().installOpenResult(workspace.id, result, options.discardDraft);
    return true;
  } catch (error) {
    workspaceFileStore.getState().failOpen(
      workspace.id,
      entry.relativePath,
      errorMessage(error),
      error instanceof ProtocolRequestError && error.code === "RESOURCE_NOT_FOUND"
    );
    if (options.notifyFailure) {
      publishNotification({ level: "error", title: "无法打开工作区文件", message: errorMessage(error) });
    }
    return false;
  }
}

export async function openWorkspaceFileByRelativePath(
  workspace: WorkspaceDescriptor,
  relativePath: string
): Promise<boolean> {
  try {
    if (!await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false })) {
      throw new Error("工作区当前不可用。");
    }
    const result = await agentConnectionController.request(
      "workspace.file.resolve",
      { relativePath },
      [],
      { context: { scope: "workspace", workspaceId: workspace.id } }
    );
    if (result.entry.kind !== "file") {
      publishNotification({
        level: "warning",
        title: "无法打开工作区链接",
        message: "该链接没有指向普通文件。"
      });
      return false;
    }
    return openWorkspaceFile(workspace, result.entry, { hostRegistered: true, notifyFailure: true });
  } catch (error) {
    publishNotification({ level: "error", title: "无法打开工作区链接", message: errorMessage(error) });
    return false;
  }
}

export async function activateWorkspaceFileTab(
  workspace: WorkspaceDescriptor,
  relativePath: string
): Promise<void> {
  const tab = workspaceFileStore.getState().workspaces[workspace.id]?.byPath[relativePath];
  if (!tab) return;
  workspaceFileStore.getState().activateTab(workspace.id, relativePath);
  if (tab.phase !== "restoring") return;
  try {
    await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
    let entry: WorkspaceFileEntry;
    if (tab.id) {
      entry = {
        id: tab.id,
        name: tab.name,
        relativePath: tab.relativePath,
        kind: "file",
        revision: tab.revision ?? "pending"
      };
    } else {
      const resolved = await agentConnectionController.request(
        "workspace.file.resolve",
        { relativePath },
        [],
        { context: { scope: "workspace", workspaceId: workspace.id } }
      );
      if (resolved.entry.kind !== "file") throw new Error("此标签不再指向普通文件。");
      entry = resolved.entry;
      workspaceFileStore.getState().installResolvedEntry(workspace.id, entry);
    }
    await openWorkspaceFile(workspace, entry);
  } catch (error) {
    workspaceFileStore.getState().failOpen(
      workspace.id,
      relativePath,
      errorMessage(error),
      error instanceof ProtocolRequestError && error.code === "RESOURCE_NOT_FOUND"
    );
  }
}

export async function reloadWorkspaceFile(
  workspace: WorkspaceDescriptor,
  relativePath: string
): Promise<void> {
  const tab = workspaceFileStore.getState().workspaces[workspace.id]?.byPath[relativePath];
  if (!tab?.id) return activateWorkspaceFileTab(workspace, relativePath);
  await openWorkspaceFile(workspace, {
    id: tab.id,
    name: tab.name,
    relativePath,
    kind: "file",
    revision: tab.revision ?? "pending"
  }, { discardDraft: true });
}

export async function saveWorkspaceFile(
  workspace: WorkspaceDescriptor,
  relativePath: string
): Promise<boolean> {
  const tab = workspaceFileStore.getState().workspaces[workspace.id]?.byPath[relativePath];
  if (!tab?.id || tab.phase !== "ready" || tab.content === undefined || !tab.revision) return false;
  if (tab.conflict) {
    publishNotification({
      level: "warning",
      title: "文件存在外部修改",
      message: "请重新读取磁盘文件，或将当前草稿另存为新文件。"
    });
    return false;
  }
  try {
    await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
    const result = await agentConnectionController.request(
      "workspace.file.save",
      { id: tab.id, expectedRevision: tab.revision, content: tab.content },
      [],
      { context: { scope: "workspace", workspaceId: workspace.id } }
    );
    workspaceFileStore.getState().markSaved(workspace.id, result.entry);
    return true;
  } catch (error) {
    if (error instanceof ProtocolRequestError && error.code === "RESOURCE_CHANGED_EXTERNALLY") {
      workspaceFileStore.getState().markConflict(workspace.id, relativePath, error.message);
    }
    publishNotification({
      level: "error",
      title: "文件保存失败",
      message: errorMessage(error)
    });
    return false;
  }
}

export async function createWorkspaceEntry(
  workspace: WorkspaceDescriptor,
  parentId: string | undefined,
  name: string,
  kind: "file" | "directory"
): Promise<WorkspaceFileEntry | undefined> {
  try {
    await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
    const result = await agentConnectionController.request(
      "workspace.file.create",
      { ...(parentId === undefined ? {} : { parentId }), name, kind },
      [],
      { context: { scope: "workspace", workspaceId: workspace.id } }
    );
    if (kind === "file") await openWorkspaceFile(workspace, result.entry);
    return result.entry;
  } catch (error) {
    publishNotification({ level: "error", title: "无法创建", message: errorMessage(error) });
    return undefined;
  }
}

export async function renameWorkspaceEntry(
  workspace: WorkspaceDescriptor,
  entry: WorkspaceFileEntry,
  name: string
): Promise<WorkspaceFileEntry | undefined> {
  try {
    await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
    const result = await agentConnectionController.request(
      "workspace.file.rename",
      { id: entry.id, name },
      [],
      { context: { scope: "workspace", workspaceId: workspace.id } }
    );
    workspaceFileStore.getState().renamePath(
      workspace.id,
      result.previousRelativePath,
      result.entry.relativePath,
      result.entry
    );
    return result.entry;
  } catch (error) {
    publishNotification({ level: "error", title: "无法重命名", message: errorMessage(error) });
    return undefined;
  }
}

export async function showWorkspaceEntryMenu(
  workspace: WorkspaceDescriptor,
  entry: WorkspaceFileEntry
): Promise<void> {
  const request = entryRequest(workspace.id, entry);
  try {
    const action = await window.pi67.system.showWorkspaceEntryContextMenu(request);
    await executeNativeEntryAction(workspace, entry, request, action);
  } catch (error) {
    publishNotification({ level: "error", title: "文件操作失败", message: errorMessage(error) });
  }
}

export async function revealWorkspaceEntry(
  workspace: WorkspaceDescriptor,
  entry: WorkspaceFileEntry
): Promise<void> {
  try {
    await window.pi67.system.revealWorkspaceEntry(entryRequest(workspace.id, entry));
  } catch (error) {
    publishNotification({ level: "error", title: "无法在系统中定位", message: errorMessage(error) });
  }
}

export async function trashWorkspaceEntry(
  workspace: WorkspaceDescriptor,
  entry: WorkspaceFileEntry
): Promise<boolean> {
  try {
    const trashed = await window.pi67.system.trashWorkspaceEntry(entryRequest(workspace.id, entry));
    if (trashed) workspaceFileStore.getState().removePath(
      workspace.id,
      entry.relativePath,
      entry.kind === "directory"
    );
    return trashed;
  } catch (error) {
    publishNotification({ level: "error", title: "无法移到废纸篓", message: errorMessage(error) });
    return false;
  }
}

export async function saveWorkspaceDraftAs(
  workspace: WorkspaceDescriptor,
  sourceRelativePath: string,
  name: string
): Promise<boolean> {
  const source = workspaceFileStore.getState().workspaces[workspace.id]?.byPath[sourceRelativePath];
  if (source?.content === undefined) return false;
  const parentPath = parentRelativePath(sourceRelativePath);
  let parentId: string | undefined;
  try {
    await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
    if (parentPath) {
      const parent = await agentConnectionController.request(
        "workspace.file.resolve",
        { relativePath: parentPath },
        [],
        { context: { scope: "workspace", workspaceId: workspace.id } }
      );
      if (parent.entry.kind !== "directory") return false;
      parentId = parent.entry.id;
    }
    const created = await createWorkspaceEntry(workspace, parentId, name, "file");
    if (!created) return false;
    workspaceFileStore.getState().updateContent(workspace.id, created.relativePath, source.content);
    if (!await saveWorkspaceFile(workspace, created.relativePath)) return false;
    workspaceFileStore.getState().closeTab(workspace.id, sourceRelativePath);
    return true;
  } catch (error) {
    publishNotification({ level: "error", title: "草稿另存失败", message: errorMessage(error) });
    return false;
  }
}

async function executeNativeEntryAction(
  workspace: WorkspaceDescriptor,
  entry: WorkspaceFileEntry,
  request: WorkspaceEntryRequest,
  action: WorkspaceEntryContextAction | undefined
): Promise<void> {
  if (action === "pi67-open") {
    const existing = workspaceFileStore.getState().workspaces[workspace.id]?.byPath[entry.relativePath];
    if (existing) await activateWorkspaceFileTab(workspace, entry.relativePath);
    else if (entry.id) await openWorkspaceFile(workspace, entry);
  } else if (action === "open-default") {
    await window.pi67.system.openWorkspaceEntryInDefaultApp(request);
  } else if (action === "copy-absolute") {
    await window.pi67.system.copyWorkspaceEntryPath(request, "absolute");
  } else if (action === "copy-relative") {
    await window.pi67.system.copyWorkspaceEntryPath(request, "relative");
  } else if (action === "reveal") {
    await window.pi67.system.revealWorkspaceEntry(request);
  }
}

function entryRequest(workspaceId: string, entry: WorkspaceFileEntry): WorkspaceEntryRequest {
  return { workspaceId, relativePath: entry.relativePath, kind: entry.kind };
}

function parentRelativePath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Workspace 文件操作失败。";
}
