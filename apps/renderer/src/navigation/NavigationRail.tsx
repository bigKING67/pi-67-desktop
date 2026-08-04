import {
  CircleHelp,
  DownloadCloud,
  FolderPlus,
  Info,
  Settings2,
  UserRound
} from "lucide-react";
import { lazy, Suspense, useMemo, useState, type RefObject } from "react";
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import piIconUrl from "../assets/pi-icon-64.png";
import { useAppStore } from "../app/app-store.js";
import { messages } from "../localization/message-catalog.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useShellStore } from "../shell/shell-store.js";
import { useUpdateStore } from "../updates/update-store.js";
import { rendererWorkbenchStore, useWorkbenchStore } from "../workbench/workbench-store.js";
import { workspaceRemovalDisposition } from "../workbench/workspace-registration-controller.js";
import { openRendererWorkspace } from "../workspace/workspace-open-controller.js";
import styles from "./NavigationRail.module.css";
import { WorkspaceConversationList } from "./WorkspaceConversationList.js";
import { ConversationRenameDialog } from "./ConversationRenameDialog.js";
import { ArchivedConversationsDialog } from "./ArchivedConversationsDialog.js";
import { useConversationDialogStore } from "./conversation-dialog-store.js";
import {
  SessionCatalogSearch,
  useSessionCatalogSearch
} from "./SessionCatalogSearch.js";

const WorkspaceRemovalDialog = lazy(async () => {
  const module = await import("./WorkspaceRemovalDialog.js");
  return { default: module.WorkspaceRemovalDialog };
});

export function NavigationRail({
  containerRef
}: {
  containerRef?: RefObject<HTMLElement | null>;
}) {
  const connected = useAppStore((state) => state.connected);
  const workspaces = useWorkbenchStore((state) => state.workspaces);
  const workspaceOrder = useWorkbenchStore((state) => state.workspaceOrder);
  const expandedWorkspaceIds = useWorkbenchStore((state) => state.expandedWorkspaceIds);
  const searchableWorkspaceIds = useMemo(() => workspaceOrder.filter((workspaceId) => (
    workspaces[workspaceId]?.availability === "available"
  )), [workspaceOrder, workspaces]);
  const visibleWorkspaceIds = useMemo(() => expandedWorkspaceIds.filter((workspaceId) => (
    workspaces[workspaceId]?.availability === "available"
  )), [expandedWorkspaceIds, workspaces]);
  const { query, setQuery } = useSessionCatalogSearch(
    connected,
    visibleWorkspaceIds,
    searchableWorkspaceIds
  );
  const [removalWorkspaceId, setRemovalWorkspaceId] = useState<string>();
  const sessionSearchFocusRevision = useShellStore((state) => state.sessionSearchFocusRevision);
  const sessionSearchHandledRevision = useShellStore((state) => state.sessionSearchHandledRevision);
  const acknowledgeSessionSearchFocus = useShellStore((state) => state.acknowledgeSessionSearchFocus);
  const removalWorkspace = removalWorkspaceId ? workspaces[removalWorkspaceId] : undefined;
  const archivedWorkspaceId = useConversationDialogStore((state) => state.archivedWorkspaceId);
  const archivedWorkspace = archivedWorkspaceId ? workspaces[archivedWorkspaceId] : undefined;

  return (
    <aside
      ref={containerRef}
      className={`navigation-rail ${styles.rail}`}
      id="session-navigation"
      aria-label={messages.navigation.region}
    >
      <header className={styles.railHeader}>
        <div className={styles.railBrand} aria-label="Pi-67 会话工作台" data-testid="navigation-brand">
          <img alt="" aria-hidden="true" src={piIconUrl} />
          <strong>Pi-67</strong>
        </div>
        <Button
          className={styles.workspaceAdd!}
          aria-label="添加或创建工作区"
          data-testid="workspace-add"
          onPress={() => void openRendererWorkspace()}
        >
          <FolderPlus aria-hidden="true" size={15} />
        </Button>
      </header>

      <div className={styles.actions}>
        <SessionCatalogSearch
          focusRevision={sessionSearchFocusRevision}
          handledRevision={sessionSearchHandledRevision}
          query={query}
          onFocusHandled={acknowledgeSessionSearchFocus}
          onQueryChange={setQuery}
        />
      </div>

      <WorkspaceConversationList
        query={query}
        onRequestRemoval={(workspaceId) => requestWorkspaceRemoval(workspaceId, setRemovalWorkspaceId)}
      />

      <footer className={`navigation-footer ${styles.footer}`}>
        <Button
          className={styles.accountButton!}
          data-testid="account-settings-entry"
          onPress={() => rendererWorkbenchStore.getState().openSettings("account")}
        >
          <UserRound aria-hidden="true" size={15} />
          <span><strong>未登录</strong><small>本地模式</small></span>
        </Button>
        <HelpMenu />
      </footer>

      {removalWorkspace ? (
        <Suspense fallback={<span className="sr-only" role="status">正在打开移除工作区确认</span>}>
          <WorkspaceRemovalDialog
            workspace={removalWorkspace}
            onDismiss={() => setRemovalWorkspaceId(undefined)}
          />
        </Suspense>
      ) : null}
      <ConversationRenameDialog />
      {archivedWorkspace ? <ArchivedConversationsDialog workspace={archivedWorkspace} /> : null}
    </aside>
  );
}

