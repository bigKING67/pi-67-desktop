import type { WorkspaceMessageSearchItem } from "@pi67/domain";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import { openRendererSession } from "../session/session-lifecycle-controller.js";
import { requestTranscriptMessageJump } from "../transcript/transcript-navigation.js";
import {
  rendererWorkbenchStore,
  selectedWorkbenchTask
} from "../workbench/workbench-store.js";
import { workbenchProtocolContextForTask } from "../workbench/workbench-protocol-context.js";

export async function openWorkspaceMessageResult(item: WorkspaceMessageSearchItem): Promise<void> {
  try {
    await openRendererSession(item.sessionPath, item.sessionFileIdentity);
    const task = selectedWorkbenchTask(rendererWorkbenchStore.getState());
    if (
      !task
      || task.conversation.kind !== "session"
      || task.conversation.sessionFileIdentity !== item.sessionFileIdentity
    ) throw new Error("目标对话未能完成权威绑定，请重试。");
    const window = await agentConnectionController.request(
      "message.locate",
      { id: item.messageId },
      [],
      { context: workbenchProtocolContextForTask(task) }
    );
    if (window.sessionId !== task.sessionId) throw new Error("目标消息属于已失效的对话实例。");
    requestAnimationFrame(() => requestTranscriptMessageJump({ id: item.messageId, window }));
  } catch (error) {
    publishNotification({
      level: "warning",
      title: "无法打开对话正文结果",
      message: error instanceof Error ? error.message : "目标消息暂时不可用。"
    });
  }
}

export const openPaletteMessageResult = openWorkspaceMessageResult;
