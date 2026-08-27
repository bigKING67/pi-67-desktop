import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import type { WorkspaceDescriptor } from "@pi67/domain";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import { useAppStore } from "./app-store.js";
import { Composer } from "../composer/Composer.js";
import { ContextPane } from "../context/ContextPane.js";
import { NavigationRail } from "../navigation/NavigationRail.js";
import { StreamingAnnouncer } from "../live-turn/StreamingAnnouncer.js";
import {
  dismissUnconfirmedRendererSession,
  recheckUnconfirmedRendererSession
} from "../session/session-creation-recovery-controller.js";
import {
  selectConversationSessionSummary,
  useSessionCatalogStore
} from "../navigation/session-catalog-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  selectSessionFileIdentity,
  selectSessionGeneration,
  selectSessionId
} from "../session/session-projection-selectors.js";
import { Transcript } from "../transcript/Transcript.js";
import { TrustBanner } from "../workspace/TrustBanner.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import {
  activateRendererTask,
  resumeRendererTask
} from "../workbench/task-activation-controller.js";
import { repairAndOpenRendererWorkspace } from "../workbench/workspace-registration-controller.js";
import { canRenderLiveTask } from "../workbench/live-task-authority.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import { beginRendererSessionIntentInWorkspace } from "../workspace/workspace-session-controller.js";
import { WorkspaceFileSurface } from "../workspace-files/WorkspaceFileSurface.js";
import { LazySurfaceBoundary } from "./LazySurfaceBoundary.js";
import { NewSessionIntentSurface } from "./NewSessionIntentSurface.js";
import styles from "./WorkspaceShell.module.css";

const SettingsWorkbench = lazy(() => import("../settings/SettingsWorkbench.js").then((module) => ({
  default: module.SettingsWorkbench
})));

interface WorkspaceShellProps {
  contextVisible: boolean;
  navigationIsDrawer: boolean;
  navigationVisible: boolean;
  onCloseContextDrawer: () => void;
  onCloseNavigation: () => void;
}

