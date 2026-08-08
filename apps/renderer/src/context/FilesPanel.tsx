import type {
  WorkspaceDescriptor,
  WorkspaceEntryContextAction,
  WorkspaceFileEntry,
  WorkspaceFilePage,
  WorkspaceFileSearchResult
} from "@pi67/domain";
import { useEffect, useMemo, useRef, useState } from "react";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import { selectedWorkbenchTask, useWorkbenchStore } from "../workbench/workbench-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import {
  createWorkspaceEntry,
  executeWorkspaceEntryAction,
  openWorkspaceFileEntry,
  renameWorkspaceEntry,
  showWorkspaceEntryMenu,
  trashWorkspaceEntry
} from "../workspace-files/workspace-file-controller.js";
import { workspaceHasDirtyPath } from "../workspace-files/workspace-file-store.js";
import { WorkspaceFileNameDialog } from "../workspace-files/WorkspaceFileNameDialog.js";
import {
  WorkspaceFileTree,
  type WorkspaceDirectoryProjection,
  type WorkspaceFileSelection
} from "./WorkspaceFileTree.js";
import { WorkspaceFilesToolbar } from "./WorkspaceFilesToolbar.js";

type NameDialogState =
  | { kind: "create"; entryKind: "file" | "directory" }
  | { kind: "rename"; selected: WorkspaceFileSelection };

const ROOT_KEY = "__workspace_root__";

