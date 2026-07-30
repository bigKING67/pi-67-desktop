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
import { messages } from "../localization/message-catalog.js";

export async function abortActiveOperation(): Promise<void> {
  const operationId = useAppStore.getState().operation?.operationId;
  if (!operationId) return;
  try {
    await agentConnectionController.request("operation.abort", { operationId });
  } catch (error) {
    publishActionError(error, messages.operation.abortFailedTitle);
  }
}

export async function compactRendererSession(): Promise<void> {
  try {
    const authority = requireSessionAuthority();
    const accepted = await agentConnectionController.request("session.compact", {
      submissionId: createMessageId("compaction")
    });
    if (!acceptSubmission(accepted, authority, messages.operation.compactionAcknowledgementStale)) return;
    if (applySettledSubmission(
      useAppStore.setState,
      accepted,
      "compaction",
      messages.operation.compactionSettled,
      authority
    )) return;
    useAppStore.setState({
      operation: operationFromSubmission(accepted, "compaction"),
      operationDetail: messages.operation.compactionStarting,
      operationProgress: undefined
    });
  } catch (error) {
    publishActionError(error, messages.operation.compactionStartFailedTitle);
  }
}

export async function listRuntimeCommands(): Promise<CommandDescriptor[]> {
  if (!agentConnectionController.identity) throw new Error(messages.operation.runtimeDisconnected);
  return agentConnectionController.request("command.list", {});
}

export async function invokeRuntimeCommand(command: string): Promise<void> {
  try {
    const authority = requireSessionAuthority();
    const accepted = await agentConnectionController.request("command.invoke", {
      submissionId: createMessageId("command"),
      command
    });
    if (!acceptSubmission(accepted, authority, messages.operation.commandAcknowledgementStale(command))) return;
    if (applySettledSubmission(
      useAppStore.setState,
      accepted,
      "command",
      messages.operation.commandSettled(command),
      authority
    )) return;
    useAppStore.setState({
      operation: operationFromSubmission(accepted, "command"),
      operationDetail: messages.operation.commandAccepted(command),
      operationProgress: undefined
    });
  } catch (error) {
    publishActionError(error, messages.operation.commandFailedTitle);
  }
}

function requireSessionAuthority(): RendererSessionAuthority {
  const authority = currentRendererSessionAuthority(useAppStore.getState());
  if (!authority) throw new Error(messages.operation.sessionAuthorityUnavailable);
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
    message: messages.operation.staleAcknowledgement
  });
  return false;
}

function publishActionError(error: unknown, title: string): void {
  publishNotification({ level: "error", title, message: errorMessage(error) });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : messages.runtime.unknownError;
}
