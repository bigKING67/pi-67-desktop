import type {
  WorkspaceDescriptor,
  WorkspaceFileEntry,
  WorkspaceFilePage,
  WorkspaceFileSearchResult
} from "@pi67/domain";
import {
  ChevronDown,
  ChevronRight,
  File,
  FilePlus2,
  Folder,
  FolderPlus,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2
} from "lucide-react";
import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover
} from "react-aria-components";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import { selectedWorkbenchTask, useWorkbenchStore } from "../workbench/workbench-store.js";
import { registerRendererWorkspaceWithHost } from "../workbench/workspace-host-registration-controller.js";
import {
  createWorkspaceEntry,
  renameWorkspaceEntry,
  revealWorkspaceEntry,
  showWorkspaceEntryMenu,
  trashWorkspaceEntry
} from "../workspace-files/workspace-file-controller.js";
import { workspaceHasDirtyPath } from "../workspace-files/workspace-file-store.js";
import { WorkspaceFileNameDialog } from "../workspace-files/WorkspaceFileNameDialog.js";

interface DirectoryProjection {
  entries: WorkspaceFileEntry[];
  nextCursor?: string;
  loading: boolean;
  error?: string;
}

interface SelectedEntry {
  entry: WorkspaceFileEntry;
  parentId?: string;
}

type NameDialogState =
  | { kind: "create"; entryKind: "file" | "directory" }
  | { kind: "rename"; selected: SelectedEntry };