export function WorkspaceShell({
  contextVisible,
  navigationIsDrawer,
  navigationVisible,
  onCloseContextDrawer,
  onCloseNavigation
}: WorkspaceShellProps) {
  const navigationRef = useRef<HTMLElement>(null);
  const selectedSurface = useWorkbenchStore((state) => state.selectedSurface);
  const selectedTask = useWorkbenchStore(selectedWorkbenchTask);
  const selectedWorkspace = useWorkbenchStore((state) => (
    selectedTask
      ? state.workspaces[selectedTask.workspaceId]
      : state.selectedSurface?.kind === "workspace"
        ? state.workspaces[state.selectedSurface.workspaceId]
        : state.currentWorkspaceId ? state.workspaces[state.currentWorkspaceId] : undefined
  ));
  const selectedSession = useSessionCatalogStore((state) => {
    const conversation = selectedSurface?.kind === "conversation"
      ? selectedSurface.conversation
      : undefined;
    return selectConversationSessionSummary(state, conversation);
  });
  const liveSessionId = useSessionProjectionStore(selectSessionId);
  const liveSessionFileIdentity = useSessionProjectionStore(selectSessionFileIdentity);
  const liveSessionGeneration = useSessionProjectionStore(selectSessionGeneration);
  const liveWorkspacePath = useAppStore((state) => state.workspace);
  const liveRuntime = useAppStore((state) => state.runtime);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const settingsSelected = selectedSurface?.kind === "settings";
  const taskSelected = selectedSurface?.kind === "conversation";
  const liveTaskSelected = taskSelected && canRenderLiveTask(
    selectedTask,
    liveSessionId,
    liveSessionFileIdentity,
    liveSessionGeneration
  );
  const taskRecoveryPending = Boolean(
    taskSelected
    && selectedWorkspace?.identity.canonicalPath === liveWorkspacePath
    && sessionTransitionPending
    && liveRuntime.phase === "recovering"
  );
  const effectiveContextVisible = Boolean(selectedWorkspace) && !settingsSelected && !taskRecoveryPending && contextVisible;
  const centralSurface = taskRecoveryPending ? (
    <TaskRecoveryState detail={liveRuntime.detail} />
  ) : liveTaskSelected ? (
    <section className="conversation-region" aria-label="Pi conversation">
      <TrustBanner />
      <StreamingAnnouncer />
      <Transcript />
      <Composer />
    </section>
  ) : selectedWorkspace && selectedWorkspace.availability !== "available" ? (
    <WorkspaceRecoveryState workspace={selectedWorkspace} />
  ) : selectedTask?.conversation.kind === "provisional"
    && selectedTask.creationStatus === undefined
    && selectedWorkspace ? (
      <NewSessionIntentSurface task={selectedTask} workspace={selectedWorkspace} />
  ) : selectedTask?.conversation.kind === "provisional" && selectedWorkspace ? (
    <ProvisionalTaskState task={selectedTask} workspace={selectedWorkspace} />
  ) : selectedTask?.conversation.kind === "session" && selectedWorkspace ? (
    <StoppedTaskState task={selectedTask} workspace={selectedWorkspace} />
  ) : selectedSurface?.kind === "conversation"
    && selectedSurface.conversation.kind === "session"
    && selectedWorkspace ? (
      <StoppedConversationState
        sessionName={selectedSession?.name}
        sessionFileIdentity={selectedSurface.conversation.sessionFileIdentity}
        sessionPath={selectedSurface.conversation.sessionPath}
        workspace={selectedWorkspace}
      />
  ) : (
    <WorkspaceEmptyState />
  );

  useLayoutEffect(() => {
    if (!navigationIsDrawer || !navigationVisible) return;
    const drawer = navigationRef.current;
    if (!drawer) return;
    const focusFirst = () => drawer.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    focusFirst();
    const frame = window.requestAnimationFrame(() => {
      if (!drawer.contains(document.activeElement)) focusFirst();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseNavigation();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    drawer.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      drawer.removeEventListener("keydown", onKeyDown);
    };
  }, [navigationIsDrawer, navigationVisible, onCloseNavigation]);

  useLayoutEffect(() => {
    if (settingsSelected && navigationIsDrawer && navigationVisible) onCloseNavigation();
  }, [navigationIsDrawer, navigationVisible, onCloseNavigation, settingsSelected]);

  if (settingsSelected) {
    return (
      <LazySurfaceBoundary
        description="设置模块发生错误。后台任务仍会继续运行，可以返回工作台或重新加载界面。"
        kind="workspace"
        onDismiss={() => rendererWorkbenchStore.getState().closeSettings()}
        surface="settings-workbench"
        title="设置界面未能加载"
      >
        <Suspense fallback={<SettingsLoadingState />}>
          <main className={styles.applicationSurface}><SettingsWorkbench /></main>
        </Suspense>
      </LazySurfaceBoundary>
    );
  }

  return (
    <main
      aria-label="π 工作台"
      className={`workspace-grid ${effectiveContextVisible ? "has-context" : "context-hidden"} ${navigationVisible ? `navigation-visible ${styles.navigationVisible}` : `navigation-hidden ${styles.navigationHidden}`}`}
    >
      <NavigationRail containerRef={navigationRef} />
      {navigationIsDrawer && navigationVisible ? (
        <button
          aria-label="关闭对话导航"
          className={styles.navigationDrawerScrim}
          onClick={onCloseNavigation}
          type="button"
        />
      ) : null}
      {selectedWorkspace ? (
        <WorkspaceFileSurface workspace={selectedWorkspace}>{centralSurface}</WorkspaceFileSurface>
      ) : centralSurface}
      {effectiveContextVisible ? (
        <>
          <button
            aria-label="关闭任务检查器抽屉"
            className="context-drawer-scrim"
            onClick={onCloseContextDrawer}
            type="button"
          />
          <ContextPane />
        </>
      ) : null}
    </main>
  );
}

function StoppedConversationState({ sessionName, sessionFileIdentity, sessionPath, workspace }: {
  sessionName: string | undefined;
  sessionFileIdentity: string;
  sessionPath: string;
  workspace: WorkspaceDescriptor;
}) {
  const open = async () => {
    if (workspace.availability !== "available") return;
    await openRendererWorkspaceDescriptor(workspace, sessionPath, sessionFileIdentity);
  };
  return (
    <section className={styles.emptyWorkspace}>
      <div>
        <span className="section-label">{workspace.displayName}</span>
        <h2>{sessionName?.trim() || "未命名对话"}</h2>
        <p>对话当前未在运行，打开后可继续。</p>
        <button
          className="primary-button"
          disabled={workspace.availability !== "available"}
          onClick={() => void open()}
          type="button"
        >打开对话</button>
      </div>
    </section>
  );
}

function SettingsLoadingState() {
  return (
    <main aria-busy="true" className={styles.applicationSurface}>
      <section className={styles.emptyWorkspace} role="status">
        <div>
          <span className="loading-line" />
          <h2>正在加载设置</h2>
        </div>
      </section>
    </main>
  );
}

function TaskRecoveryState({ detail }: { detail: string }) {
  return (
    <section className={styles.emptyWorkspace}>
      <div aria-live="polite" role="status">
        <span className="loading-line" />
        <h2>正在恢复任务</h2>
        <p>{detail}</p>
      </div>
    </section>
  );
}

function StoppedTaskState({ task, workspace }: {
  task: RendererWorkbenchTask;
  workspace: WorkspaceDescriptor;
}) {
  return (
    <section className={styles.emptyWorkspace}>
      <div>
        <span className="section-label">{workspace.displayName}</span>
        <h2>{task.title}</h2>
        <p>{task.lifecycle === "lost"
          ? "运行意外中断，未完成的操作不会自动重试。"
          : "会话已恢复，启动后可继续。"}</p>
        <button
          className="primary-button"
          disabled={!task.sessionPath || workspace.availability !== "available"}
          onClick={() => void resumeRendererTask(task.id)}
          type="button"
        >恢复任务</button>
        {!task.sessionPath ? <small>缺少会话记录，无法恢复。请从左侧重新打开。</small> : null}
      </div>
    </section>
  );
}

function ProvisionalTaskState({ task, workspace }: {
  task: RendererWorkbenchTask;
  workspace: WorkspaceDescriptor;
}) {
  const [checking, setChecking] = useState(false);
  const copy = provisionalTaskStateCopy(task);
  const unconfirmed = canManageUnconfirmedProvisionalTask(task);
  const recheck = async () => {
    if (checking) return;
    setChecking(true);
    try {
      await recheckUnconfirmedRendererSession(task.id, { activateTask: activateRendererTask });
    } finally {
      setChecking(false);
    }
  };
  return (
    <section className={styles.emptyWorkspace}>
      <div>
        <div aria-live="polite" className={styles.provisionalStatus} role="status">
          {copy.loading ? <span className="loading-line" /> : null}
          <span className="section-label">{workspace.displayName}</span>
          <h2>{copy.title}</h2>
          <p>{copy.detail}</p>
        </div>
        {unconfirmed ? (
          <div className={styles.provisionalActions}>
            <button
              className="primary-button"
              disabled={checking}
              onClick={() => void recheck()}
              type="button"
            >{checking ? "正在检查…" : "重新检查"}</button>
            <button
              className="secondary-button"
              disabled={checking}
              onClick={() => dismissUnconfirmedRendererSession(task.id)}
              type="button"
            >放弃此占位</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function canManageUnconfirmedProvisionalTask(task: RendererWorkbenchTask): boolean {
  return task.conversation.kind === "provisional" && task.creationStatus === "unconfirmed";
}

export function provisionalTaskStateCopy(task: RendererWorkbenchTask): {
  title: string;
  detail: string;
  loading: boolean;
} {
  if (task.creationStatus === "pending" || task.creationStatus === "confirming") {
    return {
      title: "正在确认对话",
      detail: "Pi 运行服务正在确认对话是否已创建，请稍候。",
      loading: true
    };
  }
  if (task.creationStatus === "unconfirmed") {
    return {
      title: "对话创建结果尚未确认",
      detail: "请先重新检查。只有找到唯一的新对话时才会自动匹配；放弃只移除占位，不会删除 Pi 对话记录。",
      loading: false
    };
  }
  return {
    title: task.hasDraft ? "对话草稿尚未创建" : "对话尚未创建",
    detail: task.hasDraft
      ? "草稿仍保留在当前窗口中，重新新建对话后可以继续发送。"
      : "该条目没有可恢复的会话记录。",
    loading: false
  };
}

function WorkspaceRecoveryState({ workspace }: { workspace: WorkspaceDescriptor }) {
  const identityChanged = workspace.availability === "identity-changed"
    || workspace.availability === "needs-confirmation";
  return (
    <section className={styles.emptyWorkspace}>
      <div role="status">
        <span className="section-label">{workspace.displayName}</span>
        <h2>{identityChanged ? "工作区目录身份已变化" : "找不到工作区目录"}</h2>
        <p>{identityChanged
          ? "为避免把原有信任授予另一个目录，项目资源保持禁用。请通过原生目录选择器重新确认。"
          : "目录可能已移动、删除或暂时不可访问。重新选择不会删除历史会话或项目文件。"}</p>
        <button
          className="primary-button"
          onClick={() => void repairAndOpenRendererWorkspace(workspace.id)}
          type="button"
        >重新选择目录</button>
      </div>
    </section>
  );
}

function WorkspaceEmptyState() {
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const workspaceOpenPending = useAppStore((state) => state.workspaceOpenPending);
  const workspace = useWorkbenchStore((state) => (
    state.currentWorkspaceId ? state.workspaces[state.currentWorkspaceId] : undefined
  ));
  const start = async () => {
    if (!workspace || workspace.availability !== "available") return;
    await beginRendererSessionIntentInWorkspace(workspace);
  };
  return (
    <section className={styles.emptyWorkspace}>
      <div>
        <span className="section-label">当前工作区</span>
        <h2>开始一个新对话</h2>
        <p>新对话会出现在当前工作区列表中。切换工作区或对话不会停止仍在后台运行的 Pi 任务。</p>
        <button
          className="primary-button"
          disabled={
            workspace?.availability !== "available"
            || sessionTransitionPending
            || workspaceOpenPending
          }
          onClick={() => void start()}
          type="button"
        >新建对话</button>
      </div>
    </section>
  );
}

const FOCUSABLE_SELECTOR = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
