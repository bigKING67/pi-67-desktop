import {
  MAX_WORKSPACE_CHANGES,
  type WorkspaceChangesProjection,
  type WorkspaceChangeView
} from "@pi67/domain";

export function upsertWorkspaceChange(
  projection: WorkspaceChangesProjection | undefined,
  sessionId: string,
  change: WorkspaceChangeView
): WorkspaceChangesProjection {
  if (!projection || projection.sessionId !== sessionId) {
    return { sessionId, items: [change], truncated: false, total: 1 };
  }
  const existingIndex = projection.items.findIndex((item) => item.toolCallId === change.toolCallId);
  if (existingIndex >= 0) {
    const items = projection.items.slice();
    items[existingIndex] = change;
    return { ...projection, items };
  }
  const nextItems = [...projection.items, change];
  const overflow = Math.max(0, nextItems.length - MAX_WORKSPACE_CHANGES);
  return {
    ...projection,
    items: overflow === 0 ? nextItems : nextItems.slice(overflow),
    total: projection.total + 1,
    truncated: projection.truncated || overflow > 0
  };
}
