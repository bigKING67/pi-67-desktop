import type { AgentCommand, AgentCommandType, RequestEnvelope } from "@pi67/protocol";
import type { HostConnectionContext } from "./connection-context.js";
import { toProtocolError } from "./protocol-error.js";
import type { WorkspaceCommandRouter } from "./workspace-command-router.js";
import type { WorkspaceUsageReportCoordinator } from "./workspace-usage-report-coordinator.js";

type WorkspaceReadCommandType =
  | "session.catalog.query"
  | "session.catalog.contentSearch"
  | "workspace.usage.report";

function isWorkspaceReadCommand(type: AgentCommandType): type is WorkspaceReadCommandType {
  return type === "session.catalog.query"
    || type === "session.catalog.contentSearch"
    || type === "workspace.usage.report";
}

export function handleWorkspaceReadRequest(
  origin: HostConnectionContext,
  request: RequestEnvelope,
  commands: WorkspaceCommandRouter,
  usageReports: WorkspaceUsageReportCoordinator
): boolean {
  if (request.context.scope !== "workspace") return false;
  if (!isWorkspaceReadCommand(request.type)) return false;
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
    void commands.searchCatalogContent(request.context, command, origin.signalForRequest(request.requestId))
      .then((result) => origin.sendSuccess(request.requestId, request.type, result))
      .catch(onError);
    return true;
  }
  const command = { type: request.type, payload: request.payload } as AgentCommand<"workspace.usage.report">;
  void usageReports.request(
    request.context,
    command,
    origin.signalForRequest(request.requestId)
  )
    .then((result) => origin.sendSuccess(request.requestId, request.type, result))
    .catch(onError);
  return true;
}
