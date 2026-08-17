import {
  MAX_RUNNING_TASKS,
  type ComposerWorkspaceFileRef
} from "@pi67/domain";
import type { OperationSubmissionResult } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import {
  useConversationStore,
  type PendingUserAttachment
} from "../conversation/conversation-store.js";
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
import { promptTextValidationMessage } from "./prompt-text-validation.js";

export type PromptSubmissionResult =
  | { accepted: true; operationId: string; retainsAttachmentPreviews: boolean; terminalError?: string }
  | { accepted: false; error: string };

export async function submitRendererPrompt(
  text: string,
  behavior: "send" | "steer" | "followUp",
  submissionId: string,
  attachments: readonly PendingUserAttachment[] = [],
  workspaceFiles: readonly ComposerWorkspaceFileRef[] = []
): Promise<PromptSubmissionResult> {
  const validationError = promptTextValidationMessage(text);
  if (validationError) {
    publishNotification({
      level: "warning",
      title: "消息过长",
      message: `${validationError} 草稿和附件已保留。`
    });
    return { accepted: false, error: validationError };
  }
  if (!agentConnectionController.identity) throw new Error("Pi 运行服务尚未连接。");
  const delivery = behavior === "steer"
    ? "steer"
    : behavior === "followUp" ? "follow-up" : "new-turn";
  const state = useAppStore.getState();
  const workbench = rendererWorkbenchStore.getState();
  const selectedTaskId = selectedWorkbenchTask(workbench)?.id;
  if (selectedTaskId && workbench.canStartTask(selectedTaskId) === "run-limit") {
    const detail = `已有 ${MAX_RUNNING_TASKS} 个会话任务正在运行或等待交互。请先完成或停止一个任务。`;
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
      ...(attachments.length === 0
        ? {}
        : { attachments: attachments.map((attachment) => ({ id: attachment.id })) }),
      ...(workspaceFiles.length === 0
        ? {}
        : { workspaceFiles: workspaceFiles.map(({ id, revision }) => ({ id, revision })) }),
      delivery
    });
    const result = applyAcceptedPrompt(accepted, expectedAuthority);
    const taskStillSelected = selectedTaskId !== undefined
      && selectedWorkbenchTask(rendererWorkbenchStore.getState())?.id === selectedTaskId;
    const terminalFailure = settledPromptFailure(accepted);
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
          parts: [
            ...(text ? [{ type: "text" as const, text }] : []),
            ...attachments.flatMap((attachment) => {
              if (attachment.kind === "image") return [];
              return [{
                type: "attachment" as const,
                id: attachment.id,
                name: attachment.name,
                mimeType: attachment.mimeType,
                byteLength: attachment.byteLength,
                kind: attachment.kind
              }];
            })
          ],
          createdAt: Date.now(),
          ...(terminalFailure === undefined
            ? {}
            : { error: `发送失败：${terminalFailure.message}` })
        },
        attachments: attachments.map((attachment) => ({ ...attachment })),
        workspaceFiles: workspaceFiles.map((file) => ({ ...file })),
        status: terminalFailure === undefined ? "accepted" : "failed",
        ...(terminalFailure?.retryableVisionAssistance
          ? { retryableVisionAssistance: true as const }
          : {})
      });
    if (result.accepted && selectedTaskId) {
      const preview = userMessagePreview(text, attachments.length > 0);
      rendererWorkbenchStore.getState().updateTask(selectedTaskId, {
        lifecycle: "accepted",
        pendingTitle: undefined,
        ...(preview ? { recentUserMessagePreview: preview } : {})
      });
    }
    return result.accepted
      ? {
          ...result,
          retainsAttachmentPreviews,
          ...(terminalFailure === undefined ? {} : { terminalError: terminalFailure.message })
        }
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

export async function retryPendingVisualAssistance(): Promise<boolean> {
  const pending = useConversationStore.getState().pendingUserTurn;
  if (pending?.status !== "failed" || !pending.retryableVisionAssistance) return false;
  const text = pending.message.parts.flatMap((part) => (
    part.type === "text" ? [part.text] : []
  )).join("\n");
  const result = await submitRendererPrompt(
    text,
    "send",
    crypto.randomUUID(),
    pending.attachments,
    pending.workspaceFiles ?? []
  );
  return result.accepted;
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

function settledPromptFailure(result: OperationSubmissionResult): {
  message: string;
  retryableVisionAssistance: boolean;
} | undefined {
  if (result.kind !== "settled" || result.lifecycle === "completed") return undefined;
  return result.lifecycle === "failed"
    ? {
        message: result.error.message,
        retryableVisionAssistance: result.error.details?.phase === "vision-assistance"
      }
    : { message: result.reason, retryableVisionAssistance: false };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
