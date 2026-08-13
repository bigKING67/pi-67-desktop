import { realpath } from "node:fs/promises";
import * as systemPath from "node:path";
import { normalizeSessionCatalogWorkspaceIdentity } from "../../packages/pi-runtime/src/session-path-identity.ts";

export async function resolveRealUserWorkspaceAuthority(
  window,
  selectedWorkspace,
  expectedWorkspaceCwd
) {
  const observation = await window.evaluate(async () => {
    const state = await window.pi67.system.loadWorkbenchState();
    const current = state.currentWorkspaceId
      ? state.workspaces.find((candidate) => candidate.id === state.currentWorkspaceId)
      : undefined;
    return {
      canonicalPath: current?.identity.canonicalPath ?? null,
      availability: current?.availability ?? null,
      workspaceCount: state.workspaces.length
    };
  });
  if (
    observation.workspaceCount !== 1
    || observation.availability !== "available"
    || typeof observation.canonicalPath !== "string"
    || observation.canonicalPath.length === 0
  ) {
    throw new Error("Windows real-user launch did not expose one available Main Workspace authority.");
  }
  const [selectedPhysicalPath, authorityPhysicalPath] = await Promise.all([
    realpath(systemPath.resolve(selectedWorkspace)),
    realpath(systemPath.resolve(observation.canonicalPath))
  ]);
  if (
    normalizeSessionCatalogWorkspaceIdentity(selectedPhysicalPath)
    !== normalizeSessionCatalogWorkspaceIdentity(authorityPhysicalPath)
  ) {
    throw new Error("Windows real-user Main Workspace authority resolved to a different directory.");
  }
  if (expectedWorkspaceCwd !== undefined && observation.canonicalPath !== expectedWorkspaceCwd) {
    throw new Error("Windows real-user restart changed the persisted Main Workspace authority spelling.");
  }
  return observation.canonicalPath;
}
