import {
  taskConsumesRunSlot,
  type WorkspaceDescriptor
} from "@pi67/domain";
import {
  ChevronDown,
  ChevronRight,
  Archive,
  Clock3,
  Ellipsis,
  FileInput,
  FolderSearch,
  Plus,
  RefreshCw,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { useAppStore } from "../app/app-store.js";
import { messages } from "../localization/message-catalog.js";
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
import { beginRendererSessionIntentInWorkspace } from "../workspace/workspace-session-controller.js";
import { ConversationRow } from "./ConversationRow.js";
import { ConversationContentResult } from "./ConversationContentResult.js";
import styles from "./NavigationRail.module.css";
import { useConversationDialogStore } from "./conversation-dialog-store.js";
import { useConversationSnoozeClock } from "./conversation-snooze-clock.js";
import { loadMoreSessionCatalog } from "./session-catalog-controller.js";
import {
  selectWorkspaceSessionCatalog,
  useSessionCatalogStore,
  type WorkspaceSessionCatalogState
} from "./session-catalog-store.js";
import {
  boundedRecent,
  conversationRows,
  workspaceStatus
} from "./workspace-conversation-model.js";
import type { NavigationMessageSearchWorkspaceState } from "./use-navigation-message-search.js";
import {
  importSessionIntoWorkspace,
  refreshWorkspaceConversations
} from "./workspace-conversation-actions.js";

const RECENT_SESSION_LIMIT = 6;

export function WorkspaceConversationList({
  messageSearchByWorkspace,
  query,
  onRequestRemoval
}: {
  messageSearchByWorkspace: Record<string, NavigationMessageSearchWorkspaceState>;
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
  const workspaceOpenPending = useAppStore((state) => state.workspaceOpenPending);
  const catalogs = useSessionCatalogStore((state) => state.byWorkspace);
  const snoozeClock = useConversationSnoozeClock();
  const [showAllWorkspaceIds, setShowAllWorkspaceIds] = useState<Set<string>>(() => new Set());
  const selectedRow = useRef<HTMLElement | null>(null);
  const selectedConversation = selectedSurface?.kind === "conversation"
    ? selectedSurface.conversation
    : undefined;
  const selectedIdentity = selectedConversation ? rendererConversationIdentity(selectedConversation) : undefined;

  const nextSnoozeExpiry = useMemo(() => {
    let next: number | undefined;
    for (const catalog of Object.values(catalogs)) {
      for (const item of catalog.items) {
        if (item.snoozedUntil === undefined || item.snoozedUntil <= snoozeClock.now) continue;
        next = next === undefined ? item.snoozedUntil : Math.min(next, item.snoozedUntil);
      }
    }
    return next;
  }, [catalogs, snoozeClock.now]);

  useEffect(() => {
    if (nextSnoozeExpiry === undefined) return;
    const delay = Math.min(2_147_000_000, Math.max(1, nextSnoozeExpiry - snoozeClock.now + 25));
    const timer = window.setTimeout(() => snoozeClock.refresh(), delay);
    return () => window.clearTimeout(timer);
  }, [nextSnoozeExpiry, snoozeClock]);

  useEffect(() => {
    if (!selectedConversation) return;
    rendererWorkbenchStore.getState().setWorkspaceExpanded(selectedConversation.workspaceId, true);
  }, [selectedIdentity, selectedConversation]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => selectedRow.current?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [selectedIdentity, expandedWorkspaceIds]);

  if (workspaceOrder.length === 0) {
    return <p className={styles.empty}>还没有工作区。添加一个本地目录后，对话会按工作区显示在这里。</p>;
  }

  return (
    <div aria-label="工作区与对话" className={styles.workspaceConversationList} role="list">
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
            messageSearch={messageSearchByWorkspace[workspaceId]}
            current={workspaceId === currentWorkspaceId}
            expanded={expanded}
            index={index}
            key={workspaceId}
            onRequestRemoval={onRequestRemoval}
            query={query}
            sessionTransitionPending={sessionTransitionPending}
            workspaceOpenPending={workspaceOpenPending}
            selectedIdentity={selectedIdentity}
            selectedRow={selectedRow}
            showAll={showAllWorkspaceIds.has(workspaceId)}
            tasks={workspaceTasks}
            now={snoozeClock.now}
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
  messageSearch,
  query,
  sessionTransitionPending,
  workspaceOpenPending,
  expanded,
  current,
  showAll,
  selectedIdentity,
  selectedRow,
  index,
  workspaceCount,
  now,
  onShowAll,
  onRequestRemoval
}: {
  workspace: WorkspaceDescriptor;
  tasks: RendererWorkbenchTask[];
  catalog: WorkspaceSessionCatalogState;
  messageSearch: NavigationMessageSearchWorkspaceState | undefined;
  query: string;
  sessionTransitionPending: boolean;
  workspaceOpenPending: boolean;
  expanded: boolean;
  current: boolean;
  showAll: boolean;
  selectedIdentity: string | undefined;
  selectedRow: MutableRefObject<HTMLElement | null>;
  index: number;
  workspaceCount: number;
  onShowAll: () => void;
  onRequestRemoval: (workspaceId: string) => void;
  now: number;
}) {
  const [showSnoozed, setShowSnoozed] = useState(false);
  const backgroundCount = tasks.filter((task) => taskConsumesRunSlot(task.lifecycle)).length;
  const rows = useMemo(
    () => conversationRows(workspace.id, tasks, catalog.items, query, now),
    [catalog.items, now, query, tasks, workspace.id]
  );
  const priority = rows.filter((row) => row.priority);
  const snoozed = rows.filter((row) => !row.priority && row.snoozed);
  const recent = rows.filter((row) => !row.priority && !row.snoozed);
  const snoozedOpen = Boolean(query) || showSnoozed;
  const visibleRecent = showAll ? recent : boundedRecent(recent, selectedIdentity, RECENT_SESSION_LIMIT);
  const canShowMore = recent.length > RECENT_SESSION_LIMIT || catalog.hasMore;
  const catalogUnavailable = catalog.catalogState === "unavailable";
  const catalogFallback = catalog.catalogState === "fallback";
  const catalogIncompleteEmpty = catalog.incomplete && rows.length === 0;
  const contentItems = messageSearch?.items ?? [];
  const hasVisibleResults = rows.length > 0 || contentItems.length > 0;

  return (
    <section
      aria-label={`工作区：${workspace.displayName}`}
      className={`${styles.workspaceGroup} ${current ? styles.currentGroup : ""}`}
      data-testid="workspace-group"
      data-workspace-id={workspace.id}
      data-catalog-state={catalog.catalogState ?? "uninitialized"}
      data-catalog-source={catalog.source ?? "uninitialized"}
      data-catalog-rebuilding={catalog.rebuilding ? "true" : "false"}
      data-catalog-revision={catalog.revision ?? "uninitialized"}
      data-catalog-item-count={catalog.itemCount}
      data-catalog-visible-count={rows.length}
      data-content-search-visible-count={contentItems.length}
      data-catalog-incomplete={catalog.incomplete ? "true" : "false"}
      data-catalog-loading={catalog.loading ? "true" : "false"}
      data-catalog-error={catalog.error ? "true" : "false"}
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
          aria-label={`在 ${workspace.displayName} 新建对话`}
          className={styles.workspaceQuickAction}
          disabled={workspace.availability !== "available" || sessionTransitionPending || workspaceOpenPending}
          onClick={() => void beginRendererSessionIntentInWorkspace(workspace)}
          title="新建对话"
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
          {query && rows.length > 0 ? <p className={styles.searchResultGroupLabel}>对话</p> : null}
          {priority.map((row) => (
            <ConversationRow
              disabled={sessionTransitionPending || workspaceOpenPending}
              key={row.identity}
              row={row}
              selected={row.identity === selectedIdentity}
              selectedRow={selectedRow}
            />
          ))}
          {snoozed.length > 0 ? (
            <div className={styles.snoozedShelf}>
              <button
                aria-expanded={snoozedOpen}
                className={styles.snoozedShelfButton}
                onClick={() => setShowSnoozed((current) => !current)}
                type="button"
              >
                {snoozedOpen
                  ? <ChevronDown aria-hidden="true" size={12} />
                  : <ChevronRight aria-hidden="true" size={12} />}
                <Clock3 aria-hidden="true" size={12} />
                <span>稍后</span>
                <small>{snoozed.length}</small>
              </button>
              {snoozedOpen ? snoozed.map((row) => (
                <ConversationRow
                  disabled={sessionTransitionPending || workspaceOpenPending}
                  key={row.identity}
                  row={row}
                  selected={row.identity === selectedIdentity}
                  selectedRow={selectedRow}
                />
              )) : null}
            </div>
          ) : null}
          {(priority.length > 0 || snoozed.length > 0) && visibleRecent.length > 0
            ? <div className={styles.conversationDivider} />
            : null}
          {visibleRecent.map((row) => (
            <ConversationRow
              disabled={sessionTransitionPending || workspaceOpenPending}
              key={row.identity}
              row={row}
              selected={row.identity === selectedIdentity}
              selectedRow={selectedRow}
            />
          ))}
          {query && contentItems.length > 0 ? (
            <div className={styles.contentSearchResults}>
              <p className={styles.searchResultGroupLabel}>对话内容</p>
              {contentItems.map((item) => (
                <ConversationContentResult
                  disabled={sessionTransitionPending || workspaceOpenPending}
                  item={item}
                  key={`${item.sessionFileIdentity}:${item.messageId}`}
                />
              ))}
            </div>
          ) : null}
          {query && (
            messageSearch?.status === "loading"
            || messageSearch?.status === "refreshing"
          ) ? (
            <p aria-live="polite" className={styles.catalogNotice} role="status">正在建立或查询对话内容索引…</p>
          ) : null}
          {query && (
            messageSearch?.status === "failed"
            || messageSearch?.status === "unavailable"
          ) ? (
            <p className={styles.catalogNotice} role="status">对话内容索引暂时不可用，当前仅显示对话名称结果。</p>
          ) : null}
          {query && messageSearch?.status === "ready" && messageSearch.incomplete ? (
            <p className={styles.catalogNotice} role="status">对话内容结果不完整，部分 Session 尚未完成索引。</p>
          ) : null}
          {catalog.rebuilding && !catalogFallback ? (
            <p aria-live="polite" className={styles.catalogNotice} role="status">
              {messages.navigation.catalogRebuilding}
            </p>
          ) : catalog.loading && rows.length === 0 ? (
            <p aria-live="polite" className={styles.workspaceEmpty} role="status">
              {messages.navigation.catalogLoading}
            </p>
          ) : null}
          {catalogFallback && !catalogUnavailable ? (
            <p className={styles.catalogNotice} role="status">
              {catalog.degradedReason === "runtime-query"
                ? messages.navigation.catalogFallbackRecovering
                : messages.navigation.catalogFallback}
            </p>
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
            && !hasVisibleResults
            && messageSearch?.status !== "loading" ? (
            <p className={styles.workspaceEmpty}>{catalogIncompleteEmpty
              ? messages.navigation.catalogIncompleteEmpty
              : "这个工作区还没有对话。"}</p>
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
      <Button
        className={styles.workspaceQuickAction!}
        aria-label={`${workspace.displayName} 工作区菜单`}
        data-testid="workspace-menu-trigger"
      >
        <Ellipsis aria-hidden="true" size={14} />
      </Button>
      <Popover className={styles.menuPopover!} placement="bottom end" offset={5}>
        <Menu className={styles.menu!} aria-label={`${workspace.displayName} 工作区菜单`}>
          <MenuItem className={styles.menuItem!} onAction={() => void refreshWorkspaceConversations(workspace)} textValue="刷新对话">
            <RefreshCw aria-hidden="true" size={14} />刷新对话
          </MenuItem>
          <MenuItem className={styles.menuItem!} onAction={() => void importSessionIntoWorkspace(workspace)} textValue="导入 Pi Session">
            <FileInput aria-hidden="true" size={14} />导入 Pi Session
          </MenuItem>
          <MenuItem className={styles.menuItem!} onAction={() => useConversationDialogStore.getState().openArchived(workspace.id)} textValue="已归档对话">
            <Archive aria-hidden="true" size={14} />已归档对话
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