const ROOT_KEY = "__workspace_root__";
export function FilesPanel() {
  const workspace = useWorkbenchStore(selectedFilesWorkspaceState);
  const workspaceId = workspace?.id;
  const [directories, setDirectories] = useState<Record<string, DirectoryProjection>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<SelectedEntry>();
  const [query, setQuery] = useState("");
  const [includeGenerated, setIncludeGenerated] = useState(false);
  const [searchResult, setSearchResult] = useState<WorkspaceFileSearchResult>();
  const [searching, setSearching] = useState(false);
  const [nameDialog, setNameDialog] = useState<NameDialogState>();
  const [error, setError] = useState<string>();
  const requestRevision = useRef(0);
  const activeWorkspaceId = useRef<string | undefined>(undefined);
  const treeScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!workspaceId || activeWorkspaceId.current === workspaceId) return;
    activeWorkspaceId.current = workspaceId;
    requestRevision.current += 1;
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

  if (!workspaceId || !workspace) return <ContextEmpty text="先选择一个工作区，再浏览文件。" />;
  const currentWorkspace = workspace;

  return (
    <div className="inspector-files">
      <form className="inspector-search" onSubmit={submitSearch}>
        <Search aria-hidden="true" size={14} />
        <input
          aria-label="搜索工作区文件"
          maxLength={256}
          placeholder="搜索文件名或路径"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!event.target.value.trim()) setSearchResult(undefined);
          }}
        />
        <button disabled={searching || !query.trim()} type="submit">
          {searching ? <LoaderCircle aria-label="搜索中" className="spin" size={13} /> : "搜索"}
        </button>
      </form>
      <div className="inspector-files-toolbar">
        <label title="搜索时包含依赖与生成目录">
          <input
            checked={includeGenerated}
            type="checkbox"
            onChange={(event) => setIncludeGenerated(event.target.checked)}
          />
          包含生成目录
        </label>
        <div>
          <button aria-label="新建文件" title="新建文件" type="button" onClick={() => setNameDialog({ kind: "create", entryKind: "file" })}>
            <FilePlus2 size={14} />
          </button>
          <button aria-label="新建文件夹" title="新建文件夹" type="button" onClick={() => setNameDialog({ kind: "create", entryKind: "directory" })}>
            <FolderPlus size={14} />
          </button>
          <button aria-label="刷新文件" title="刷新文件" type="button" onClick={() => void refreshTree()}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      {searchResult ? (
        <p className="inspector-result-summary">
          {searchResult.entries.length} 项结果{searchResult.truncated ? " · 已达搜索上限" : ""}
        </p>
      ) : null}
      {error ? <p className="inspector-error" role="alert">{error}</p> : null}
      <div className="inspector-file-tree" ref={treeScrollRef}>
        {!root && !searchResult ? (
          <div className="inspector-loading" role="status"><LoaderCircle className="spin" size={16} />正在读取工作区</div>
        ) : visibleEntries.length === 0 ? (
          <ContextEmpty text={searchResult ? "没有匹配的文件。" : "工作区中没有可显示的文件。"} />
        ) : searchResult ? (
          visibleEntries.map((entry) => renderEntry(entry, 0, undefined, true))
        ) : (
          visibleEntries.map((entry) => renderEntry(entry, 0, undefined, false))
        )}
        {!searchResult && root?.nextCursor ? (
          <button
            className="inspector-load-more"
            disabled={root.loading}
            onClick={() => void loadDirectory(undefined, true)}
            type="button"
          >{root.loading ? "正在加载" : "加载更多"}</button>
        ) : null}
      </div>

      {nameDialog ? (
        <WorkspaceFileNameDialog
          confirmLabel={nameDialog.kind === "create" ? "创建" : "重命名"}
          detail={dialogDetail(nameDialog, selected)}
          initialName={nameDialog.kind === "rename" ? nameDialog.selected.entry.name : ""}
          title={dialogTitle(nameDialog)}
          onDismiss={() => setNameDialog(undefined)}
          onConfirm={(name) => nameDialog.kind === "create"
            ? createFromSelection(nameDialog.entryKind, name)
            : renameSelected(nameDialog.selected, name)}
        />
      ) : null}
    </div>
  );

  function renderEntry(
    entry: WorkspaceFileEntry,
    depth: number,
    parentId: string | undefined,
    searchMode: boolean
  ): ReactNode {
    const directory = entry.kind === "directory";
    const blocked = entry.relativePath === ".git" || entry.relativePath.startsWith(".git/");
    const available = (entry.kind === "file" || directory) && !blocked;
    const open = expanded.has(entry.id);
    const childProjection = directories[entry.id];
    const isSelected = selected?.entry.id === entry.id;
    return (
      <div className="inspector-file-branch" key={`${searchMode ? "search" : "tree"}-${entry.id}`}>
        <div className={`inspector-file-row-shell ${isSelected ? "is-selected" : ""}`}>
          <button
            className="inspector-file-row"
            disabled={!available}
            style={{ paddingLeft: `${8 + Math.min(depth, 10) * 14}px` }}
            title={entry.relativePath}
            type="button"
            onClick={() => {
              setSelected({ entry, ...(parentId === undefined ? {} : { parentId }) });
              if (directory) void toggleDirectory(entry);
              else void revealWorkspaceEntry(currentWorkspace, entry);
            }}
            onContextMenu={(event) => {
              if (!available) return;
              event.preventDefault();
              setSelected({ entry, ...(parentId === undefined ? {} : { parentId }) });
              void showWorkspaceEntryMenu(currentWorkspace, entry);
            }}
          >
            <span className="inspector-file-chevron">
              {directory && !blocked ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
            </span>
            {directory ? <Folder aria-hidden="true" size={14} /> : <File aria-hidden="true" size={14} />}
            <span className="inspector-file-name">{entry.name}</span>
            {entry.kind === "file" && entry.byteLength !== undefined ? <small>{formatBytes(entry.byteLength)}</small> : null}
          </button>
          {available ? (
            <MenuTrigger>
              <Button aria-label={`${entry.name} 更多操作`} className="inspector-file-more"><MoreHorizontal size={14} /></Button>
              <Popover className="inspector-file-menu-popover" placement="bottom end" offset={4}>
                <Menu aria-label={`${entry.name} 文件管理`} className="inspector-file-menu">
                  <MenuItem onAction={() => setNameDialog({ kind: "rename", selected: { entry, ...(parentId === undefined ? {} : { parentId }) } })}>
                    <Pencil size={13} />重命名
                  </MenuItem>
                  <MenuItem className="is-danger" onAction={() => void requestTrash({ entry, ...(parentId === undefined ? {} : { parentId }) })}>
                    <Trash2 size={13} />移到废纸篓
                  </MenuItem>
                </Menu>
              </Popover>
            </MenuTrigger>
          ) : null}
        </div>
        {open ? (
          <div>
            {childProjection?.loading && childProjection.entries.length === 0 ? (
              <div className="inspector-tree-status" style={{ paddingLeft: `${30 + depth * 14}px` }}>
                <LoaderCircle className="spin" size={12} />正在加载
              </div>
            ) : childProjection?.error ? (
              <div className="inspector-tree-status is-error" style={{ paddingLeft: `${30 + depth * 14}px` }}>{childProjection.error}</div>
            ) : childProjection?.entries.length ? (
              childProjection.entries.map((child) => renderEntry(child, depth + 1, entry.id, false))
            ) : <div className="inspector-tree-status" style={{ paddingLeft: `${30 + depth * 14}px` }}>空目录</div>}
            {childProjection?.nextCursor ? (
              <button
                className="inspector-load-more"
                disabled={childProjection.loading}
                onClick={() => void loadDirectory(entry.id, true)}
                type="button"
              >加载更多</button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  async function loadDirectory(
    parentId: string | undefined,
    append: boolean,
    force = false
  ): Promise<void> {
    if (!workspaceId || !workspace) return;
    const key = parentId ?? ROOT_KEY;
    const current = directories[key];
    if (current?.loading && !force) return;
    const revision = requestRevision.current;
    setDirectories((state) => ({
      ...state,
      [key]: {
        entries: append ? state[key]?.entries ?? [] : [],
        ...(append && state[key]?.nextCursor ? { nextCursor: state[key].nextCursor } : {}),
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
          limit: 200
        },
        [],
        { context: { scope: "workspace", workspaceId } }
      );
      if (revision !== requestRevision.current || page.workspaceId !== workspaceId) return;
      installPage(key, page, append);
    } catch (cause) {
      if (revision !== requestRevision.current) return;
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
    if (!directories[entry.id]) await loadDirectory(entry.id, false);
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!workspaceId || !workspace || !query.trim() || searching) return;
    setSearching(true);
    setError(undefined);
    const revision = requestRevision.current;
    try {
      await registerRendererWorkspaceWithHost(currentWorkspace, { queryCatalog: false });
      const result = await agentConnectionController.request(
        "workspace.file.search",
        { query: query.trim(), includeGenerated },
        [],
        { context: { scope: "workspace", workspaceId } }
      );
      if (revision === requestRevision.current) setSearchResult(result);
    } catch (cause) {
      if (revision === requestRevision.current) setError(errorMessage(cause));
    } finally {
      if (revision === requestRevision.current) setSearching(false);
    }
  }

  async function refreshTree(): Promise<void> {
    requestRevision.current += 1;
    setDirectories({});
    setExpanded(new Set());
    setSearchResult(undefined);
    setSelected(undefined);
    setError(undefined);
    await loadDirectory(undefined, false, true);
  }

  async function createFromSelection(kind: "file" | "directory", name: string): Promise<boolean> {
    const parentId = await creationParentId(currentWorkspace, selected);
    const created = await createWorkspaceEntry(currentWorkspace, parentId, name, kind);
    if (!created) return false;
    if (parentId) {
      setExpanded((current) => new Set(current).add(parentId));
      requestRevision.current += 1;
      await loadDirectory(parentId, false, true);
    } else {
      requestRevision.current += 1;
      await loadDirectory(undefined, false, true);
    }
    setSelected({ entry: created, ...(parentId === undefined ? {} : { parentId }) });
    return true;
  }

  async function renameSelected(target: SelectedEntry, name: string): Promise<boolean> {
    const renamed = await renameWorkspaceEntry(currentWorkspace, target.entry, name);
    if (!renamed) return false;
    requestRevision.current += 1;
    await loadDirectory(target.parentId, false, true);
    setSelected({ entry: renamed, ...(target.parentId === undefined ? {} : { parentId: target.parentId }) });
    return true;
  }

  async function requestTrash(target: SelectedEntry): Promise<void> {
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
    requestRevision.current += 1;
    await loadDirectory(target.parentId, false, true);
  }
}

function creationParentId(
  workspace: WorkspaceDescriptor,
  selected: SelectedEntry | undefined
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

function dialogDetail(dialog: NameDialogState, selected: SelectedEntry | undefined): string {
  if (dialog.kind === "rename") return "只修改名称，不移动到其他目录。";
  if (!selected) return "将在工作区根目录创建。";
  return selected.entry.kind === "directory"
    ? `将在 ${selected.entry.relativePath} 中创建。`
    : `将在 ${parentRelativePath(selected.entry.relativePath) || "工作区根目录"} 中创建。`;
}

function ContextEmpty({ text }: { text: string }) {
  return <p className="context-empty">{text}</p>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "无法读取工作区文件。";
}
