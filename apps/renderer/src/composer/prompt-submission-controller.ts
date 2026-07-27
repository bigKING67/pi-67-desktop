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

export type PromptSubmissionResult =
  | { accepted: true; operationId: string }
  | { accepted: false; error: string };

export async function submitRendererPrompt(
  text: string,
  images: TransferImage[],
  behavior: "send" | "steer" | "followUp",
  submissionId: string
): Promise<PromptSubmissionResult> {
  if (!agentConnectionController.identity) throw new Error("Agent Host 尚未连接。");
  const delivery = behavior === "steer"
    ? "steer"
    : behavior === "followUp" ? "follow-up" : "new-turn";
  const state = useAppStore.getState();
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
    return applyAcceptedPrompt(accepted, expectedAuthority);
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
  )) return { accepted: true, operationId: accepted.operationId };

  const operation = operationFromSubmission(accepted, "prompt");
  useLiveTurnStore.getState().begin(operation, current.hostEpoch);
  useConversationStore.getState().setStreaming(true, expectedAuthority);
  useAppStore.setState({
    operation,
    operationDetail: "任务已接收",
    operationProgress: undefined,
    runtime: { phase: "busy", detail: "Pi 正在执行任务", recoverable: true }
  });
  return { accepted: true, operationId: accepted.operationId };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
