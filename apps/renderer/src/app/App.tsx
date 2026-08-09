import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useApprovalStore } from "../approval/approval-store.js";
import { DEFAULT_APPLICATION_TITLE } from "../extension-ui/extension-ui-state.js";
import { useExtensionUiStore } from "../extension-ui/extension-ui-store.js";
import { messages } from "../localization/message-catalog.js";
import { TitleBar } from "../shell/TitleBar.js";
import { useShellStore } from "../shell/shell-store.js";
import { Welcome } from "../workspace/Welcome.js";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { NotificationToasts } from "../notifications/NotificationToasts.js";
import { publishNotification } from "../notifications/notification-store.js";
import { createOperationFreshnessInstallation } from "../operation/operation-freshness-installation.js";
import { WorkbenchProjectionBridge } from "../workbench/WorkbenchProjectionBridge.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import { useTaskDraftStore } from "../workbench/task-draft-store.js";
import { registerAvailableRendererWorkspaces } from "../workbench/workspace-host-registration-controller.js";
import { useAppStore } from "./app-store.js";
import { installGlobalShortcuts, toggleRendererNavigation } from "./global-shortcuts.js";
import { LazySurfaceBoundary } from "./LazySurfaceBoundary.js";
import { applyRendererAgentEvent } from "./renderer-agent-event-controller.js";
import styles from "./App.module.css";
import { initializeUpdateProjection } from "../updates/update-store.js";
import { dismissConversationFind } from "../search/conversation-find-events.js";
import { refreshConversationSnoozeClock } from "../navigation/conversation-snooze-clock.js";

const WorkspaceShell = lazy(() => import("./WorkspaceShell.js").then((module) => ({ default: module.WorkspaceShell })));
const ApprovalDialog = lazy(() => import("../approval/ApprovalDialog.js").then((module) => ({ default: module.ApprovalDialog })));
const CommandPalette = lazy(() => import("../command-palette/CommandPalette.js").then((module) => ({ default: module.CommandPalette })));
const DoctorDialog = lazy(() => import("../doctor/DoctorDialog.js").then((module) => ({ default: module.DoctorDialog })));
const ExtensionDialog = lazy(() => import("../extension-ui/ExtensionDialog.js").then((module) => ({ default: module.ExtensionDialog })));
const CredentialDialog = lazy(() => import("../settings/CredentialDialog.js").then((module) => ({ default: module.CredentialDialog })));
const UpdateDialog = lazy(() => import("../updates/UpdateDialog.js").then((module) => ({ default: module.UpdateDialog })));
const SessionTreeDialog = lazy(() => import("../session-tree/SessionTreeDialog.js").then((module) => ({ default: module.SessionTreeDialog })));
const WorkspaceConversationSearchDialog = lazy(() => import("../search/WorkspaceConversationSearchDialog.js").then((module) => ({ default: module.WorkspaceConversationSearchDialog })));
const WorkspaceContentSearchDialog = lazy(() => import("../search/WorkspaceContentSearchDialog.js").then((module) => ({ default: module.WorkspaceContentSearchDialog })));
const KeyboardShortcutsDialog = lazy(() => import("../help/KeyboardShortcutsDialog.js").then((module) => ({ default: module.KeyboardShortcutsDialog })));

