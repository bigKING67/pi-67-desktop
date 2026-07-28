import type { ApprovalRequestView } from "@pi67/domain";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import {
  hasCurrentInteractiveAuthority,
  type InteractiveAuthorityState
} from "../connection/interactive-authority.js";
import { recoverInteractiveResponseTimeout } from "../connection/interactive-response-timeout-recovery.js";
import { publishNotification } from "../notifications/notification-store.js";
import { useApprovalStore } from "./approval-store.js";

export async function respondToSafetyApproval(
  getAuthority: () => InteractiveAuthorityState,
  requestId: string,
  allowed: boolean
): Promise<boolean> {
  const request = useApprovalStore.getState().requests.find(
    (candidate) => candidate.requestId === requestId
  );
  const payload = request ? approvalResponsePayload(getAuthority(), request, allowed) : undefined;
  if (!request || !payload) {
    if (request) useApprovalStore.getState().removeRequestIfCurrent(request);
    publishNotification({
      level: "warning",
      title: "工具授权请求已过期",
      message: "π 未向 Pi 运行服务发送响应，操作将保持阻止。"
    });
    return false;
  }

  try {
    const result = await agentConnectionController.request("approval.respond", payload);
    useApprovalStore.getState().removeRequestIfCurrent(request);
    if (result.resolved) return true;
    publishNotification({
      level: "warning",
      title: "工具授权请求已过期",
      message: "Pi 运行服务未接受这次授权响应，工具将保持阻止状态。"
    });
    return false;
  } catch (error) {
    if (request.hostEpoch !== undefined && await recoverInteractiveResponseTimeout(error, {
      kind: "approval",
      hostEpoch: request.hostEpoch,
      ...(request.operationId === undefined ? {} : { operationId: request.operationId })
    })) return false;
    publishNotification({
      level: "error",
      title: allowed ? "无法提交本次授权" : "无法提交拒绝结果",
      message: `${errorMessage(error)}。授权请求仍保留，可以重试。`
    });
    return false;
  }
}

export function approvalResponsePayload(
  state: InteractiveAuthorityState,
  request: ApprovalRequestView,
  allowed: boolean
) {
  if (
    request.sessionId === undefined
    || request.sessionGeneration === undefined
    || request.operationId === undefined
    || request.hostEpoch === undefined
    || !hasCurrentInteractiveAuthority(state, request)
  ) return undefined;

  return {
    requestId: request.requestId,
    toolCallId: request.toolCallId,
    sessionId: request.sessionId,
    sessionGeneration: request.sessionGeneration,
    operationId: request.operationId,
    allowed
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Pi 运行服务连接异常";
}
