import { createMessageId, type CommandDescriptor, type OperationSubmissionResult } from "@pi67/protocol";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { publishNotification } from "../notifications/notification-store.js";
import {
  acceptRendererSessionResponse,
  currentRendererSessionAuthority,
  type RendererSessionAuthority
} from "../session/session-authority.js";
import { useAppStore } from "../app/app-store.js";
import { operationFromSubmission } from "../app/app-state-projection.js";
import { applySettledSubmission } from "../app/operation-submission.js";

export async function abortActiveOperation(): Promise<void> {
  const operationId = useAppStore.getState().operation?.operationId;
  if (!operationId) return;
  try {
    await agentConnectionController.request("operation.abort", { operationId });
  } catch (error) {
    publishActionError(error, "无法停止当前任务");
  }
}

export async function compactRendererSession(): Promise<void> {
  try {
    const authority = requireSessionAuthority();
    const accepted = await agentConnectionController.request("session.compact", {
      submissionId: createMessageId("compaction")
    });
    if (!acceptSubmission(accepted, authority, "上下文压缩确认已过期")) return;
    if (applySettledSubmission(
      useAppStore.setState,
      accepted,
      "compaction",
      "上下文压缩已结束",
      authority
    )) return;
    useAppStore.setState({
      operation: operationFromSubmission(accepted, "compaction"),
      operationDetail: "正在压缩上下文",
      operationProgress: undefined
    });
  } catch (error) {
    publishActionError(error, "无法启动会话压缩");
  }
}

export async function listRuntimeCommands(): Promise<CommandDescriptor[]> {
  if (!agentConnectionController.identity) throw new Error("Pi 运行服务尚未连接。");
  return agentConnectionController.request("command.list", {});
}

export async function invokeRuntimeCommand(command: string): Promise<void> {
  try {
    const authority = requireSessionAuthority();
    const accepted = await agentConnectionController.request("command.invoke", {
      submissionId: createMessageId("command"),
      command
    });
    if (!acceptSubmission(accepted, authority, `命令 /${command} 确认已过期`)) return;
    if (applySettledSubmission(
      useAppStore.setState,
      accepted,
      "command",
      `命令 /${command} 已结束`,
      authority
    )) return;
    useAppStore.setState({
      operation: operationFromSubmission(accepted, "command"),
      operationDetail: `命令 /${command} 已接收`,
      operationProgress: undefined
    });
  } catch (error) {
    publishActionError(error, "无法执行 Pi 命令");
  }
}

function requireSessionAuthority(): RendererSessionAuthority {
  const authority = currentRendererSessionAuthority(useAppStore.getState());
  if (!authority) throw new Error("Pi 会话身份尚未就绪。");
  return authority;
}

function acceptSubmission(
  accepted: OperationSubmissionResult,
  authority: RendererSessionAuthority,
  warningTitle: string
): boolean {
  const current = useAppStore.getState();
  if (
    accepted.hostEpoch === authority.hostEpoch
    && accepted.sessionId === authority.sessionId
    && accepted.sessionGeneration === authority.sessionGeneration
    && acceptRendererSessionResponse(current, authority)
  ) return true;
  publishNotification({
    level: "warning",
    title: warningTitle,
    message: "Pi 运行服务或会话已在请求期间替换，旧确认已忽略。"
  });
  return false;
}

function publishActionError(error: unknown, title: string): void {
  publishNotification({ level: "error", title, message: errorMessage(error) });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