export function App() {
  const workspace = useAppStore((state) => state.workspace);
  const connected = useAppStore((state) => state.connected);
  const navigationVisible = useShellStore((state) => state.navigationVisible);
  const setNavigationVisible = useShellStore((state) => state.setNavigationVisible);
  const contextVisible = useShellStore((state) => state.contextVisible);
  const setContextVisible = useShellStore((state) => state.setContextVisible);
  const extensionTitle = useExtensionUiStore((state) => state.title);
  const approvalDialogOpen = useApprovalStore((state) => state.requests.length > 0);
  const extensionDialogOpen = useExtensionUiStore((state) => state.requests.length > 0);
  const doctorDialogOpen = useShellStore((state) => state.doctorDialogOpen);
  const credentialDialogOpen = useShellStore((state) => state.credentialDialogOpen);
  const updateDialogOpen = useShellStore((state) => state.updateDialogOpen);
  const commandPaletteOpen = useShellStore((state) => state.commandPaletteOpen);
  const sessionTreeDialogOpen = useShellStore((state) => state.sessionTreeDialogOpen);
  const keyboardShortcutsDialogOpen = useShellStore((state) => state.keyboardShortcutsDialogOpen);
  const blockingOverlayOpen = approvalDialogOpen || extensionDialogOpen;
  const selectedSurface = useWorkbenchStore((state) => state.selectedSurface);
  const workbenchWorkspaceCount = useWorkbenchStore((state) => state.workspaceOrder.length);
  const [navigationIsDrawer, setNavigationIsDrawer] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  const freshnessInstallationRef = useRef<ReturnType<typeof createOperationFreshnessInstallation> | undefined>(undefined);
  if (!freshnessInstallationRef.current) {
    freshnessInstallationRef.current = createOperationFreshnessInstallation({
      onLoadFailed: () => publishNotification({
        level: "warning",
        title: messages.operation.monitorUnavailableTitle,
        message: messages.operation.monitorUnavailableDetail
      })
    });
  }

  const restoreNavigationTriggerFocus = useCallback(() => {
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".navigation-toggle")?.focus());
  }, []);

  const closeNavigation = useCallback((restoreFocus = true) => {
    setNavigationVisible(false);
    if (restoreFocus) restoreNavigationTriggerFocus();
  }, [restoreNavigationTriggerFocus, setNavigationVisible]);

  const toggleNavigation = useCallback(toggleRendererNavigation, []);

  useEffect(() => {
    const unsubscribe = agentConnectionController.subscribe({
      onConnected: (identity) => {
        useAppStore.getState().handleAgentConnected(identity);
        void registerAvailableRendererWorkspaces();
      },
      onEvent: (event, envelope) => {
        applyRendererAgentEvent(event, envelope, (projectedEvent, projectedEnvelope) => {
          freshnessInstallationRef.current?.observe(projectedEvent, projectedEnvelope);
        });
      },
      onSequenceGap: (gap) => useAppStore.getState().handleSequenceGap(gap),
      onTeardown: (error) => useAppStore.getState().handleAgentTeardown(error)
    });
    return unsubscribe;
  }, [setNavigationVisible]);

  useEffect(() => {
    const installation = freshnessInstallationRef.current;
    if (!workspace) {
      installation?.deactivate();
      return;
    }
    installation?.activate();
    return () => installation?.deactivate();
  }, [workspace]);

  useEffect(() => window.pi67.system.onAgentHostFailed((state) => {
    useAppStore.getState().handleAgentHostFailed(state);
  }), []);

  useEffect(() => window.pi67.system.onPowerResume(() => {
    freshnessInstallationRef.current?.handlePowerResume();
    refreshConversationSnoozeClock();
    useAppStore.getState().handlePowerResume();
  }), []);

  useEffect(() => initializeUpdateProjection(), []);

  useEffect(() => () => useTaskDraftStore.getState().dispose(), []);

  useEffect(() => {
    document.title = extensionTitle ? `${extensionTitle} - ${DEFAULT_APPLICATION_TITLE}` : DEFAULT_APPLICATION_TITLE;
  }, [extensionTitle]);

  useEffect(() => installGlobalShortcuts(), []);

  useEffect(() => {
    if (!blockingOverlayOpen) return;
    useShellStore.getState().closeNonBlockingDialogs();
    dismissConversationFind();
  }, [blockingOverlayOpen]);

  useEffect(() => {
    const breakpoint = window.matchMedia("(max-width: 760px)");
    const syncNavigationMode = (matches: boolean) => {
      setNavigationIsDrawer(matches);
      setNavigationVisible(!matches);
    };
    const onBreakpointChange = (event: MediaQueryListEvent) => syncNavigationMode(event.matches);
    syncNavigationMode(breakpoint.matches);
    breakpoint.addEventListener("change", onBreakpointChange);
    return () => breakpoint.removeEventListener("change", onBreakpointChange);
  }, []);

  useEffect(() => {
    if (navigationIsDrawer && contextVisible) setNavigationVisible(false);
  }, [contextVisible, navigationIsDrawer, setNavigationVisible]);

  useEffect(() => {
    if (!workspace) return;
    const breakpoint = window.matchMedia("(max-width: 1040px)");
    const closeWhenNarrow = (matches: boolean) => {
      if (matches) setContextVisible(false);
    };
    const onBreakpointChange = (event: MediaQueryListEvent) => closeWhenNarrow(event.matches);
    closeWhenNarrow(breakpoint.matches);
    breakpoint.addEventListener("change", onBreakpointChange);
    return () => breakpoint.removeEventListener("change", onBreakpointChange);
  }, [setContextVisible, workspace]);

  const closeContextDrawer = () => {
    setContextVisible(false);
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(".context-toggle")?.focus();
    });
  };

  return (
    <div className="application-shell" data-agent-connected={connected ? "true" : "false"}>
      <WorkbenchProjectionBridge />
      <TitleBar navigationAvailable={Boolean(workspace) || workbenchWorkspaceCount > 0} navigationVisible={navigationVisible} onToggleNavigation={toggleNavigation} />
      {!workspace && workbenchWorkspaceCount === 0 && selectedSurface?.kind !== "settings" ? (
        <Welcome />
      ) : (
        <LazySurfaceBoundary
          description="Pi 任务可能仍在后台运行。重新加载只会重建界面，并在连接恢复后重新同步当前任务。"
          kind="workspace"
          surface="workspace-shell"
          title="工作区界面未能加载"
        >
          <Suspense fallback={<WorkspaceShellFallback />}>
            <WorkspaceShell
              contextVisible={contextVisible}
              navigationIsDrawer={navigationIsDrawer}
              navigationVisible={navigationVisible}
              onCloseContextDrawer={closeContextDrawer}
              onCloseNavigation={closeNavigation}
            />
          </Suspense>
        </LazySurfaceBoundary>
      )}
      <NotificationToasts />
      <Suspense fallback={null}><WorkspaceConversationSearchDialog /></Suspense>
      <Suspense fallback={null}><WorkspaceContentSearchDialog /></Suspense>
      {keyboardShortcutsDialogOpen && !blockingOverlayOpen ? (
        <LazySurfaceBoundary
          description="关闭后可通过 Cmd/Ctrl+/ 或帮助菜单重新打开。"
          kind="overlay"
          onDismiss={() => useShellStore.getState().setKeyboardShortcutsDialogOpen(false)}
          surface="keyboard-shortcuts-dialog"
          title="快捷键帮助未能加载"
        >
          <Suspense fallback={<OverlayLoading label="正在加载快捷键帮助" />}><KeyboardShortcutsDialog /></Suspense>
        </LazySurfaceBoundary>
      ) : null}
      {approvalDialogOpen ? (
        <LazySurfaceBoundary
          description="工具仍保持阻止状态，没有授权结果会被自动发送。重新加载界面后可继续处理这次请求。"
          kind="blocking-overlay"
          surface="approval-dialog"
          title="授权界面未能加载"
        >
          <Suspense fallback={<OverlayLoading label="正在加载授权界面" />}><ApprovalDialog /></Suspense>
        </LazySurfaceBoundary>
      ) : null}
      {extensionDialogOpen && !approvalDialogOpen ? (
        <LazySurfaceBoundary
          description="Extension 请求仍保持等待状态，没有输入会被自动提交。重新加载界面后可继续处理这次请求。"
          kind="blocking-overlay"
          surface="extension-dialog"
          title="Extension 输入界面未能加载"
        >
          <Suspense fallback={<OverlayLoading label="正在加载 Extension 输入界面" />}><ExtensionDialog /></Suspense>
        </LazySurfaceBoundary>
      ) : null}
      {doctorDialogOpen && !blockingOverlayOpen ? (
        <LazySurfaceBoundary
          description={messages.doctor.interfaceFailureDescription}
          kind="overlay"
          onDismiss={() => useShellStore.getState().setDoctorDialogOpen(false)}
          surface="doctor-dialog"
          title={messages.doctor.interfaceFailureTitle}
        >
          <Suspense fallback={<OverlayLoading label={messages.doctor.loadingInterface} />}><DoctorDialog /></Suspense>
        </LazySurfaceBoundary>
      ) : null}
      {credentialDialogOpen && !blockingOverlayOpen ? (
        <LazySurfaceBoundary
          description={messages.credentials.interfaceFailureDescription}
          kind="overlay"
          onDismiss={() => useShellStore.getState().setCredentialDialogOpen(false)}
          surface="credential-dialog"
          title={messages.credentials.interfaceFailureTitle}
        >
          <Suspense fallback={<OverlayLoading label={messages.credentials.loadingInterface} />}><CredentialDialog /></Suspense>
        </LazySurfaceBoundary>
      ) : null}
      {updateDialogOpen && !blockingOverlayOpen ? (
        <LazySurfaceBoundary
          description="更新界面模块发生错误。不会自动下载或安装任何更新。"
          kind="overlay"
          onDismiss={() => useShellStore.getState().setUpdateDialogOpen(false)}
          surface="update-dialog"
          title="更新界面未能加载"
        >
          <Suspense fallback={<OverlayLoading label="正在加载更新界面" />}><UpdateDialog /></Suspense>
        </LazySurfaceBoundary>
      ) : null}
      {sessionTreeDialogOpen && !blockingOverlayOpen ? (
        <LazySurfaceBoundary
          description="关闭后可通过 /tree 或命令面板重新打开。"
          kind="overlay"
          onDismiss={() => useShellStore.getState().setSessionTreeDialogOpen(false)}
          surface="session-tree-dialog"
          title="会话分支界面未能加载"
        >
          <Suspense fallback={<OverlayLoading label="正在加载会话分支" />}><SessionTreeDialog /></Suspense>
        </LazySurfaceBoundary>
      ) : null}
      {commandPaletteOpen && !blockingOverlayOpen ? (
        <LazySurfaceBoundary
          description="命令面板模块发生错误。可以关闭后继续使用当前工作区，或重新加载界面恢复该功能。"
          kind="overlay"
          onDismiss={() => useShellStore.getState().setCommandPaletteOpen(false)}
          surface="command-palette"
          title="命令面板未能加载"
        >
          <Suspense fallback={<OverlayLoading label="正在加载命令面板" />}><CommandPalette /></Suspense>
        </LazySurfaceBoundary>
      ) : null}
    </div>
  );
}

function WorkspaceShellFallback() {
  return (
    <main aria-busy="true" className={styles.workspaceLoading}>
      <div className="transcript-loading" role="status">
        <span className="loading-line" />
        正在加载工作区界面
      </div>
    </main>
  );
}

function OverlayLoading({ label }: { label: string }) {
  return (
    <div className={`modal-overlay ${styles.overlayLoading}`}>
      <div aria-busy="true" className={styles.overlayLoadingSurface} role="status">
        <span className="loading-line" />
        {label}
      </div>
    </div>
  );
}
