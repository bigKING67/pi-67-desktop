import type { AgentCommand, AgentCommandType, CommandResults, RequestEnvelope } from "@pi67/protocol";
import type { HostConnectionContext } from "../connection-context.js";
import { HostCommandError, toProtocolError } from "../protocol-error.js";
import { isImageCommand, UnavailableImageCommands, type ImageCommandExecutor } from "./image-command-router.js";

const unavailable = new UnavailableImageCommands();

/** Routes Workspace-scoped image commands; returns false for anything else. */
export function handleImageRequest(origin: HostConnectionContext, request: RequestEnvelope, router: ImageCommandExecutor = unavailable): boolean {
  if (!isImageCommand(request.type)) return false;
  if (request.context.scope !== "workspace") {
    origin.sendError(request.requestId, request.type, toProtocolError(new HostCommandError("INVALID_PAYLOAD", "Image commands require Workspace authority.", false)));
    return true;
  }
  const command = { type: request.type, payload: request.payload } as AgentCommand<typeof request.type>;
  void router.execute(request.context.workspaceId, command, origin.signalForRequest(request.requestId))
    .then((result) => origin.sendSuccess(request.requestId, request.type, result as CommandResults[AgentCommandType] as never))
    .catch((error: unknown) => origin.sendError(request.requestId, request.type, toProtocolError(error)));
  return true;
}
