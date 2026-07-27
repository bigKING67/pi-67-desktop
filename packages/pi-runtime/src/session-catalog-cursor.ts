import { createHash } from "node:crypto";
import { RuntimeError, type SessionCatalogCursor, type SessionCatalogScope } from "@pi67/domain";

export function createSessionCatalogQueryKey(
  sourceKey: string,
  workspaceKey: string,
  scope: SessionCatalogScope,
  normalizedSearch: string
): string {
  return createHash("sha256").update(JSON.stringify([
    "session-catalog-query-v1",
    sourceKey,
    workspaceKey,
    scope,
    normalizedSearch,
    "modified-at-desc-path-binary-desc-v1"
  ])).digest("hex");
}

export function assertSessionCatalogCursor(
  cursor: SessionCatalogCursor | undefined,
  currentRevision: number,
  queryKey: string
): void {
  if (!cursor) return;
  if (cursor.revision === currentRevision && cursor.queryKey === queryKey) return;
  throw new RuntimeError(
    "STALE_SESSION_CATALOG",
    "The Session Catalog cursor no longer matches the active query.",
    {
      details: {
        currentRevision,
        reason: cursor.revision === currentRevision ? "query-mismatch" : "revision-mismatch"
      }
    }
  );
}