function HelpMenu() {
  const setUpdateDialogOpen = useShellStore((state) => state.setUpdateDialogOpen);
  const update = useUpdateStore((state) => state.update);
  const updateAvailable = update.phase === "available";
  const updateLabel = updateAvailable ? `发现新版本 ${update.version}` : "检查更新";
  return (
    <MenuTrigger>
      <Button
        aria-label={updateAvailable ? `帮助与设置，有新版本 ${update.version}` : "帮助与设置"}
        className={styles.helpButton!}
        data-testid="help-menu-trigger"
        data-update-available={updateAvailable}
      >
        <CircleHelp aria-hidden="true" size={16} />
      </Button>
      <Popover className={`${styles.menuPopover} ${styles.footerMenu}`} placement="top end" offset={6}>
        <Menu aria-label="帮助与设置" className={styles.menu!}>
          <MenuItem
            className={styles.menuItem!}
            onAction={() => rendererWorkbenchStore.getState().openSettings("general")}
            textValue="设置"
          ><Settings2 aria-hidden="true" size={14} />设置</MenuItem>
          <MenuItem
            className={styles.menuItem!}
            onAction={() => setUpdateDialogOpen(true)}
            textValue={updateLabel}
          >
            <DownloadCloud aria-hidden="true" size={14} />
            <span>{updateLabel}</span>
            {updateAvailable ? <span className={styles.updateBadge!}>新版本</span> : null}
          </MenuItem>
          <MenuItem
            className={styles.menuItem!}
            onAction={() => rendererWorkbenchStore.getState().openSettings("about")}
            textValue="帮助"
          ><Info aria-hidden="true" size={14} />帮助</MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

function requestWorkspaceRemoval(
  workspaceId: string,
  showDialog: (workspaceId: string) => void
): void {
  const disposition = workspaceRemovalDisposition(workspaceId);
  if (disposition === "tasks-open") {
    publishNotification({
      level: "warning",
      title: "无法移除工作区",
      message: "请先处理这个工作区仍在运行、等待或包含草稿的会话。"
    });
    return;
  }
  if (disposition === "workspace-active") {
    publishNotification({
      level: "warning",
      title: "无法移除当前工作区",
      message: "请先切换到另一个工作区，再移除这个工作区。"
    });
    return;
  }
  if (disposition === "workspace-missing" || disposition === "host-busy") return;
  showDialog(workspaceId);
}