export function FilesPanel() {
  const workspace = useWorkbenchStore(selectedFilesWorkspaceState);
  const workspaceId = workspace?.id;
  const [directories, setDirectories] = useState<Record<string, WorkspaceDirectoryProjection>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<WorkspaceFileSelection>();
  const [query, setQuery] = useState("");
  const [includeGenerated, setIncludeGenerated] = useState(false);
  const [searchResult, setSearchResult] = useState<WorkspaceFileSearchResult>();
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [nameDialog, setNameDialog] = useState<NameDialogState>();
  const [error, setError] = useState<string>();
  const directoryRevision = useRef(0);
  const searchRevision = useRef(0);
  const activeWorkspaceId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!workspaceId || activeWorkspaceId.current === workspaceId) return;
    activeWorkspaceId.current = workspaceId;
    directoryRevision.current += 1;
    searchRevision.current += 1;
    setDirectories({});
    setExpanded(new Set());
    setSelected(undefined);
    setQuery("");
    setSearchResult(undefined);
    setError(undefined);
    void loadDirectory(undefined, false, true);
  }, [workspaceId]);

  const root = directories[ROOT_KEY];
  const visibleEntries = useMemo(() => searchResult?.entries ?? root?.entries ?? [], [root, searchResult]);

  if (!workspaceId || !workspace) return <p className="context-empty">先选择一个工作区，再浏览文件。</p>;
  const currentWorkspace = workspace;

  return (
    <div className="inspector-files">
      <WorkspaceFilesToolbar
        includeGenerated={includeGenerated}
        query={query}
        refreshing={refreshing}
        searching={searching}
        onCreateDirectory={() => setNameDialog({ kind: "create", entryKind: "directory" })}
        onCreateFile={() => setNameDialog({ kind: "create", entryKind: "file" })}
        onIncludeGeneratedChange={(next) => {
          setIncludeGenerated(next);
          void refreshTree(next);
        }}
        onQueryChange={(next) => {
          setQuery(next);
          if (!next.trim() || searching || (searchResult && next.trim() !== searchResult.query)) {
            searchRevision.current += 1;
            setSearchResult(undefined);
            setSelected(undefined);
            setSearching(false);
          }
        }}
        onRefresh={() => void refreshTree()}
        onSearch={() => void runSearch(query.trim(), includeGenerated)}
      />
      {searchResult ? (
        <p className="inspector-result-summary">
          {searchResult.entries.length} 项结果{searchResult.truncated ? " · 已达搜索上限" : ""}
        </p>
      ) : null}
      {error ? <p className="inspector-error" role="alert">{error}</p> : null}
      <WorkspaceFileTree
        workspaceId={workspaceId}
        directories={directories}
        entries={visibleEntries}
        expanded={expanded}
        rootLoaded={root !== undefined}
        rootLoading={root?.loading ?? false}
        searchMode={searchResult !== undefined}
        {...(selected === undefined ? {} : { selected })}
        {...(root?.nextCursor === undefined ? {} : { rootNextCursor: root.nextCursor })}
        onEntryAction={(entry, action) => void executeEntryAction(entry, action)}
        onLoadMore={(parentId) => void loadDirectory(parentId, true)}
        onOpenFile={(entry) => void openWorkspaceFileEntry(currentWorkspace, entry)}
        onRename={(target) => setNameDialog({ kind: "rename", selected: target })}
        onSelect={setSelected}
        onShowNativeMenu={(target) => void showNativeEntryMenu(target)}
        onToggleDirectory={(entry) => void toggleDirectory(entry)}
        onRetryDirectory={(entry) => void loadDirectory(entry.id, false, true, true)}
        onTrash={(target) => void requestTrash(target)}
      />

      {nameDialog ? (
        <WorkspaceFileNameDialog
          confirmLabel={nameDialog.kind === "create" ? "创建" : "重命名"}
          detail={dialogDetail(nameDialog, selected)}
          initialName={nameDialog.kind === "rename" ? nameDialog.selected.entry.name : ""}
          mode={dialogMode(nameDialog)}
          title={dialogTitle(nameDialog)}
          onDismiss={() => setNameDialog(undefined)}
          onConfirm={(name) => nameDialog.kind === "create"
            ? createFromSelection(nameDialog.entryKind, name)
            : renameSelected(nameDialog.selected, name)}
        />
      ) : null}
    </div>
  );

  async function loadDirectory(
    parentId: string | undefined,
    append: boolean,
    force = false,
    preserveEntries = false,
    includeGeneratedDirectories = includeGenerated
  ): Promise<void> {
    if (!workspaceId || !workspace) return;
    const key = parentId ?? ROOT_KEY;
    const current = directories[key];
    if (current?.loading && !force) return;
    const revision = directoryRevision.current;
    setDirectories((state) => ({
      ...state,
      [key]: {
        entries: append || preserveEntries ? state[key]?.entries ?? [] : [],
        ...((append || preserveEntries) && state[key]?.nextCursor ? { nextCursor: state[key].nextCursor } : {}),
        loading: true
      }
    }));
    try {
      await registerRendererWorkspaceWithHost(currentWorkspace, { queryCatalog: false });
      const page = await agentConnectionController.request(
        "workspace.file.list",
        {
          ...(parentId === undefined ? {} : { parentId }),
          ...(append && current?.nextCursor ? { cursor: current.nextCursor } : {}),
          limit: 200,
          includeGenerated: includeGeneratedDirectories
        },
        [],
        { context: { scope: "workspace", workspaceId } }
      );
      if (revision !== directoryRevision.current || page.workspaceId !== workspaceId) return;
      installPage(key, page, append);
    } catch (cause) {
      if (revision !== directoryRevision.current) return;
      const message = errorMessage(cause);
      setDirectories((state) => ({
        ...state,
        [key]: { entries: state[key]?.entries ?? [], loading: false, error: message }
      }));
      if (key === ROOT_KEY) setError(message);
    }
  }

  function installPage(key: string, page: WorkspaceFilePage, append: boolean): void {
    setDirectories((state) => ({
      ...state,
      [key]: {
        entries: append ? [...(state[key]?.entries ?? []), ...page.entries] : page.entries,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        loading: false
      }
    }));
  }

  async function toggleDirectory(entry: WorkspaceFileEntry): Promise<void> {
    if (expanded.has(entry.id)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
      return;
    }
    setExpanded((current) => new Set(current).add(entry.id));
    if (!directories[entry.id] || directories[entry.id]?.error) {
      await loadDirectory(entry.id, false, true, true);
    }
  }

  async function runSearch(searchQuery: string, includeDependencies: boolean): Promise<void> {
    if (!workspaceId || !workspace || !searchQuery) return;
    const revision = ++searchRevision.current;
    setSearching(true);
    setError(undefined);
    try {
      await registerRendererWorkspaceWithHost(currentWorkspace, { queryCatalog: false });
      const result = await agentConnectionController.request(
        "workspace.file.search",
        { query: searchQuery, includeGenerated: includeDependencies },
        [],
        { context: { scope: "workspace", workspaceId } }
      );
      if (revision === searchRevision.current && result.workspaceId === workspaceId) {
        setSearchResult(result);
        setSelected((current) => current && result.entries.some((entry) => entry.id === current.entry.id)
          ? current
          : undefined);
      }
    } catch (cause) {
      if (revision === searchRevision.current) setError(errorMessage(cause));
    } finally {
      if (revision === searchRevision.current) setSearching(false);
    }
  }

  async function refreshTree(includeGeneratedDirectories = includeGenerated): Promise<void> {
    setRefreshing(true);
    const revision = ++directoryRevision.current;
    setError(undefined);
    try {
      await Promise.all([
        loadDirectory(undefined, false, true, true, includeGeneratedDirectories),
        ...[...expanded].map((parentId) => loadDirectory(
          parentId,
          false,
          true,
          true,
          includeGeneratedDirectories
        ))
      ]);
      if (query.trim() && searchResult) await runSearch(query.trim(), includeGeneratedDirectories);
    } finally {
      if (revision === directoryRevision.current) setRefreshing(false);
    }
  }

  async function createFromSelection(kind: "file" | "directory", name: string) {
    const parentId = await creationParentId(currentWorkspace, selected);
    const result = await createWorkspaceEntry(currentWorkspace, parentId, name, kind);
    if (!result.ok) return result;
    directoryRevision.current += 1;
    if (parentId) {
      setExpanded((current) => new Set(current).add(parentId));
      await loadDirectory(parentId, false, true);
    } else {
      await loadDirectory(undefined, false, true);
    }
    setSelected({ entry: result.value, ...(parentId === undefined ? {} : { parentId }) });
    if (query.trim() && searchResult) await runSearch(query.trim(), includeGenerated);
    return result;
  }

  async function renameSelected(target: WorkspaceFileSelection, name: string) {
    const result = await renameWorkspaceEntry(currentWorkspace, target.entry, name);
    if (!result.ok) return result;
    directoryRevision.current += 1;
    await loadDirectory(target.parentId, false, true);
    setSelected({ entry: result.value, ...(target.parentId === undefined ? {} : { parentId: target.parentId }) });
    if (query.trim() && searchResult) await runSearch(query.trim(), includeGenerated);
    return result;
  }

  async function requestTrash(target: WorkspaceFileSelection): Promise<void> {
    const directory = target.entry.kind === "directory";
    if (workspaceHasDirtyPath(currentWorkspace.id, target.entry.relativePath, directory)) {
      publishNotification({
        level: "warning",
        title: "文件包含未保存修改",
        message: "请先保存或关闭相关文件标签，再移到废纸篓。"
      });
      return;
    }
    if (!await trashWorkspaceEntry(currentWorkspace, target.entry)) return;
    setSelected(undefined);
    directoryRevision.current += 1;
    await loadDirectory(target.parentId, false, true);
    if (query.trim() && searchResult) await runSearch(query.trim(), includeGenerated);
  }

  async function executeEntryAction(entry: WorkspaceFileEntry, action: WorkspaceEntryContextAction): Promise<void> {
    await executeWorkspaceEntryAction(currentWorkspace, entry, action);
  }

  async function showNativeEntryMenu(target: WorkspaceFileSelection): Promise<void> {
    const action = await showWorkspaceEntryMenu(currentWorkspace, target.entry, { includeManagement: true });
    if (!action) return;
    if (action === "rename") {
      setNameDialog({ kind: "rename", selected: target });
      return;
    }
    if (action === "trash") {
      await requestTrash(target);
      return;
    }
    await executeEntryAction(target.entry, action);
  }
}

