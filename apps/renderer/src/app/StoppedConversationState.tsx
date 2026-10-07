import { MessagesSquare } from "lucide-react";
import type { SessionSummary, WorkspaceDescriptor } from "@pi67/domain";
import { formatSessionRelativeTime } from "../navigation/session-navigation.js";
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
    <section className={styles.emptyWorkspace}>
      <div className={styles.stoppedConversation} data-testid="stopped-conversation">
        <MessagesSquare aria-hidden="true" className={styles.stoppedConversationMark} size={22} />
        <span className={styles.stoppedConversationWorkspace}>{workspace.displayName}</span>
        <h2>{session?.name.trim() || "未命名对话"}</h2>
        {session ? (
          <p>{`${session.messageCount} 条消息 · ${formatSessionRelativeTime(session.modifiedAt)}更新`}</p>
        ) : null}
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
