import { type AgentCommand, type RequestEnvelope } from "@pi67/protocol";
import type { HostConnectionContext } from "./connection-context.js";
import { isContextFileCommand, type ContextFileCommandRouter } from "./context-file-command-router.js";
import { HostCommandError, toProtocolError } from "./protocol-error.js";

export function handleContextFileRequest(
  origin: HostConnectionContext,
  request: RequestEnvelope,
  router: ContextFileCommandRouter
): void {
  if (!isContextFileCommand(request.type) || request.context.scope !== "workspace") {
    origin.sendError(request.requestId, request.type, toProtocolError(new HostCommandError(
      "INVALID_PAYLOAD",
      "Context file commands require Workspace authority.",
      false
    )));
    return;
  }
  const command = { type: request.type, payload: request.payload } as AgentCommand<typeof request.type>;
  void router.dispatch(request.context, command, request.idempotencyKey)
    .then((result) => origin.sendSuccess(request.requestId, request.type, result as never))
    .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
}
