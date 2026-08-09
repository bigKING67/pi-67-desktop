import type { AgentCommand, RequestEnvelope } from "@pi67/protocol";
import type { HostConnectionContext } from "./connection-context.js";
import { toProtocolError } from "./protocol-error.js";
import type { WorkspaceCommandRouter } from "./workspace-command-router.js";

export function handleWorkspaceReadRequest(
  origin: HostConnectionContext,
  request: RequestEnvelope,
  commands: WorkspaceCommandRouter
): boolean {
  if (request.context.scope !== "workspace") return false;
  const onError = (error: unknown) => origin.sendError(
    request.requestId,
    request.type,
    toProtocolError(error)
  );
  if (request.type === "session.catalog.query") {
    const command = { type: request.type, payload: request.payload } as AgentCommand<"session.catalog.query">;
    void commands.queryCatalog(request.context, command)
      .then((result) => origin.sendSuccess(request.requestId, request.type, result))
      .catch(onError);
    return true;
  }
  if (request.type === "session.catalog.contentSearch") {
    const command = {
      type: request.type,
      payload: request.payload
    } as AgentCommand<"session.catalog.contentSearch">;
    void commands.searchCatalogContent(request.context, command)
      .then((result) => origin.sendSuccess(request.requestId, request.type, result))
      .catch(onError);
    return true;
  }
  if (request.type !== "workspace.usage.report") return false;
  const command = { type: request.type, payload: request.payload } as AgentCommand<"workspace.usage.report">;
  void commands.usageReport(
    request.context,
    command,
    origin.signalForRequest(request.requestId)
  )
    .then((result) => origin.sendSuccess(request.requestId, request.type, result))
    .catch(onError);
  return true;
}
