import {
  FolderPlus,
  MessageSquarePlus,
  Settings,
  UserRound
} from "lucide-react";
import { lazy, Suspense, useMemo, useState, type RefObject } from "react";
import { Button } from "react-aria-components";
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
import { useConversationDialogStore } from "./conversation-dialog-store.js";
import {
  SessionCatalogSearch,
  useSessionCatalogSearch
} from "./SessionCatalogSearch.js";
import { useNavigationMessageSearch } from "./use-navigation-message-search.js";
import { useNewMoneyAccount } from "../context-memory/use-new-money-account.js";
import { newMoneyAccountLabel } from "../context-memory/new-money-account-store.js";
import { TeamChatNavigation } from "../team-chat/TeamChatNavigation.js";
import chatStyles from "../team-chat/TeamChat.module.css";
import { WorkspaceModeSwitch } from "./WorkspaceModeSwitch.js";
import { useTeamChatDialogStore } from "../team-chat/team-chat-dialog-store.js";

const WorkspaceRemovalDialog = lazy(async () => {
  const module = await import("./WorkspaceRemovalDialog.js");
  return { default: module.WorkspaceRemovalDialog };
});
const ConversationRenameDialog = lazy(() => import("./ConversationRenameDialog.js").then((module) => ({
  default: module.ConversationRenameDialog
})));
const ConversationDraftDiscardDialog = lazy(() => import("./ConversationDraftDiscardDialog.js").then((module) => ({
  default: module.ConversationDraftDiscardDialog
})));
const NewChannelDialog = lazy(() => import("../team-chat/NewChannelDialog.js").then((module) => ({
  default: module.NewChannelDialog
})));
const TeamChatHandoffDialog = lazy(() => import("../team-chat/TeamChatHandoffDialog.js").then((module) => ({
  default: module.TeamChatHandoffDialog
})));
const TeamChatStartWorkDialog = lazy(() => import("../team-chat/TeamChatStartWorkDialog.js").then((module) => ({
  default: module.TeamChatStartWorkDialog
})));
const ArchivedConversationsDialog = lazy(() => import("./ArchivedConversationsDialog.js").then((module) => ({
  default: module.ArchivedConversationsDialog
})));

