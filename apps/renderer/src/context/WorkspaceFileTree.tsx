import type { WorkspaceEntryContextAction, WorkspaceFileEntry } from "@pi67/domain";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Trash2
} from "lucide-react";
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import type { KeyboardEvent, ReactNode } from "react";

export interface WorkspaceDirectoryProjection {
  entries: WorkspaceFileEntry[];
  nextCursor?: string;
  loading: boolean;
  error?: string;
}

export interface WorkspaceFileSelection {
  entry: WorkspaceFileEntry;
  parentId?: string;
}

export function WorkspaceFileTree({
  entries,
  searchMode,
  rootLoaded,
  rootNextCursor,
  rootLoading,
  directories,
  expanded,
  selected,
  onSelect,
  onToggleDirectory,
  onRetryDirectory,
  onOpenFile,
  onShowNativeMenu,
  onEntryAction,
  onRename,
  onTrash,
  onLoadMore
}: {
  entries: WorkspaceFileEntry[];
  searchMode: boolean;
  rootLoaded: boolean;
  rootNextCursor?: string;
  rootLoading: boolean;
  directories: Record<string, WorkspaceDirectoryProjection>;
  expanded: ReadonlySet<string>;
  selected?: WorkspaceFileSelection;
  onSelect: (target: WorkspaceFileSelection) => void;
  onToggleDirectory: (entry: WorkspaceFileEntry) => void;
  onRetryDirectory: (entry: WorkspaceFileEntry) => void;
  onOpenFile: (entry: WorkspaceFileEntry) => void;
  onShowNativeMenu: (target: WorkspaceFileSelection) => void;
  onEntryAction: (entry: WorkspaceFileEntry, action: WorkspaceEntryContextAction) => void;
  onRename: (target: WorkspaceFileSelection) => void;
  onTrash: (target: WorkspaceFileSelection) => void;
  onLoadMore: (parentId?: string) => void;
}) {
  return (
    <div aria-label={searchMode ? "工作区文件搜索结果" : "工作区文件"} className="inspector-file-tree" role="tree">
      {!rootLoaded && !searchMode ? (
        <div className="inspector-loading" role="status"><LoaderCircle className="spin" size={16} />正在读取工作区</div>
      ) : entries.length === 0 ? (
        <p className="context-empty">{searchMode ? "没有匹配的文件。" : "工作区中没有可显示的文件。"}</p>
      ) : entries.map((entry) => renderEntry(entry, 0, undefined, searchMode))}
      {!searchMode && rootNextCursor ? (
        <button className="inspector-load-more" disabled={rootLoading} onClick={() => onLoadMore()} type="button">
          {rootLoading ? "正在加载" : "加载更多"}
        </button>
      ) : null}
    </div>
  );

  function renderEntry(
    entry: WorkspaceFileEntry,
    depth: number,
    parentId: string | undefined,
    resultMode: boolean
  ): ReactNode {
    const directory = entry.kind === "directory";
    const blocked = entry.relativePath === ".git" || entry.relativePath.startsWith(".git/");
    const available = (entry.kind === "file" || directory) && !blocked;
    const open = expanded.has(entry.id);
    const childProjection = directories[entry.id];
    const target: WorkspaceFileSelection = { entry, ...(parentId === undefined ? {} : { parentId }) };
    const isSelected = selected?.entry.id === entry.id;
    const metadata = entry.kind === "file" && entry.byteLength !== undefined ? formatBytes(entry.byteLength) : undefined;
    return (
      <div className="inspector-file-branch" key={`${resultMode ? "search" : "tree"}-${entry.id}`}>
        <div
          aria-disabled={!available || undefined}
          aria-expanded={directory ? open : undefined}
          aria-label={entryLabel(entry, metadata, resultMode)}
          aria-level={depth + 1}
          aria-selected={isSelected}
          className={`inspector-file-row-shell ${isSelected ? "is-selected" : ""} ${resultMode ? "is-search-result" : ""}`}
          data-workspace-tree-row="true"
          role="treeitem"
          tabIndex={isSelected || (selected === undefined && depth === 0 && entries[0]?.id === entry.id) ? 0 : -1}
          title={entry.relativePath}
          onClick={() => activate(target, available, directory)}
          onContextMenu={(event) => {
            if (!available) return;
            event.preventDefault();
            onSelect(target);
            onShowNativeMenu(target);
          }}
          onFocus={() => onSelect(target)}
          onKeyDown={(event) => handleRowKeyDown(event, target, available, directory, open)}
        >
          <div className="inspector-file-row" style={{ paddingLeft: `${8 + Math.min(depth, 10) * 14}px` }}>
            <span className="inspector-file-chevron">
              {directory && !blocked ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
            </span>
            {directory ? <Folder aria-hidden="true" size={14} /> : <File aria-hidden="true" size={14} />}
            <span className="inspector-file-labels">
              <span className="inspector-file-name">{entry.name}</span>
              {resultMode ? <small className="inspector-file-path">{entry.relativePath}</small> : null}
            </span>
            {metadata ? <small className="inspector-file-size">{metadata}</small> : null}
          </div>
          {available ? (
            <div
              className="inspector-file-more-slot"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <MenuTrigger>
                <Button aria-label={`${entry.name} 更多操作`} className="inspector-file-more"><MoreHorizontal size={14} /></Button>
                <Popover className="inspector-file-menu-popover" placement="bottom end" offset={4}>
                  <Menu aria-label={`${entry.name} 文件管理`} className="inspector-file-menu">
                    {entry.kind === "file" ? (
                      <MenuItem onAction={() => onEntryAction(entry, "pi67-open")}><FileText size={13} />在 Pi-67 中打开</MenuItem>
                    ) : null}
                    <MenuItem onAction={() => onEntryAction(entry, "open-default")}><ExternalLink size={13} />使用系统默认应用打开</MenuItem>
                    <MenuItem onAction={() => onEntryAction(entry, "copy-relative")}><Copy size={13} />复制相对路径</MenuItem>
                    <MenuItem onAction={() => onEntryAction(entry, "copy-absolute")}><Copy size={13} />复制绝对路径</MenuItem>
                    <MenuItem onAction={() => onEntryAction(entry, "reveal")}><FolderOpen size={13} />在系统文件管理器中显示</MenuItem>
                    <MenuItem onAction={() => onRename(target)}><Pencil size={13} />重命名</MenuItem>
                    <MenuItem className="is-danger" onAction={() => onTrash(target)}><Trash2 size={13} />移到废纸篓</MenuItem>
                  </Menu>
                </Popover>
              </MenuTrigger>
            </div>
          ) : null}
        </div>
        {open ? (
          <div role="group">
            {childProjection?.loading && childProjection.entries.length === 0 ? (
              <div className="inspector-tree-status" style={{ paddingLeft: `${30 + depth * 14}px` }}>
                <LoaderCircle className="spin" size={12} />正在加载
              </div>
            ) : childProjection?.error ? (
              <div className="inspector-tree-status is-error" style={{ paddingLeft: `${30 + depth * 14}px` }}>
                <span>{childProjection.error}</span>
                <button type="button" onClick={() => onRetryDirectory(entry)}>重试</button>
              </div>
            ) : childProjection?.entries.length ? (
              childProjection.entries.map((child) => renderEntry(child, depth + 1, entry.id, false))
            ) : <div className="inspector-tree-status" style={{ paddingLeft: `${30 + depth * 14}px` }}>空目录</div>}
            {childProjection?.nextCursor ? (
              <button
                className="inspector-load-more"
                disabled={childProjection.loading}
                onClick={() => onLoadMore(entry.id)}
                type="button"
              >{childProjection.loading ? "正在加载" : "加载更多"}</button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  function activate(target: WorkspaceFileSelection, available: boolean, directory: boolean): void {
    if (!available) return;
    onSelect(target);
    if (directory) onToggleDirectory(target.entry);
    else onOpenFile(target.entry);
  }

  function handleRowKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    target: WorkspaceFileSelection,
    available: boolean,
    directory: boolean,
    open: boolean
  ): void {
    if (!available) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(target, available, directory);
    } else if (directory && event.key === "ArrowRight" && !open) {
      event.preventDefault();
      onSelect(target);
      onToggleDirectory(target.entry);
    } else if (directory && event.key === "ArrowRight" && open) {
      event.preventDefault();
      focusFirstChildTreeItem(event.currentTarget);
    } else if (directory && event.key === "ArrowLeft" && open) {
      event.preventDefault();
      onSelect(target);
      onToggleDirectory(target.entry);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusParentTreeItem(event.currentTarget);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusAdjacentTreeItem(event.currentTarget, event.key);
    }
  }
}

function focusFirstChildTreeItem(current: HTMLElement): void {
  const items = availableTreeItems(current);
  const currentIndex = items.indexOf(current);
  const currentLevel = treeItemLevel(current);
  const child = currentIndex < 0 ? undefined : items[currentIndex + 1];
  if (child && treeItemLevel(child) === currentLevel + 1) child.focus();
}

function focusParentTreeItem(current: HTMLElement): void {
  const items = availableTreeItems(current);
  const currentIndex = items.indexOf(current);
  const currentLevel = treeItemLevel(current);
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    if (treeItemLevel(items[index]!) < currentLevel) {
      items[index]!.focus();
      return;
    }
  }
}

function focusAdjacentTreeItem(current: HTMLElement, key: string): void {
  const items = availableTreeItems(current);
  const currentIndex = items.indexOf(current);
  const nextIndex = key === "Home"
    ? 0
    : key === "End"
      ? items.length - 1
      : Math.max(0, Math.min(items.length - 1, currentIndex + (key === "ArrowDown" ? 1 : -1)));
  items[nextIndex]?.focus();
}

function availableTreeItems(current: HTMLElement): HTMLElement[] {
  const tree = current.closest('[role="tree"]');
  return tree ? [...tree.querySelectorAll<HTMLElement>('[data-workspace-tree-row="true"]')]
    .filter((item) => item.getAttribute("aria-disabled") !== "true") : [];
}

function treeItemLevel(item: HTMLElement): number {
  return Number.parseInt(item.getAttribute("aria-level") ?? "0", 10);
}

function entryLabel(entry: WorkspaceFileEntry, metadata: string | undefined, resultMode: boolean): string {
  return [
    entry.kind === "directory" ? "文件夹" : "文件",
    entry.name,
    resultMode ? entry.relativePath : undefined,
    metadata
  ].filter(Boolean).join(" ");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
