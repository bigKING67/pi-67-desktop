import { scanSessionUsage } from "@pi67/pi-runtime";
import type { AgentCommand, CommandResults, WorkspaceProtocolContext } from "@pi67/protocol";
import { HostCommandError } from "./protocol-error.js";
import type { WorkspaceContextRegistry } from "./workspace-context-registry.js";

type CatalogPage = Awaited<ReturnType<WorkspaceContextRegistry["queryCatalog"]>>;

export async function createWorkspaceUsageReport(
  workspaces: WorkspaceContextRegistry,
  context: WorkspaceProtocolContext,
  command: AgentCommand<"workspace.usage.report">,
  signal?: AbortSignal
): Promise<CommandResults["workspace.usage.report"]> {
  const sessions = new Map<string, CatalogPage["items"][number]>();
  let discoveredSessions = 0;
  let catalogIncomplete = false;
  let catalogSkippedCount = 0;
  for (const view of ["active", "archived"] as const) {
    let cursor: CatalogPage["nextCursor"];
    let firstPage = true;
    do {
      if (signal?.aborted) {
        throw new HostCommandError("CONNECTION_CLOSED", "Usage scan was cancelled.", true);
      }
      const page = await workspaces.queryCatalog(context.workspaceId, {
        scope: "workspace",
        view,
        limit: 100,
        ...(cursor === undefined ? {} : { cursor })
      });
      if (firstPage) {
        discoveredSessions += page.total;
        catalogSkippedCount += page.skippedCount;
        catalogIncomplete ||= page.incomplete || page.rebuilding || page.state === "unavailable";
        firstPage = false;
      }
      for (const session of page.items) sessions.set(session.fileIdentity, session);
      cursor = page.nextCursor;
    } while (cursor !== undefined && sessions.size < 500);
    if (cursor !== undefined) catalogIncomplete = true;
  }
  return scanSessionUsage({
    workspaceId: context.workspaceId,
    sessions: [...sessions.values()],
    discoveredSessions,
    catalogIncomplete,
    catalogSkippedCount,
    window: command.payload.window,
    ...(signal === undefined ? {} : { signal })
  });
}