function creationParentId(
  workspace: WorkspaceDescriptor,
  selected: WorkspaceFileSelection | undefined
): Promise<string | undefined> {
  if (!selected) return Promise.resolve(undefined);
  if (selected.entry.kind === "directory") return Promise.resolve(selected.entry.id);
  if (selected.parentId !== undefined) return Promise.resolve(selected.parentId);
  const parentPath = parentRelativePath(selected.entry.relativePath);
  if (!parentPath) return Promise.resolve(undefined);
  return resolveDirectoryId(workspace, parentPath);
}

async function resolveDirectoryId(workspace: WorkspaceDescriptor, relativePath: string): Promise<string> {
  await registerRendererWorkspaceWithHost(workspace, { queryCatalog: false });
  const result = await agentConnectionController.request(
    "workspace.file.resolve",
    { relativePath },
    [],
    { context: { scope: "workspace", workspaceId: workspace.id } }
  );
  if (result.entry.kind !== "directory") throw new Error("创建位置不是目录。");
  return result.entry.id;
}

function selectedFilesWorkspaceState(state: import("../workbench/workbench-store.js").RendererWorkbenchState) {
  const task = selectedWorkbenchTask(state);
  const workspaceId = task?.workspaceId
    ?? (state.selectedSurface?.kind === "workspace" ? state.selectedSurface.workspaceId : undefined)
    ?? state.currentWorkspaceId;
  return workspaceId ? state.workspaces[workspaceId] : undefined;
}

function parentRelativePath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function dialogTitle(dialog: NameDialogState): string {
  if (dialog.kind === "rename") return `重命名“${dialog.selected.entry.name}”`;
  return dialog.entryKind === "file" ? "新建文件" : "新建文件夹";
}

function dialogMode(dialog: NameDialogState) {
  if (dialog.kind === "create") return dialog.entryKind === "file" ? "create-file" as const : "create-directory" as const;
  return dialog.selected.entry.kind === "file" ? "rename-file" as const : "rename-directory" as const;
}

function dialogDetail(dialog: NameDialogState, selected: WorkspaceFileSelection | undefined): string {
  if (dialog.kind === "rename") return `位置：${parentRelativePath(dialog.selected.entry.relativePath) || "工作区根目录"}`;
  if (!selected) return "位置：工作区根目录";
  return selected.entry.kind === "directory"
    ? `位置：${selected.entry.relativePath}`
    : `位置：${parentRelativePath(selected.entry.relativePath) || "工作区根目录"}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "无法读取工作区文件。";
}
