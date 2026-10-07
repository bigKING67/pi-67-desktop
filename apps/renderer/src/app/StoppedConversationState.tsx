import { CircleAlert, MessagesSquare } from "lucide-react";
import type { ReactNode } from "react";
import type { SessionSummary, WorkspaceDescriptor } from "@pi67/domain";
import { formatSessionRelativeTime } from "../navigation/session-navigation.js";
import type { RendererWorkbenchTask } from "../workbench/workbench-store.js";
import { resumeRendererTask } from "../workbench/task-activation-controller.js";
import { openRendererWorkspaceDescriptor } from "../workspace/workspace-open-controller.js";
import styles from "./WorkspaceShell.module.css";

export function StoppedConversationState({ session, sessionFileIdentity, sessionPath, workspace }: {
  session: SessionSummary | undefined;
  sessionFileIdentity: string;
  sessionPath: string;
  workspace: WorkspaceDescriptor;
}) {
  const open = async () => {
    if (workspace.availability !== "available") return;
    await openRendererWorkspaceDescriptor(workspace, sessionPath, sessionFileIdentity);
  };
  return (
    <ResumeSurface
      detail={session ? `${session.messageCount} 条消息 · ${formatSessionRelativeTime(session.modifiedAt)}更新` : undefined}
      title={session?.name.trim() || "未命名对话"}
      workspace={workspace}
    >
      <button
        className="primary-button"
        disabled={workspace.availability !== "available"}
        onClick={() => void open()}
        type="button"
      >打开对话</button>
    </ResumeSurface>
  );
}

export function StoppedTaskState({ task, workspace }: {
  task: RendererWorkbenchTask;
  workspace: WorkspaceDescriptor;
}) {
  const lost = task.lifecycle === "lost";
  return (
    <ResumeSurface
      detail={lost ? "运行意外中断，未完成的操作不会自动重试。" : "会话已恢复，启动后可继续。"}
      lost={lost}
      title={task.title}
      workspace={workspace}
    >
      <button
        className="primary-button"
        disabled={!task.sessionPath || workspace.availability !== "available"}
        onClick={() => void resumeRendererTask(task.id)}
        type="button"
      >恢复任务</button>
      {!task.sessionPath ? <small>缺少会话记录，无法恢复。请从左侧重新打开。</small> : null}
    </ResumeSurface>
  );
}

/** Both resume surfaces share one centered group: mark, Workspace, title, detail, and the action. */
function ResumeSurface({ children, detail, lost = false, title, workspace }: {
  children: ReactNode;
  detail: string | undefined;
  lost?: boolean;
  title: string;
  workspace: WorkspaceDescriptor;
}) {
  const Mark = lost ? CircleAlert : MessagesSquare;
  return (
    <section className={styles.emptyWorkspace}>
      <div className={styles.stoppedConversation} data-lost={lost || undefined} data-testid="stopped-conversation">
        <Mark aria-hidden="true" className={styles.stoppedConversationMark} size={22} />
        <span className={styles.stoppedConversationWorkspace}>{workspace.displayName}</span>
        <h2>{title}</h2>
        {detail ? <p>{detail}</p> : null}
        {children}
      </div>
    </section>
  );
}