export function NavigationRail({
  containerRef
}: {
  containerRef?: RefObject<HTMLElement | null>;
}) {
  const connected = useAppStore((state) => state.connected);
  const accountLabel = newMoneyAccountLabel(useNewMoneyAccount());
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
  const messageSearchByWorkspace = useNavigationMessageSearch(query, searchableWorkspaceIds);
  const [removalWorkspaceId, setRemovalWorkspaceId] = useState<string>();
  const sessionSearchFocusRevision = useShellStore((state) => state.sessionSearchFocusRevision);
  const sessionSearchHandledRevision = useShellStore((state) => state.sessionSearchHandledRevision);
  const acknowledgeSessionSearchFocus = useShellStore((state) => state.acknowledgeSessionSearchFocus);
  const removalWorkspace = removalWorkspaceId ? workspaces[removalWorkspaceId] : undefined;
  const archivedWorkspaceId = useConversationDialogStore((state) => state.archivedWorkspaceId);
  const renameTarget = useConversationDialogStore((state) => state.renameTarget);
  const draftDiscardTarget = useConversationDialogStore((state) => state.draftDiscardTarget);
  const archivedWorkspace = archivedWorkspaceId ? workspaces[archivedWorkspaceId] : undefined;
  const chatMode = useShellStore((state) => state.workspaceMode === "chat");
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const handoffSource = useTeamChatDialogStore((state) => state.handoff);
  const startWorkSource = useTeamChatDialogStore((state) => state.startWork);

  return (
    <aside
      ref={containerRef}
      className={`navigation-rail ${styles.rail} ${chatMode ? chatStyles.chatRail : ""}`}
      id="session-navigation"
      aria-label={messages.navigation.region}
    >
      <div className={styles.railTop}>
        <header className={styles.railHeader}>
          <div className={styles.railBrand} aria-label="New Money 工作台" data-testid="navigation-brand">
            <img alt="" aria-hidden="true" src={piIconUrl} />
            <strong>New Money</strong>
          </div>
          {chatMode ? (
            <Button
              className={styles.workspaceAdd!}
              aria-label={messages.teamChat.newChannel}
              data-testid="team-chat-new-channel"
              onPress={() => setChannelDialogOpen(true)}
            >
              <MessageSquarePlus aria-hidden="true" size={15} />
            </Button>
          ) : (
            <Button
              className={styles.workspaceAdd!}
              aria-label="添加或创建工作区"
              data-testid="workspace-add"
              onPress={() => void openRendererWorkspace()}
            >
              <FolderPlus aria-hidden="true" size={15} />
            </Button>
          )}
        </header>
        <WorkspaceModeSwitch />
      </div>

      {chatMode ? <TeamChatNavigation onCreateChannel={() => setChannelDialogOpen(true)} /> : (
        <>
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
            messageSearchByWorkspace={messageSearchByWorkspace}
            query={query}
            onRequestRemoval={(workspaceId) => requestWorkspaceRemoval(workspaceId, setRemovalWorkspaceId)}
          />
        </>
      )}

      <footer className={`navigation-footer ${styles.footer}`}>
        <Button
          {...(accountLabel.initial ? { "aria-label": `${accountLabel.title}，${accountLabel.detail}` } : {})}
          className={styles.accountButton!}
          data-testid="account-settings-entry"
          onPress={() => rendererWorkbenchStore.getState().openSettings("account")}
        >
          {accountLabel.initial
            ? <span aria-hidden="true" className={styles.accountAvatar!}>{accountLabel.initial}</span>
            : <UserRound aria-hidden="true" size={15} />}
          <span>
            <strong>{accountLabel.title}</strong>
            {accountLabel.initial ? null : <small>{accountLabel.detail}</small>}
          </span>
        </Button>
        <FooterUpdateButton />
        <Button
          aria-label="设置"
          className={styles.footerIconButton!}
          data-testid="settings-entry"
          onPress={() => rendererWorkbenchStore.getState().openSettings("general")}
        >
          <Settings aria-hidden="true" size={16} />
        </Button>
      </footer>

      {removalWorkspace ? (
        <Suspense fallback={<span className="sr-only" role="status">正在打开移除工作区确认</span>}>
          <WorkspaceRemovalDialog
            workspace={removalWorkspace}
            onDismiss={() => setRemovalWorkspaceId(undefined)}
          />
        </Suspense>
      ) : null}
      {renameTarget ? (
        <Suspense fallback={<span className="sr-only" role="status">正在打开重命名对话框</span>}>
          <ConversationRenameDialog />
        </Suspense>
      ) : null}
      {draftDiscardTarget ? (
        <Suspense fallback={<span className="sr-only" role="status">正在打开丢弃草稿确认</span>}>
          <ConversationDraftDiscardDialog />
        </Suspense>
      ) : null}
      {handoffSource || startWorkSource ? (
        <Suspense fallback={null}>
          {handoffSource ? <TeamChatHandoffDialog source={handoffSource} /> : null}
          {startWorkSource ? <TeamChatStartWorkDialog source={startWorkSource} /> : null}
        </Suspense>
      ) : null}
      {channelDialogOpen ? (
        <Suspense fallback={<span className="sr-only" role="status">{messages.teamChat.creating}</span>}>
          <NewChannelDialog onClose={() => setChannelDialogOpen(false)} />
        </Suspense>
      ) : null}
      {archivedWorkspace ? (
        <Suspense fallback={<span className="sr-only" role="status">正在打开归档对话</span>}>
          <ArchivedConversationsDialog workspace={archivedWorkspace} />
        </Suspense>
      ) : null}
    </aside>
  );
}

function FooterUpdateButton() {
  const setUpdateDialogOpen = useShellStore((state) => state.setUpdateDialogOpen);
  const update = useUpdateStore((state) => state.update);
  // Stays mounted through download/install so the dialog (progress, cancel) remains one click away.
  if (update.phase !== "available" && update.phase !== "downloading" && update.phase !== "installing") return null;
  const label = update.phase === "available" ? "更新" : update.phase === "downloading" ? "下载中" : "安装中";
  return (
    <Button
      aria-label={update.phase === "available" ? `更新到 ${update.version}` : `${label}：New Money ${update.version}`}
      className={styles.updateButton!}
      data-testid="footer-update-entry"
      onPress={() => setUpdateDialogOpen(true)}
    >
      {label}
    </Button>
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
      message: "请先处理这个工作区仍在运行、等待或包含草稿的对话。"
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
