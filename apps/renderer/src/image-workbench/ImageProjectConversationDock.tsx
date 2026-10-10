import { useEffect } from "react";
import { useAppStore } from "../app/app-store.js";
import { Composer } from "../composer/Composer.js";
import { StreamingAnnouncer } from "../live-turn/StreamingAnnouncer.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import { selectSessionFileIdentity, selectSessionGeneration, selectSessionId } from "../session/session-projection-selectors.js";
import { Transcript } from "../transcript/Transcript.js";
import { canRenderLiveTask } from "../workbench/live-task-authority.js";
import { selectedWorkbenchTask, useWorkbenchStore } from "../workbench/workbench-store.js";
import { useImageProject } from "./image-project-controller.js";
import { bindImageProjectConversation, openImageProjectConversation } from "./image-project-conversation.js";
import { ImagePromptAttachments } from "./ImagePromptAttachments.js";
import styles from "./ImageProjectPage.module.css";

/** The project's Pi conversation, shown beside the candidates (product model §6). */
export function ImageProjectConversationDock({ projectId }: { projectId: string }) {
  const libraryId = useWorkbenchStore((state) => state.imageLibraryWorkspaceId);
  const task = useWorkbenchStore(selectedWorkbenchTask);
  const conversationKnown = useImageProject((state) => state.projectId === projectId && state.conversationKnown);
  const liveSessionId = useSessionProjectionStore(selectSessionId);
  const liveFileIdentity = useSessionProjectionStore(selectSessionFileIdentity);
  const liveGeneration = useSessionProjectionStore(selectSessionGeneration);
  const transitionPending = useAppStore((state) => state.sessionTransitionPending || state.workspaceOpenPending);

  useEffect(() => bindImageProjectConversation(projectId), [projectId]);
  useEffect(() => {
    if (conversationKnown) void openImageProjectConversation(projectId, useImageProject.getState().conversation);
  }, [projectId, conversationKnown]);

  const inLibrary = task !== undefined && task.workspaceId === libraryId;
  if (inLibrary && canRenderLiveTask(task, liveSessionId, liveFileIdentity, liveGeneration)) {
    return (
      <div className={`conversation-region ${styles.conversationRegion}`}>
        <StreamingAnnouncer />
        <Transcript />
        <Composer context={<ImagePromptAttachments />} />
      </div>
    );
  }
  if (inLibrary && task.conversation.kind === "provisional" && !transitionPending) {
    return (
      <div className={`conversation-region ${styles.conversationRegion}`}>
        <p className={styles.conversationIntro}>告诉 Agent 要做什么，比如“把背景换成暖色影棚”“加一行价格 ¥199”。消息会附带当前修订、选中的图层、标记和参考。</p>
        <Composer context={<ImagePromptAttachments />} />
      </div>
    );
  }
  return <p className={styles.conversationStatus} role="status">正在打开项目对话…</p>;
}
