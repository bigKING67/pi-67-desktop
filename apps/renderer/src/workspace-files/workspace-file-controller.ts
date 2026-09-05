import type {
  WorkspaceDescriptor,
  WorkspaceEntryContextAction,
  WorkspaceEntryRequest,
  WorkspaceFileContentSearchMatch,
  WorkspaceFileEntry
} from "@pi67/domain";
import { ProtocolRequestError } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import { workspaceFileStore } from "./workspace-file-store.js";

export type WorkspaceFileMutationUiResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

async function openWorkspaceFile(
  workspace: WorkspaceDescriptor,
  entry: WorkspaceFileEntry,
  options: {
    discardDraft?: boolean;
    hostRegistered?: boolean;
    notifyFailure?: boolean;
    preserveDraftOnFailure?: boolean;
  } = {}
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
    if (!options.preserveDraftOnFailure) {
      workspaceFileStore.getState().failOpen(
        workspace.id,
        entry.relativePath,
        errorMessage(error),
        error instanceof ProtocolRequestError && error.code === "RESOURCE_NOT_FOUND"
      );
    }
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

export async function openWorkspaceFileEntry(
  workspace: WorkspaceDescriptor,
  entry: WorkspaceFileEntry
): Promise<boolean> {
  if (entry.kind !== "file") return false;
  const existing = workspaceFileStore.getState().workspaces[workspace.id]?.byPath[entry.relativePath];
  if (existing) {
    await activateWorkspaceFileTab(workspace, entry.relativePath);
    return true;
  }
  return openWorkspaceFile(workspace, entry, { notifyFailure: true });
}

export async function openWorkspaceContentSearchMatch(
  workspace: WorkspaceDescriptor,
  match: WorkspaceFileContentSearchMatch
): Promise<boolean> {
  const current = workspaceFileStore.getState().workspaces[workspace.id]?.byPath[match.entry.relativePath];
  if (current?.dirty && current.revision !== match.entry.revision) {
    publishNotification({
      level: "warning",
      title: "搜索结果已过期",
      message: "文件已有未保存草稿，无法安全定位到这条旧搜索结果。"
    });
    return false;
  }
  let opened: boolean;
  if (current?.phase === "ready" && current.revision === match.entry.revision) {
    workspaceFileStore.getState().activateTab(workspace.id, match.entry.relativePath);
    opened = true;
  } else {
    opened = await openWorkspaceFile(workspace, match.entry, {
      discardDraft: !current?.dirty,
      notifyFailure: true,
      preserveDraftOnFailure: Boolean(current?.dirty)
    });
  }
  const tab = workspaceFileStore.getState().workspaces[workspace.id]?.byPath[match.entry.relativePath];
  if (!opened || tab?.phase !== "ready" || tab.revision !== match.entry.revision) return false;
  workspaceFileStore.getState().requestNavigation(workspace.id, {
    relativePath: match.entry.relativePath,
    revision: match.entry.revision,
    line: match.line,
    column: match.column,
    query: match.snippet
  });
  return true;
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
): Promise<boolean> {
  const tab = workspaceFileStore.getState().workspaces[workspace.id]?.byPath[relativePath];
  if (!tab) return false;
  let entry: WorkspaceFileEntry;
  let hostRegistered = false;
  if (tab.id) {
    entry = {
      id: tab.id,
      name: tab.name,
      relativePath,
      kind: "file",
      revision: tab.revision ?? "pending"
    };
  } else {
    try {
      if (!await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false })) {
        throw new Error("工作区当前不可用。");
      }
      hostRegistered = true;
      const resolved = await agentConnectionController.request(
        "workspace.file.resolve",
        { relativePath },
        [],
        { context: { scope: "workspace", workspaceId: workspace.id } }
      );
      if (resolved.entry.kind !== "file") throw new Error("此标签不再指向普通文件。");
      entry = resolved.entry;
      workspaceFileStore.getState().installResolvedEntry(workspace.id, entry);
    } catch (error) {
      publishNotification({ level: "error", title: "无法打开工作区文件", message: errorMessage(error) });
      return false;
    }
  }
  return openWorkspaceFile(workspace, entry, {
    discardDraft: true,
    hostRegistered,
    notifyFailure: true,
    preserveDraftOnFailure: tab.dirty
  });
}

const fileSavesInFlight = new Set<string>();

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
  const saveKey = JSON.stringify([workspace.id, tab.id]);
  if (fileSavesInFlight.has(saveKey)) return false;
  fileSavesInFlight.add(saveKey);
  try {
    await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
    const result = await agentConnectionController.request(
      "workspace.file.save",
      { id: tab.id, expectedRevision: tab.revision, content: tab.content },
      [],
      { context: { scope: "workspace", workspaceId: workspace.id } }
    );
    return workspaceFileStore.getState().markSaved(workspace.id, result.entry, tab);
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
  } finally {
    fileSavesInFlight.delete(saveKey);
  }
}

