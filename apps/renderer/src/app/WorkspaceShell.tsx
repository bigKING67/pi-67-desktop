import { useLayoutEffect, useRef } from "react";
import type { WorkspaceDescriptor } from "@pi67/domain";
import {
  selectedWorkbenchTask,
  type RendererWorkbenchTask
} from "../workbench/workbench-store.js";
import { useAppStore } from "./app-store.js";
import { Composer } from "../composer/Composer.js";
import { ContextPane } from "../context/ContextPane.js";
import { NavigationRail } from "../navigation/NavigationRail.js";
import { OperationStatusBar } from "../operation/OperationStatusBar.js";
import { StreamingAnnouncer } from "../live-turn/StreamingAnnouncer.js";
import { createRendererSession } from "../session/session-lifecycle-controller.js";
import {
  selectWorkspaceSessionCatalog,
  useSessionCatalogStore
} from "../navigation/session-catalog-store.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { selectSessionId } from "../session/session-projection-selectors.js";
import { SettingsWorkbench } from "../settings/SettingsWorkbench.js";
import { Transcript } from "../transcript/Transcript.js";
import { TrustBanner } from "../workspace/TrustBanner.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import { resumeRendererTask } from "../workbench/task-activation-controller.js";
import { repairAndOpenRendererWorkspace } from "../workbench/workspace-registration-controller.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import styles from "./WorkspaceShell.module.css";

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
    if (selectedSurface?.kind !== "conversation" || selectedSurface.conversation.kind !== "session") {
      return undefined;
    }
    const conversation = selectedSurface.conversation;
    return selectWorkspaceSessionCatalog(state, conversation.workspaceId).items.find((session) => (
      session.path === conversation.sessionPath
    ));
  });
  const liveSessionId = useSessionProjectionStore(selectSessionId);
  const liveWorkspacePath = useAppStore((state) => state.workspace);
  const liveRuntime = useAppStore((state) => state.runtime);
  const sessionTransitionPending = useAppStore((state) => state.sessionTransitionPending);
  const settingsSelected = selectedSurface?.kind === "settings";
  const taskSelected = selectedSurface?.kind === "conversation";
  const liveTaskSelected = taskSelected && selectedTask?.sessionId === liveSessionId;
  const taskRecoveryPending = Boolean(
    taskSelected
    && selectedWorkspace?.identity.canonicalPath === liveWorkspacePath
    && sessionTransitionPending
    && liveRuntime.phase === "recovering"
  );
  const effectiveContextVisible = liveTaskSelected && !taskRecoveryPending && contextVisible;

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
    return <main className={styles.applicationSurface}><SettingsWorkbench /></main>;
  }

  return (
    <main className={`workspace-grid ${effectiveContextVisible ? "has-context" : "context-hidden"} ${navigationVisible ? styles.navigationVisible : styles.navigationHidden}`}>
      <NavigationRail containerRef={navigationRef} />
      {navigationIsDrawer && navigationVisible ? (
        <button
          aria-label="关闭会话导航"
          className={styles.navigationDrawerScrim}
          onClick={onCloseNavigation}
          type="button"
        />
      ) : null}
      {taskRecoveryPending ? (
        <TaskRecoveryState detail={liveRuntime.detail} />
      ) : liveTaskSelected ? (
        <section className="conversation-region" aria-label="Pi conversation">
          <TrustBanner />
          <StreamingAnnouncer />
          <Transcript />
          <OperationStatusBar />
          <Composer />
        </section>
      ) : selectedWorkspace && selectedWorkspace.availability !== "available" ? (
        <WorkspaceRecoveryState workspace={selectedWorkspace} />
      ) : selectedTask && selectedWorkspace ? (
        <StoppedTaskState task={selectedTask} workspace={selectedWorkspace} />
      ) : selectedSurface?.kind === "conversation"
        && selectedSurface.conversation.kind === "session"
        && selectedWorkspace ? (
          <StoppedConversationState
            sessionName={selectedSession?.name}
            sessionPath={selectedSurface.conversation.sessionPath}
            workspace={selectedWorkspace}
          />
      ) : (
        <WorkspaceEmptyState />
      )}
      {effectiveContextVisible ? (
        <>
          <button
            aria-label="关闭上下文抽屉"
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

function StoppedConversationState({ sessionName, sessionPath, workspace }: {
  sessionName: string | undefined;
  sessionPath: string;
  workspace: WorkspaceDescriptor;
}) {
  const open = async () => {
    if (workspace.availability !== "available") return;
    await openRendererWorkspaceDescriptor(workspace, sessionPath);
  };
  return (
    <section className={styles.emptyWorkspace}>
      <div>
        <span className="section-label">{workspace.displayName}</span>
        <h2>{sessionName?.trim() || "Pi 会话"}</h2>
        <p>这个会话当前没有运行任务。打开后会继续使用原有 Pi JSONL Session。</p>
        <button
          className="primary-button"
          disabled={workspace.availability !== "available"}
          onClick={() => void open()}
          type="button"
        >打开会话</button>
      </div>
    </section>
  );
}

function TaskRecoveryState({ detail }: { detail: string }) {
  return (
    <section className={styles.emptyWorkspace}>
      <div aria-live="polite" role="status">
        <span className="loading-line" />
        <h2>正在恢复 Pi 任务</h2>
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
          ? "Pi 运行服务曾在这个任务运行时中断。Prompt、Tool、授权或 Extension 输入不会被自动重放。"
          : "这个会话已恢复，但 Pi Runtime 尚未启动。恢复后会继续使用同一个 Pi JSONL Session。"}</p>
        <button
          className="primary-button"
          disabled={!task.sessionPath || workspace.availability !== "available"}
          onClick={() => void resumeRendererTask(task.id)}
          type="button"
        >恢复任务</button>
        {!task.sessionPath ? <small>缺少可恢复的 Session 路径；可以从左侧 Session 列表重新打开。</small> : null}
      </div>
    </section>
  );
}

function WorkspaceRecoveryState({ workspace }: { workspace: WorkspaceDescriptor }) {
  const identityChanged = workspace.availability === "identity-changed";
  return (
    <section className={styles.emptyWorkspace}>
      <div role="status">
        <span className="section-label">{workspace.displayName}</span>
        <h2>{identityChanged ? "工作区目录身份已变化" : "找不到工作区目录"}</h2>
        <p>{identityChanged
          ? "为避免把原有信任授予另一个目录，项目资源保持禁用。请通过原生目录选择器重新确认。"
          : "目录可能已移动、删除或暂时不可访问。重新选择目录不会删除 Pi Session 或项目文件。"}</p>
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
  const liveWorkspacePath = useAppStore((state) => state.workspace);
  const workspace = useWorkbenchStore((state) => (
    state.currentWorkspaceId ? state.workspaces[state.currentWorkspaceId] : undefined
  ));
  const start = async () => {
    if (!workspace || workspace.availability !== "available") return;
    if (liveWorkspacePath === workspace.identity.canonicalPath) await createRendererSession();
    else await openRendererWorkspaceDescriptor(workspace);
  };
  return (
    <section className={styles.emptyWorkspace}>
      <div>
        <span className="section-label">当前工作区</span>
        <h2>开始一个新会话</h2>
        <p>新会话会出现在当前工作区列表中。切换工作区或会话不会停止仍在后台运行的 Pi 任务。</p>
        <button
          className="primary-button"
          disabled={workspace?.availability !== "available"}
          onClick={() => void start()}
          type="button"
        >新建会话</button>
      </div>
    </section>
  );
}

const FOCUSABLE_SELECTOR = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
