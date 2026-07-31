import type { OperationView, RuntimeStatus, SessionSummary } from "@pi67/domain";
import {
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Command,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  TriangleAlert,
  Wrench
} from "lucide-react";
import { Button } from "react-aria-components";
import type { ReactNode } from "react";
import piIconUrl from "../assets/pi-icon-64.png";
import { useAppStore } from "../app/app-store.js";
import { messages } from "../localization/message-catalog.js";
import {
  selectConversationSessionSummary,
  useSessionCatalogStore
} from "../navigation/session-catalog-store.js";
import { NotificationCenter } from "../notifications/NotificationCenter.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  selectSessionId,
  selectSessionName,
  selectSessionPath
} from "../session/session-projection-selectors.js";
import { useShellStore } from "./shell-store.js";
import { conversationPrimaryTitle } from "../workbench/conversation-title.js";
import {
  selectedWorkbenchTask,
  useWorkbenchStore,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import styles from "./TitleBar.module.css";

interface TitleBarProps {
  navigationAvailable: boolean;
  navigationVisible: boolean;
  onToggleNavigation: () => void;
}

export function TitleBar({ navigationAvailable, navigationVisible, onToggleNavigation }: TitleBarProps) {
  const liveRuntime = useAppStore((state) => state.runtime);
  const workspace = useAppStore((state) => state.workspace);
  const sessionName = useSessionProjectionStore(selectSessionName);
  const sessionId = useSessionProjectionStore(selectSessionId);
  const sessionPath = useSessionProjectionStore(selectSessionPath);
  const operation = useAppStore((state) => state.operation);
  const operationDetail = useAppStore((state) => state.operationDetail);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const contextVisible = useShellStore((state) => state.contextVisible);
  const setContextVisible = useShellStore((state) => state.setContextVisible);
  const setCommandPaletteOpen = useShellStore((state) => state.setCommandPaletteOpen);
  const selectedTask = useWorkbenchStore(selectedWorkbenchTask);
  const selectedSurface = useWorkbenchStore((state) => state.selectedSurface);
  const settingsSelected = selectedSurface?.kind === "settings";
  const selectedConversation = selectedSurface?.kind === "conversation"
    ? selectedSurface.conversation
    : undefined;
  const selectedWorkspace = useWorkbenchStore((state) => {
    if (state.selectedSurface?.kind === "conversation") {
      return state.workspaces[state.selectedSurface.conversation.workspaceId];
    }
    if (state.selectedSurface?.kind === "workspace") {
      return state.workspaces[state.selectedSurface.workspaceId];
    }
    return state.currentWorkspaceId ? state.workspaces[state.currentWorkspaceId] : undefined;
  });
  const selectedCatalogSession = useSessionCatalogStore((state) => (
    selectConversationSessionSummary(state, selectedConversation)
  ));
  const selectedTaskIsLive = Boolean(selectedTask && sessionId && selectedTask.sessionId === sessionId);
  const selectedConversationIsLive = selectedTaskIsLive || Boolean(
    selectedConversation?.kind === "session"
    && sessionPath
    && selectedConversation.sessionPath === sessionPath
  );
  const selectedTaskOwnsLiveWorkspace = Boolean(
    selectedTask
    && selectedWorkspace?.identity.canonicalPath === workspace
  );
  const runtime = selectedTaskIsLive || (selectedTaskOwnsLiveWorkspace && sessionTransitionPending)
    ? liveRuntime
    : selectedTask?.runtime ?? liveRuntime;
  const status = statusPresentation(
    runtime,
    selectedTaskIsLive ? operation : undefined,
    selectedTaskIsLive ? operationDetail : undefined
  );
  const workspaceName = selectedWorkspace?.displayName ?? basename(workspace ?? "");
  const activeSessionName = settingsSelected ? undefined : selectedConversationTitle({
    selectedTask,
    selectedCatalogSession,
    selectedConversationIsLive,
    sessionName,
    sessionId
  });
  const currentTitle = settingsSelected ? "设置" : activeSessionName || workspaceName || "π";
  const contextWorkspaceName = !settingsSelected && !navigationVisible && activeSessionName && workspaceName
    ? workspaceName
    : undefined;
  const fullContextTitle = contextWorkspaceName
    ? `${contextWorkspaceName} / ${currentTitle}`
    : currentTitle;
  const showBrandMark = !settingsSelected && !navigationAvailable && currentTitle === "π";

  return (
    <header className={`title-bar ${styles.header}`}>
      <div className={styles.identity}>
        {navigationAvailable && !settingsSelected ? (
          <Button
            className={`icon-button navigation-toggle ${styles.iconButton}`}
            aria-controls="session-navigation"
            aria-describedby="navigation-toggle-tooltip"
            aria-expanded={navigationVisible}
            aria-keyshortcuts="Control+B Meta+B"
            aria-label={navigationVisible ? messages.shell.hideNavigation : messages.shell.showNavigation}
            onPress={onToggleNavigation}
          >
            {navigationVisible ? <PanelLeftClose aria-hidden="true" size={16} /> : <PanelLeftOpen aria-hidden="true" size={16} />}
            <ControlTooltip id="navigation-toggle-tooltip">{navigationVisible
              ? messages.shell.hideNavigation
              : messages.shell.showNavigation}</ControlTooltip>
          </Button>
        ) : null}
        <div className={`brand-lockup ${styles.brand}`} title={fullContextTitle}>
          {showBrandMark ? (
            <img
              alt=""
              aria-hidden="true"
              className={`brand-mark ${styles.brandMark}`}
              data-testid="title-brand-mark"
              src={piIconUrl}
            />
          ) : null}
          <span className={styles.location} data-testid="title-context">
            {contextWorkspaceName ? (
              <>
                <span className={styles.workspaceName} data-testid="title-context-workspace">
                  {contextWorkspaceName}
                </span>
                <span className={styles.locationSeparator} aria-hidden="true">/</span>
              </>
            ) : null}
            <strong className={styles.currentTitle} data-testid="title-context-current">
              {currentTitle}
            </strong>
          </span>
        </div>
      </div>

      <div className={`title-actions ${styles.actions}`}>
        <div
          className={`${styles.status} ${styles[status.tone]!}`}
          aria-label={messages.shell.currentStatus(status.label)}
          data-runtime-phase={runtime.phase}
          title={status.label}
        >
          <StatusIcon kind={status.icon} {...(status.spinning === undefined ? {} : { spinning: status.spinning })} />
          <span>{status.label}</span>
        </div>
        <NotificationCenter />
        <Button
          className={`icon-button ${styles.iconButton}`}
          aria-describedby="command-palette-tooltip"
          aria-keyshortcuts="Control+K Meta+K"
          aria-label={messages.shell.openCommandPalette}
          onPress={() => setCommandPaletteOpen(true)}
        >
          <Command aria-hidden="true" size={16} />
          <ControlTooltip id="command-palette-tooltip">{messages.shell.commandPalette}</ControlTooltip>
        </Button>
        {selectedTaskIsLive ? (
          <Button
            className={`icon-button context-toggle ${styles.iconButton}`}
            aria-controls="session-context"
            aria-describedby="context-toggle-tooltip"
            aria-expanded={contextVisible}
            aria-keyshortcuts="Control+Shift+B Meta+Shift+B"
            aria-label={contextVisible ? messages.shell.hideContext : messages.shell.showContext}
            data-testid="inspector-toggle"
            onPress={() => setContextVisible(!contextVisible)}
          >
            {contextVisible ? <PanelRightClose aria-hidden="true" size={16} /> : <PanelRightOpen aria-hidden="true" size={16} />}
            <ControlTooltip id="context-toggle-tooltip">{contextVisible
              ? messages.shell.hideContextPanel
              : messages.shell.showContextPanel}</ControlTooltip>
          </Button>
        ) : null}
      </div>
    </header>
  );
}

function selectedConversationTitle({
  selectedTask,
  selectedCatalogSession,
  selectedConversationIsLive,
  sessionName,
  sessionId
}: {
  selectedTask: RendererWorkbenchTask | undefined;
  selectedCatalogSession: SessionSummary | undefined;
  selectedConversationIsLive: boolean;
  sessionName: string | undefined;
  sessionId: string | undefined;
}): string | undefined {
  if (selectedTask) return conversationPrimaryTitle(selectedTask, selectedCatalogSession);
  const catalogTitle = selectedCatalogSession?.name.trim();
  if (catalogTitle) return catalogTitle;
  if (!selectedConversationIsLive) return undefined;
  return sessionName?.trim()
    || (sessionId ? messages.shell.sessionFallback(sessionId.slice(0, 8)) : undefined);
}

function ControlTooltip({ id, children }: { id: string; children: ReactNode }) {
  return <span className={styles.tooltip} id={id} role="tooltip">{children}</span>;
}

type StatusIconKind = "idle" | "ready" | "active" | "tool" | "warning" | "error" | "recovering";

interface StatusPresentation {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger" | "accent";
  icon: StatusIconKind;
  spinning?: boolean;
}

function statusPresentation(
  runtime: RuntimeStatus,
  operation: OperationView | undefined,
  operationDetail: string | undefined
): StatusPresentation {
  if (runtime.phase === "recovering") {
    return { label: runtime.detail, tone: "warning", icon: "recovering", spinning: true };
  }
  if (operation) {
    if (operation.lifecycle === "failed") return { label: operationDetail || messages.operation.failed, tone: "danger", icon: "error" };
    if (operation.lifecycle === "lost") return { label: operationDetail || messages.operation.lost, tone: "warning", icon: "warning" };
    if (operation.lifecycle === "cancelled") return { label: messages.operation.cancelled, tone: "neutral", icon: "idle" };
    if (operation.lifecycle === "completed") return { label: messages.operation.completed, tone: "success", icon: "ready" };
    if (operation.activity?.kind === "approval") return { label: messages.operation.needsApproval, tone: "warning", icon: "warning" };
    if (operation.activity?.kind === "extension-input") return { label: messages.operation.waitingInput, tone: "warning", icon: "warning" };
    if (operation.activity?.kind === "tool") return { label: messages.operation.usingTool, tone: "accent", icon: "tool" };
    if (operation.activity?.kind === "compaction") return { label: messages.operation.compacting, tone: "accent", icon: "recovering", spinning: true };
    if (operation.activity?.kind === "responding") return { label: messages.operation.responding, tone: "accent", icon: "active", spinning: true };
    if (operation.activity?.kind === "thinking") return { label: messages.operation.thinking, tone: "accent", icon: "active", spinning: true };
    if (operation.kind === "session-import") return { label: messages.operation.importingSession, tone: "accent", icon: "active", spinning: true };
    if (operation.kind === "compaction") return { label: messages.operation.compacting, tone: "accent", icon: "recovering", spinning: true };
    if (operation.lifecycle === "accepted") return { label: messages.operation.accepted, tone: "accent", icon: "active" };
    return { label: operationDetail || messages.operation.running, tone: "accent", icon: "active", spinning: true };
  }
  if (runtime.phase === "failed") return { label: runtime.detail, tone: "danger", icon: "error" };
  if (runtime.phase === "starting" || runtime.phase === "busy") {
    return { label: runtime.detail, tone: "accent", icon: "active", spinning: true };
  }
  if (runtime.phase === "ready") return { label: runtime.detail, tone: "success", icon: "ready" };
  return { label: runtime.detail, tone: "neutral", icon: "idle" };
}

function StatusIcon({ kind, spinning }: { kind: StatusIconKind; spinning?: boolean }) {
  const className = spinning ? styles.spinning : undefined;
  if (kind === "ready") return <CircleCheck aria-hidden="true" size={14} />;
  if (kind === "active") return <CircleDashed aria-hidden="true" className={className} size={14} />;
  if (kind === "tool") return <Wrench aria-hidden="true" size={14} />;
  if (kind === "warning") return <CircleAlert aria-hidden="true" size={14} />;
  if (kind === "error") return <TriangleAlert aria-hidden="true" size={14} />;
  if (kind === "recovering") return <RefreshCw aria-hidden="true" className={className} size={14} />;
  return <Circle aria-hidden="true" size={12} />;
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
