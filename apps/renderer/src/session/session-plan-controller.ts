import type { SessionInteractionMode } from "@pi67/domain";
import type {
  OperationSubmissionResult,
  ProjectionMutationAcknowledgement
} from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { useConversationStore } from "../conversation/conversation-store.js";
import { useLiveTurnStore } from "../live-turn/live-turn-store.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useAppStore } from "../app/app-store.js";
import { operationFromSubmission } from "../app/app-state-projection.js";
import { applySettledSubmission } from "../app/operation-submission.js";
import {
  promptSubmissionAuthorityMessage,
  validatePromptSubmissionAcceptance
} from "../app/prompt-submission-authority.js";
import {
  acceptRendererSessionResponse,
  currentRendererSessionAuthority,
  type RendererSessionAuthority
} from "./session-authority.js";
import { useSessionProjectionStore } from "./session-projection-store.js";

interface InteractionModeFlight {
  mode: SessionInteractionMode;
  promise: Promise<boolean>;
}

export type RendererPlanImplementationResult =
  | { accepted: true; operationId: string }
  | { accepted: false; error: string };

let interactionModeFlight: InteractionModeFlight | undefined;

export function setRendererSessionInteractionMode(
  mode: SessionInteractionMode
): Promise<boolean> {
  const authority = currentRendererSessionAuthority(useAppStore.getState());
  if (!authority) {
    publishPlanError("无法切换交互模式", "当前 Pi 会话尚未就绪。", "warning");
    return Promise.resolve(false);
  }
  if (useSessionProjectionStore.getState().interaction?.interactionMode === mode) {
    return Promise.resolve(true);
  }
  if (interactionModeFlight) {
    return interactionModeFlight.mode === mode
      ? interactionModeFlight.promise
      : Promise.resolve(false);
  }

  let promise!: Promise<boolean>;
  promise = performInteractionModeChange(authority, mode).finally(() => {
    if (interactionModeFlight?.promise === promise) interactionModeFlight = undefined;
  });
  interactionModeFlight = { mode, promise };
  return promise;
}

export async function implementRendererPlan(
  planId: string,
  submissionId: string
): Promise<RendererPlanImplementationResult> {
  const expectedAuthority = currentRendererSessionAuthority(useAppStore.getState());
  if (!expectedAuthority) {
    return rejectPlanImplementation("Pi 会话身份尚未就绪，计划未开始执行");
  }
  try {
    const result = await agentConnectionController.request("plan.implement", {
      submissionId,
      planId
    });
    const authorityIssue = validatePromptSubmissionAcceptance(
      expectedAuthority,
      result,
      useAppStore.getState()
    );
    if (authorityIssue) {
      return rejectPlanImplementation(promptSubmissionAuthorityMessage(authorityIssue));
    }
    return applyPlanImplementation(result, expectedAuthority);
  } catch (error) {
    return rejectPlanImplementation(errorMessage(error));
  }
}

async function performInteractionModeChange(
  authority: RendererSessionAuthority,
  mode: SessionInteractionMode
): Promise<boolean> {
  try {
    const acknowledgement = await agentConnectionController.request(
      "session.interactionMode.set",
      { mode }
    );
    if (
      !acceptRendererSessionResponse(useAppStore.getState(), authority)
      || !acknowledgementMatchesAuthority(acknowledgement, authority)
    ) return false;

    const store = useSessionProjectionStore.getState();
    if (store.interaction?.interactionMode !== mode) {
      store.applyInteractionMode(authority, mode);
    }
    return useSessionProjectionStore.getState().interaction?.interactionMode === mode;
  } catch (error) {
    publishPlanError("无法切换交互模式", errorMessage(error));
    return false;
  }
}

function applyPlanImplementation(
  result: OperationSubmissionResult,
  authority: RendererSessionAuthority
): RendererPlanImplementationResult {
  if (applySettledSubmission(
    useAppStore.setState,
    result,
    "prompt",
    "计划执行已结束",
    authority
  )) {
    if (result.lifecycle === "failed") {
      return { accepted: false, error: result.error.message };
    }
    if (result.lifecycle === "cancelled" || result.lifecycle === "lost") {
      return { accepted: false, error: result.reason };
    }
    return { accepted: true, operationId: result.operationId };
  }

  const operation = operationFromSubmission(result, "prompt");
  useLiveTurnStore.getState().begin(operation, result.hostEpoch);
  useConversationStore.getState().setStreaming(true, authority);
  useAppStore.setState({
    operation,
    operationDetail: "计划执行任务已接收",
    operationProgress: undefined,
    runtime: { phase: "busy", detail: "Pi 正在按计划执行", recoverable: true }
  });
  return { accepted: true, operationId: result.operationId };
}

function acknowledgementMatchesAuthority(
  acknowledgement: ProjectionMutationAcknowledgement,
  authority: RendererSessionAuthority
): boolean {
  return acknowledgement.hostEpoch === authority.hostEpoch
    && acknowledgement.sessionId === authority.sessionId
    && acknowledgement.sessionFileIdentity === authority.sessionFileIdentity
    && acknowledgement.sessionGeneration === authority.sessionGeneration;
}

function rejectPlanImplementation(error: string): RendererPlanImplementationResult {
  publishPlanError("无法开始执行计划", error);
  return { accepted: false, error };
}

function publishPlanError(
  title: string,
  message: string,
  level: "error" | "warning" = "error"
): void {
  publishNotification({ level, title, message });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Pi 运行服务连接异常";
}
