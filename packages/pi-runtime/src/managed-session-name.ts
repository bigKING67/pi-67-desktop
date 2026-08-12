import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionNameMutation } from "@pi67/protocol";
import { resolveManagedSessionPath } from "./session-import.js";
import {
  normalizeSessionCatalogWorkspaceIdentity,
  resolveExistingSessionFileIdentity
} from "./session-path-identity.js";
import type { SessionCatalogRecord } from "./sqlite-session-catalog.js";

export async function mutateManagedSessionName(options: {
  path: string;
  cwd: string;
  agentDir: string;
  mutation: SessionNameMutation;
}): Promise<SessionCatalogRecord> {
  const path = await resolveManagedSessionPath(options.path, options.cwd, options.agentDir);
  const manager = SessionManager.open(path, dirname(path));
  manager.appendSessionInfo(options.mutation.action === "set" ? options.mutation.name : "");
  const file = await stat(path);
  const header = manager.getHeader();
  const explicitName = manager.getSessionName()?.trim() || undefined;
  return {
    fileIdentity: await resolveExistingSessionFileIdentity(path),
    id: manager.getSessionId(),
    path,
    cwd: manager.getCwd(),
    cwdKey: normalizeSessionCatalogWorkspaceIdentity(manager.getCwd()),
    ...(explicitName === undefined ? {} : { explicitName }),
    modifiedAt: Math.max(0, Math.trunc(file.mtimeMs)),
    messageCount: manager.getEntries().filter((entry) => entry.type === "message").length,
    ...(header?.parentSession === undefined ? {} : { parentSessionPath: header.parentSession })
  };
}
