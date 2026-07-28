import {
  taskConsumesRunSlot,
  type WorkspaceDescriptor
} from "@pi67/domain";
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Ellipsis,
  FileInput,
  FolderSearch,
  LoaderCircle,
  Plus,
  RefreshCw,
  Square,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { messages } from "../localization/message-catalog.js";
import { importRendererSessionFile } from "../session/session-import-controller.js";
import { createRendererSession } from "../session/session-lifecycle-controller.js";
import { activateRendererTask } from "../workbench/task-activation-controller.js";
import { stopRendererTask } from "../workbench/task-stop-controller.js";
import {
  rendererWorkbenchStore,
  rendererConversationIdentity,
  useWorkbenchStore,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import {
  moveRendererWorkspace,
  repairAndOpenRendererWorkspace
} from "../workbench/workspace-registration-controller.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import styles from "./NavigationRail.module.css";
import {
  loadMoreSessionCatalog,
  queryFirstSessionCatalog
} from "./session-catalog-controller.js";
import {
  selectWorkspaceSessionCatalog,
  useSessionCatalogStore,
  type WorkspaceSessionCatalogState
} from "./session-catalog-store.js";
import {
  boundedRecent,
  conversationRows,
  statusLabel,
  workspaceStatus,
  type ConversationRowModel
} from "./workspace-conversation-model.js";

const RECENT_SESSION_LIMIT = 6;

export function WorkspaceConversationList({
  query,
  onRequestRemoval
}: {
  query: string;
  onRequestRemoval: (workspaceId: string) => void;
}) {
  const workspaces = useWorkbenchStore((state) => state.workspaces);
  const workspaceOrder = useWorkbenchStore((state) => state.workspaceOrder);
  const expandedWorkspaceIds = useWorkbenchStore((state) => state.expandedWorkspaceIds);
  const currentWorkspaceId = useWorkbenchStore((state) => state.currentWorkspaceId);
  const tasks = useWorkbenchStore((state) => state.tasks);
  const runtimeTaskOrder = useWorkbenchStore((state) => state.runtimeTaskOrder);
  const selectedSurface = useWorkbenchStore((state) => state.selectedSurface);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const catalogs = useSessionCatalogStore((state) => state.byWorkspace);
  const [showAllWorkspaceIds, setShowAllWorkspaceIds] = useState<Set<string>>(() => new Set());
  const selectedRow = useRef<HTMLElement | null>(null);
  const selectedConversation = selectedSurface?.kind === "conversation"
    ? selectedSurface.conversation
    : undefined;
  const selectedIdentity = selectedConversation ? rendererConversationIdentity(selectedConversation) : undefined;

  useEffect(() => {
    if (!selectedConversation) return;
    rendererWorkbenchStore.getState().setWorkspaceExpanded(selectedConversation.workspaceId, true);
  }, [selectedIdentity, selectedConversation]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => selectedRow.current?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [selectedIdentity, expandedWorkspaceIds]);

  if (workspaceOrder.length === 0) {
    return <p className={styles.empty}>还没有工作区。添加一个本地目录后，会话会按工作区显示在这里。</p>;
  }

  return (
    <div aria-label="工作区与会话" className={styles.workspaceConversationList} role="list">
      {workspaceOrder.map((workspaceId, index) => {
        const workspace = workspaces[workspaceId];
        if (!workspace) return null;
        const expanded = Boolean(query) || expandedWorkspaceIds.includes(workspaceId);
        const workspaceTasks = runtimeTaskOrder.flatMap((taskId) => {
          const task = tasks[taskId];
          return task?.workspaceId === workspaceId ? [task] : [];
        });
        const catalog = catalogs[workspaceId] ?? selectWorkspaceSessionCatalog(
          useSessionCatalogStore.getState(),
          workspaceId
        );
        return (
          <WorkspaceConversationGroup
            catalog={catalog}
            current={workspaceId === currentWorkspaceId}
            expanded={expanded}
            index={index}
            key={workspaceId}
            onRequestRemoval={onRequestRemoval}
            query={query}
            sessionTransitionPending={sessionTransitionPending}
            selectedIdentity={selectedIdentity}
            selectedRow={selectedRow}
            showAll={showAllWorkspaceIds.has(workspaceId)}
            tasks={workspaceTasks}
            workspace={workspace}
            workspaceCount={workspaceOrder.length}
            onShowAll={() => setShowAllWorkspaceIds((current) => {
              const next = new Set(current);
              if (next.has(workspaceId)) next.delete(workspaceId);
              else next.add(workspaceId);
              return next;
            })}
          />
        );
      })}
    </div>
  );
}

function WorkspaceConversationGroup({
  workspace,
  tasks,
  catalog,
  query,
  sessionTransitionPending,
  expanded,
  current,
  showAll,
  selectedIdentity,
  selectedRow,
  index,
  workspaceCount,
  onShowAll,
  onRequestRemoval
}: {
  workspace: WorkspaceDescriptor;
  tasks: RendererWorkbenchTask[];
  catalog: WorkspaceSessionCatalogState;
  query: string;
  sessionTransitionPending: boolean;
  expanded: boolean;
  current: boolean;
  showAll: boolean;
  selectedIdentity: string | undefined;
  selectedRow: MutableRefObject<HTMLElement | null>;
  index: number;
  workspaceCount: number;
  onShowAll: () => void;
  onRequestRemoval: (workspaceId: string) => void;
}) {
  const backgroundCount = tasks.filter((task) => taskConsumesRunSlot(task.lifecycle)).length;
  const rows = useMemo(
    () => conversationRows(workspace.id, tasks, catalog.items, query),
    [catalog.items, query, tasks, workspace.id]
  );
  const priority = rows.filter((row) => row.priority);
  const recent = rows.filter((row) => !row.priority);
  const visibleRecent = showAll ? recent : boundedRecent(recent, selectedIdentity, RECENT_SESSION_LIMIT);
  const canShowMore = recent.length > RECENT_SESSION_LIMIT || catalog.hasMore;
  const catalogUnavailable = catalog.catalogState === "unavailable";
  const catalogFallback = catalog.catalogState === "fallback" || catalog.source === "sdk-fallback";
  const catalogIncompleteEmpty = catalog.incomplete && rows.length === 0;

  return (
    <section
      aria-label={`工作区：${workspace.displayName}`}
      className={`${styles.workspaceGroup} ${current ? styles.currentGroup : ""}`}
      data-testid="workspace-group"
      data-workspace-id={workspace.id}
      role="listitem"
    >
      <header className={styles.workspaceGroupHeader}>
        <button
          aria-expanded={expanded}
          aria-label={`${expanded ? "折叠" : "展开"}工作区：${workspace.displayName}`}
          className={styles.workspaceDisclosure}
          disabled={Boolean(query)}
          onClick={() => rendererWorkbenchStore.getState().toggleWorkspaceExpanded(workspace.id)}
          title={query ? "清除搜索后可折叠工作区" : undefined}
          type="button"
        >
          {expanded ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}
        </button>
        <button
          className={styles.workspaceGroupName}
          onClick={() => rendererWorkbenchStore.getState().selectWorkspace(workspace.id)}
          title={workspace.identity.canonicalPath}
          type="button"
        >
          <span className={styles.workspaceGlyph} aria-hidden="true">{workspace.displayName.slice(0, 1).toUpperCase()}</span>
          <span><strong>{workspace.displayName}</strong><small>{workspaceStatus(workspace)}</small></span>
        </button>
        {!expanded && backgroundCount > 0 ? (
          <span className={styles.backgroundBadge} title={`${backgroundCount} 个后台任务`}>{backgroundCount}</span>
        ) : null}
        <button
          aria-label={`在 ${workspace.displayName} 新建会话`}
          className={styles.workspaceQuickAction}
          disabled={workspace.availability !== "available" || sessionTransitionPending}
          onClick={() => void createConversationInWorkspace(workspace)}
          title="新建会话"
          type="button"
        ><Plus aria-hidden="true" size={13} /></button>
        <WorkspaceMenu
          index={index}
          workspace={workspace}
          workspaceCount={workspaceCount}
          onRequestRemoval={onRequestRemoval}
        />
      </header>
      {expanded ? (
        <div className={styles.workspaceConversations}>
          {priority.map((row) => (
            <ConversationRow
              key={row.identity}
              row={row}
              selected={row.identity === selectedIdentity}
              selectedRow={selectedRow}
            />
          ))}
          {priority.length > 0 && visibleRecent.length > 0 ? <div className={styles.conversationDivider} /> : null}
          {visibleRecent.map((row) => (
            <ConversationRow
              key={row.identity}
              row={row}
              selected={row.identity === selectedIdentity}
              selectedRow={selectedRow}
            />
          ))}
          {catalog.rebuilding ? (
            <p aria-live="polite" className={styles.catalogNotice} role="status">
              {messages.navigation.catalogRebuilding}
            </p>
          ) : catalog.loading && rows.length === 0 ? (
            <p aria-live="polite" className={styles.workspaceEmpty} role="status">
              {messages.navigation.catalogLoading}
            </p>
          ) : null}
          {catalogFallback && !catalogUnavailable ? (
            <p className={styles.catalogNotice} role="status">{messages.navigation.catalogFallback}</p>
          ) : null}
          {catalog.incomplete ? (
            <p className={styles.catalogNotice} role="status">
              {catalog.skippedCount > 0
                ? messages.navigation.skippedSessions(catalog.skippedCount)
                : messages.navigation.catalogIncomplete}
            </p>
          ) : null}
          {catalogUnavailable ? (
            <p className={styles.workspaceCatalogError} role="alert">{messages.navigation.catalogRetry}</p>
          ) : null}
          {catalog.error ? (
            <p className={styles.workspaceCatalogError} role="alert">{catalog.error}</p>
          ) : null}
          {!catalog.loading
            && !catalog.rebuilding
            && !catalogUnavailable
            && !catalog.error
            && rows.length === 0 ? (
            <p className={styles.workspaceEmpty}>{catalogIncompleteEmpty
              ? messages.navigation.catalogIncompleteEmpty
              : "这个工作区还没有会话。"}</p>
          ) : null}
          {canShowMore ? (
            <button
              className={styles.showMoreButton}
              disabled={catalog.loadingMore}
              onClick={() => {
                onShowAll();
                if (!showAll && catalog.hasMore) void loadMoreSessionCatalog(workspace.id);
              }}
              type="button"
            >{catalog.loadingMore ? "正在加载…" : showAll ? "收起" : "显示更多"}</button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ConversationRow({
  row,
  selected,
  selectedRow
}: {
  row: ConversationRowModel;
  selected: boolean;
  selectedRow: MutableRefObject<HTMLElement | null>;
}) {
  const StatusIcon = row.status === "running" ? LoaderCircle : row.status === "waiting" ? Clock3 : Circle;
  const task = row.task;
  return (
    <div className={styles.conversationRow}>
      <button
        {...(selected ? { "aria-current": "page" as const } : {})}
        className={`${styles.conversationItem} ${selected ? styles.activeConversation : ""}`}
        data-conversation-id={row.identity}
        data-testid="conversation-row"
        onClick={() => void openConversation(row)}
        ref={(element) => {
          if (selected) selectedRow.current = element;
        }}
        type="button"
      >
        <span className={styles.conversationMarker} data-status={row.status ?? "idle"}>
          <StatusIcon aria-hidden="true" className={row.status === "running" ? styles.spinning : undefined} size={11} />
        </span>
        <span className={styles.conversationCopy}>
          <strong>{row.title}</strong>
          <small>{row.meta}</small>
        </span>
        {row.status ? <span className={styles.conversationState}>{statusLabel(row.status)}</span> : null}
      </button>
      {task && task.runtime.phase !== "stopped" ? (
        <MenuTrigger>
          <Button className={styles.conversationMenuButton!} aria-label={`${row.title} 会话菜单`}>
            <Ellipsis aria-hidden="true" size={13} />
          </Button>
          <Popover className={styles.menuPopover!} placement="bottom end" offset={4}>
            <Menu aria-label={`${row.title} 会话菜单`} className={styles.menu!}>
              <MenuItem
                className={`${styles.menuItem} ${styles.dangerMenuItem}`}
                onAction={() => void stopRendererTask(task.id)}
                textValue="停止任务"
              ><Square aria-hidden="true" size={12} />停止任务</MenuItem>
            </Menu>
          </Popover>
        </MenuTrigger>
      ) : null}
    </div>
  );
}

function WorkspaceMenu({
  workspace,
  index,
  workspaceCount,
  onRequestRemoval
}: {
  workspace: WorkspaceDescriptor;
  index: number;
  workspaceCount: number;
  onRequestRemoval: (workspaceId: string) => void;
}) {
  return (
    <MenuTrigger>
      <Button className={styles.workspaceQuickAction!} aria-label={`${workspace.displayName} 工作区菜单`}>
        <Ellipsis aria-hidden="true" size={14} />
      </Button>
      <Popover className={styles.menuPopover!} placement="bottom end" offset={5}>
        <Menu className={styles.menu!} aria-label={`${workspace.displayName} 工作区菜单`}>
          <MenuItem className={styles.menuItem!} onAction={() => void refreshWorkspace(workspace)} textValue="刷新会话">
            <RefreshCw aria-hidden="true" size={14} />刷新会话
          </MenuItem>
          <MenuItem className={styles.menuItem!} onAction={() => void importIntoWorkspace(workspace)} textValue="导入 Pi Session">
            <FileInput aria-hidden="true" size={14} />导入 Pi Session
          </MenuItem>
          {workspace.availability !== "available" ? (
            <MenuItem className={styles.menuItem!} onAction={() => void repairAndOpenRendererWorkspace(workspace.id)} textValue="重新选择目录">
              <FolderSearch aria-hidden="true" size={14} />重新选择目录
            </MenuItem>
          ) : null}
          <MenuItem className={styles.menuItem!} isDisabled={index === 0} onAction={() => void moveRendererWorkspace(workspace.id, "up")} textValue="上移工作区">上移工作区</MenuItem>
          <MenuItem className={styles.menuItem!} isDisabled={index === workspaceCount - 1} onAction={() => void moveRendererWorkspace(workspace.id, "down")} textValue="下移工作区">下移工作区</MenuItem>
          <MenuItem className={`${styles.menuItem} ${styles.dangerMenuItem}`} onAction={() => onRequestRemoval(workspace.id)} textValue="移除工作区">
            <Trash2 aria-hidden="true" size={14} />移除工作区
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

async function openConversation(row: ConversationRowModel): Promise<void> {
  if (row.task) {
    await activateRendererTask(row.task.id);
    return;
  }
  const workbench = rendererWorkbenchStore.getState();
  const workspace = workbench.workspaces[row.conversation.workspaceId];
  if (!workspace || row.conversation.kind !== "session") return;
  workbench.selectConversation(row.conversation);
  await openRendererWorkspaceDescriptor(workspace, row.conversation.sessionPath);
}

async function createConversationInWorkspace(workspace: WorkspaceDescriptor): Promise<void> {
  if (useAppStore.getState().sessionTransitionPending) return;
  if (useAppStore.getState().workspace !== workspace.identity.canonicalPath) {
    await openRendererWorkspaceDescriptor(workspace);
  } else {
    rendererWorkbenchStore.getState().selectWorkspace(workspace.id);
  }
  await createRendererSession();
}

async function refreshWorkspace(workspace: WorkspaceDescriptor): Promise<void> {
  await queryFirstSessionCatalog(workspace.id, { refresh: true });
}

async function importIntoWorkspace(workspace: WorkspaceDescriptor): Promise<void> {
  if (useAppStore.getState().workspace !== workspace.identity.canonicalPath) {
    await openRendererWorkspaceDescriptor(workspace);
  }
  await importRendererSessionFile();
}
