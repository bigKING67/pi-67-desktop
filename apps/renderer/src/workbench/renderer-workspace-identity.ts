import type { WorkspaceDescriptor, WorkspaceId } from "@pi67/domain";

interface RendererWorkspaceRegistry {
  workspaces: Record<WorkspaceId, WorkspaceDescriptor>;
}

export function workspaceIdForCanonicalPath(
  state: RendererWorkspaceRegistry,
  canonicalPath: string
): WorkspaceId | undefined {
  return Object.values(state.workspaces).find((workspace) => (
    workspace.identity.canonicalPath === canonicalPath
  ))?.id;
}

export function rendererWorkspaceId(path: string): WorkspaceId {
  let hash = 0x811c9dc5;
  for (const codePoint of path) {
    hash ^= codePoint.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `workspace-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
