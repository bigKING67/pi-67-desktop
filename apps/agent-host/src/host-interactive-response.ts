import type { AgentRuntime } from "@pi67/pi-runtime";
import type { AgentCommand } from "@pi67/protocol";
import type { OperationRegistry } from "./operation-registry.js";
import { HostCommandError } from "./protocol-error.js";

type InteractiveResponsePayload = Extract<
  AgentCommand,
  { type: "extension.ui.respond" | "approval.respond" }
>["payload"];

export function completeInteractiveResponse(
  requestId: string,
  resolved: boolean,
  completeInteractiveWait: (requestId: string) => void
): { resolved: boolean } {
  if (resolved) completeInteractiveWait(requestId);
  return { resolved };
}

export function assertInteractiveResponseContext(
  runtime: AgentRuntime,
  operations: OperationRegistry,
  payload: InteractiveResponsePayload
): void {
  const identity = runtime.getIdentity();
  if (
    identity.sessionId !== payload.sessionId
    || identity.sessionGeneration !== payload.sessionGeneration
  ) {
    throw new HostCommandError(
      "STALE_SESSION_GENERATION",
      "The extension UI response belongs to a stale session generation.",
      true,
      {
        expectedSessionGeneration: identity.sessionGeneration,
        receivedSessionGeneration: payload.sessionGeneration
      }
    );
  }

  if (
    payload.operationId === undefined
    && "toolCallId" in payload
    && runtime.hasPendingSubagentApproval(payload.requestId, payload.toolCallId)
  ) return;

  const activeOperation = operations.activeView();
  if (activeOperation?.operationId !== payload.operationId) {
    throw new HostCommandError(
      "STALE_OPERATION",
      "The extension UI response does not belong to the active operation.",
      true,
      { activeOperation: activeOperation !== undefined }
    );
  }
}