export async function createWorkspaceEntry(
  workspace: WorkspaceDescriptor,
  parentId: string | undefined,
  name: string,
  kind: "file" | "directory",
  options: { openCreatedFile?: boolean } = {}
): Promise<WorkspaceFileMutationUiResult<WorkspaceFileEntry>> {
  try {
    await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
    const result = await agentConnectionController.request(
      "workspace.file.create",
      { ...(parentId === undefined ? {} : { parentId }), name, kind },
      [],
      { context: { scope: "workspace", workspaceId: workspace.id } }
    );
    if (kind === "file" && options.openCreatedFile !== false) await openWorkspaceFile(workspace, result.entry);
    return { ok: true, value: result.entry };
  } catch (error) {
    return { ok: false, message: workspaceFileMutationErrorMessage(error) };
  }
}

export async function renameWorkspaceEntry(
  workspace: WorkspaceDescriptor,
  entry: WorkspaceFileEntry,
  name: string
): Promise<WorkspaceFileMutationUiResult<WorkspaceFileEntry>> {
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
    return { ok: true, value: result.entry };
  } catch (error) {
    return { ok: false, message: workspaceFileMutationErrorMessage(error) };
  }
}

export async function showWorkspaceEntryMenu(
  workspace: WorkspaceDescriptor,
  entry: WorkspaceFileEntry,
  options: { includeManagement?: boolean } = {}
): Promise<WorkspaceEntryContextAction | undefined> {
  const request = entryRequest(workspace.id, entry);
  try {
    return await window.pi67.system.showWorkspaceEntryContextMenu(request, options.includeManagement);
  } catch (error) {
    publishNotification({ level: "error", title: "文件操作失败", message: errorMessage(error) });
    return undefined;
  }
}

export async function executeWorkspaceEntryAction(
  workspace: WorkspaceDescriptor,
  entry: WorkspaceFileEntry,
  action: WorkspaceEntryContextAction
): Promise<boolean> {
  const request = entryRequest(workspace.id, entry);
  try {
    if (action === "pi67-open") return openWorkspaceFileEntry(workspace, entry);
    if (action === "open-default") return window.pi67.system.openWorkspaceEntryInDefaultApp(request);
    if (action === "copy-absolute" || action === "copy-relative") {
      const mode = action === "copy-absolute" ? "absolute" : "relative";
      const copied = await window.pi67.system.copyWorkspaceEntryPath(request, mode);
      if (copied) {
        publishNotification({
          level: "success",
          title: mode === "absolute" ? "已复制绝对路径" : "已复制相对路径",
          message: entry.relativePath
        });
      }
      return copied;
    }
    if (action === "rename" || action === "trash") return false;
    return window.pi67.system.revealWorkspaceEntry(request);
  } catch (error) {
    publishNotification({ level: "error", title: "文件操作失败", message: errorMessage(error) });
    return false;
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
): Promise<WorkspaceFileMutationUiResult<WorkspaceFileEntry>> {
  const source = workspaceFileStore.getState().workspaces[workspace.id]?.byPath[sourceRelativePath];
  if (source?.content === undefined) return { ok: false, message: "当前草稿内容不可用。" };
  const parentPath = parentRelativePath(sourceRelativePath);
  let parentId: string | undefined;
  let createdEntry: WorkspaceFileEntry | undefined;
  try {
    await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
    if (parentPath) {
      const parent = await agentConnectionController.request(
        "workspace.file.resolve",
        { relativePath: parentPath },
        [],
        { context: { scope: "workspace", workspaceId: workspace.id } }
      );
      if (parent.entry.kind !== "directory") return { ok: false, message: "原文件所在位置不再是文件夹。" };
      parentId = parent.entry.id;
    }
    const created = await createWorkspaceEntry(workspace, parentId, name, "file", { openCreatedFile: false });
    if (!created.ok) return created;
    createdEntry = created.value;
    const saved = await agentConnectionController.request(
      "workspace.file.save",
      { id: created.value.id, expectedRevision: created.value.revision, content: source.content },
      [],
      { context: { scope: "workspace", workspaceId: workspace.id } }
    );
    if (!await openWorkspaceFile(workspace, saved.entry)) {
      return { ok: false, message: "草稿已另存，但新文件未能在编辑器中打开。请从文件列表重新打开。" };
    }
    workspaceFileStore.getState().closeTab(workspace.id, sourceRelativePath);
    return { ok: true, value: saved.entry };
  } catch (error) {
    const message = workspaceFileMutationErrorMessage(error);
    return createdEntry
      ? { ok: false, message: `“${createdEntry.relativePath}”已创建，但草稿写入失败。${message}` }
      : { ok: false, message };
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

function workspaceFileMutationErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  if (message.includes("目标名称已存在")) return "此位置已经存在同名文件或文件夹。";
  if (!(error instanceof ProtocolRequestError)) return message;
  if (error.code === "INVALID_PAYLOAD") return "名称不合法，请检查字符、长度和结尾。";
  if (error.code === "WORKSPACE_NOT_TRUSTED") return "请先信任工作区，再修改其中的文件。";
  if (error.code === "RESOURCE_NOT_FOUND") return "目标位置已变化，请刷新文件列表后重试。";
  if (error.code === "RESOURCE_CHANGED_EXTERNALLY") return "文件或目标位置在操作期间发生变化，请刷新后重试。";
  if (error.code === "UNSUPPORTED" && message.toLocaleLowerCase().includes("git")) {
    return "不能通过文件面板管理 .git 元数据。";
  }
  return message;
}
