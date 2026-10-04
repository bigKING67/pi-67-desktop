import { MAX_RUNNING_TASKS, type SessionRecoveryView } from "@pi67/domain";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useAppStore } from "../app/app-store.js";
import { operationFromSubmission } from "../app/app-state-projection.js";
import { applySettledSubmission } from "../app/operation-submission.js";
import { promptSubmissionAuthorityMessage, validatePromptSubmissionAcceptance } from "../app/prompt-submission-authority.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { acceptRendererSessionResponse, currentRendererSessionAuthority } from "./session-authority.js";
import { rendererWorkbenchStore, selectedWorkbenchTask } from "../workbench/workbench-store.js";

export async function inspectRendererInterruptedTask(): Promise<SessionRecoveryView | undefined> {
  const authority = currentRendererSessionAuthority(useAppStore.getState());
  if (!authority) return undefined;
  const view = await agentConnectionController.request("session.recovery.inspect", {});
  return acceptRendererSessionResponse(useAppStore.getState(), authority) ? view : undefined;
}

export async function continueRendererInterruptedTask(anchor: string, submissionId: string): Promise<void> {
  const authority = currentRendererSessionAuthority(useAppStore.getState());
  if (!authority || useAppStore.getState().runtime.phase !== "ready") throw new Error("当前会话尚未就绪，请等待恢复完成。");
  const workbench = rendererWorkbenchStore.getState();
  const task = selectedWorkbenchTask(workbench);
  if (task && workbench.canStartTask(task.id) === "run-limit") {
    throw new Error(`已有 ${MAX_RUNNING_TASKS} 个会话任务正在运行或等待交互。请先完成或停止一个任务。`);
  }
  const result = await agentConnectionController.request("session.recovery.continue", { anchor, submissionId });
  const issue = validatePromptSubmissionAcceptance(authority, result, useAppStore.getState());
  if (issue) throw new Error(promptSubmissionAuthorityMessage(issue));
  if (applySettledSubmission(useAppStore.setState, result, "prompt", "任务续接已结束", authority)) {
    if (result.lifecycle === "failed") throw new Error(result.error.message);
    if (result.lifecycle === "cancelled" || result.lifecycle === "lost") throw new Error(result.reason);
    return;
  }
  const operation = operationFromSubmission(result, "prompt");
  useLiveTurnStore.getState().begin(operation, result.hostEpoch);
  useConversationStore.getState().setStreaming(true, authority);
  useAppStore.setState({
    operation,
    operationDetail: "继续当前任务已接收",
    operationProgress: undefined,
    runtime: { phase: "busy", detail: "Pi 正在继续当前任务", recoverable: true }
  });
}
