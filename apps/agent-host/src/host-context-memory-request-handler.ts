import { type AgentCommand, type RequestEnvelope } from "@pi67/protocol";
import type { HostConnectionContext } from "./connection-context.js";
import {
  isContextMemoryWorkspaceCommand,
  type ContextMemoryCommandRouter
} from "./context/context-memory-command-router.js";
import { HostCommandError, toProtocolError } from "./protocol-error.js";

export function handleContextMemoryWorkspaceRequest(
  origin: HostConnectionContext,
  request: RequestEnvelope,
  router: ContextMemoryCommandRouter
): void {
  if (!isContextMemoryWorkspaceCommand(request.type) || request.context.scope !== "workspace") {
    origin.sendError(request.requestId, request.type, toProtocolError(new HostCommandError(
      "INVALID_PAYLOAD",
      "Context and memory Workspace commands require Workspace authority.",
      false
    )));
    return;
  }
  const command = { type: request.type, payload: request.payload } as AgentCommand<typeof request.type>;
  void router.dispatchWorkspace(request.context, command, request.idempotencyKey)
    .then((result) => origin.sendSuccess(request.requestId, request.type, result as never))
    .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
}
