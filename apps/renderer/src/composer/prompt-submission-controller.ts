import type { OperationSubmissionResult, TransferImage } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useAppStore } from "../app/app-store.js";
import { operationFromSubmission } from "../app/app-state-projection.js";
import { applySettledSubmission } from "../app/operation-submission.js";
import {
  capturePromptSubmissionAuthority,
  promptSubmissionAuthorityMessage,
  validatePromptSubmissionAcceptance
} from "../app/prompt-submission-authority.js";
import { userMessagePreview } from "../workbench/recent-user-message.js";
import { rendererWorkbenchStore, selectedWorkbenchTask } from "../workbench/workbench-store.js";
import type { DraftAttachment } from "./composer-attachments.js";

export type PromptSubmissionResult =
  | { accepted: true; operationId: string; retainsAttachmentPreviews: boolean }
  | { accepted: false; error: string };

export async function submitRendererPrompt(
  text: string,
  images: TransferImage[],
  behavior: "send" | "steer" | "followUp",
  submissionId: string,
  attachments: readonly DraftAttachment[] = []
): Promise<PromptSubmissionResult> {
  if (!agentConnectionController.identity) throw new Error("Pi 运行服务尚未连接。");
  const delivery = behavior === "steer"
    ? "steer"
    : behavior === "followUp" ? "follow-up" : "new-turn";
  const state = useAppStore.getState();
  const workbench = rendererWorkbenchStore.getState();
  const selectedTaskId = selectedWorkbenchTask(workbench)?.id;
  if (selectedTaskId && workbench.canStartTask(selectedTaskId) === "run-limit") {
    const detail = "已有 4 个任务正在运行或等待输入。请先完成或停止一个任务。";
    publishNotification({ level: "warning", title: "已达到并发上限", message: `${detail} 草稿和附件已保留。` });
    return { accepted: false, error: detail };
  }
  const expectedAuthority = capturePromptSubmissionAuthority(state);
  if (!expectedAuthority) {
    const detail = promptSubmissionAuthorityMessage("AUTHORITY_NOT_READY");
    publishNotification({ level: "warning", title: detail, message: "草稿和附件已保留。" });
    return { accepted: false, error: detail };
  }
  try {
    const accepted = await agentConnectionController.request("prompt.submit", {
      submissionId,
      text,
      ...(images.length === 0 ? {} : { images }),
      delivery
    }, images.map((image) => image.data));
    const result = applyAcceptedPrompt(accepted, expectedAuthority);
    const taskStillSelected = selectedTaskId !== undefined
      && selectedWorkbenchTask(rendererWorkbenchStore.getState())?.id === selectedTaskId;
    const terminalError = settledPromptError(accepted);
    const retainsAttachmentPreviews = result.accepted
      && delivery === "new-turn"
      && taskStillSelected
      && useConversationStore.getState().installPendingUserTurn({
        submissionId,
        operationId: result.operationId,
        authority: expectedAuthority,
        message: {
          id: `pending-user:${result.operationId}`,
          role: "user",
          parts: text ? [{ type: "text", text }] : [],
          createdAt: Date.now(),
          ...(terminalError === undefined
            ? {}
            : { error: `发送失败：${terminalError}` })
        },
        attachments: attachments.map((attachment) => ({ ...attachment })),
        status: terminalError === undefined ? "accepted" : "failed"
      });
    if (result.accepted && selectedTaskId) {
      const preview = userMessagePreview(text, images.length > 0);
      rendererWorkbenchStore.getState().updateTask(selectedTaskId, {
        lifecycle: "accepted",
        pendingTitle: undefined,
        ...(preview ? { recentUserMessagePreview: preview } : {})
      });
    }
    return result.accepted
      ? { ...result, retainsAttachmentPreviews }
      : result;
  } catch (error) {
    const detail = errorMessage(error);
    publishNotification({
      level: "error",
      title: "Pi 未能接收消息",
      message: `${detail}。草稿和附件已保留。`
    });
    return { accepted: false, error: detail };
  }
}

function applyAcceptedPrompt(
  accepted: OperationSubmissionResult,
  expectedAuthority: NonNullable<ReturnType<typeof capturePromptSubmissionAuthority>>
): PromptSubmissionResult {
  const current = useAppStore.getState();
  const authorityIssue = validatePromptSubmissionAcceptance(expectedAuthority, accepted, current);
  if (authorityIssue) {
    const detail = promptSubmissionAuthorityMessage(authorityIssue);
    publishNotification({ level: "warning", title: detail, message: "草稿和附件已保留。" });
    return { accepted: false, error: detail };
  }
  if (applySettledSubmission(
    useAppStore.setState,
    accepted,
    "prompt",
    "任务已结束",
    expectedAuthority
  )) return { accepted: true, operationId: accepted.operationId, retainsAttachmentPreviews: false };

  const operation = operationFromSubmission(accepted, "prompt");
  useLiveTurnStore.getState().begin(operation, current.hostEpoch);
  useConversationStore.getState().setStreaming(true, expectedAuthority);
  useAppStore.setState({
    operation,
    operationDetail: "任务已接收",
    operationProgress: undefined,
    runtime: { phase: "busy", detail: "Pi 正在执行任务", recoverable: true }
  });
  return { accepted: true, operationId: accepted.operationId, retainsAttachmentPreviews: false };
}

function settledPromptError(result: OperationSubmissionResult): string | undefined {
  if (result.kind !== "settled" || result.lifecycle === "completed") return undefined;
  return result.lifecycle === "failed" ? result.error.message : result.reason;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
