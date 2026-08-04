import type { DatabaseLike } from "./sqlite-session-catalog-schema.js";

export interface SessionCatalogOrganization {
  pinnedAt?: number;
  archivedAt?: number;
}

export function organizeSqliteSessionCatalog(
  database: DatabaseLike,
  path: string,
  organization: SessionCatalogOrganization,
  minimumRevision: number,
  readRevision: () => number
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const revision = Math.max(readRevision(), minimumRevision) + 1;
    database.prepare(`
      UPDATE sessions SET pinned_at_ms = ?, archived_at_ms = ? WHERE path = ?
    `).run(organization.pinnedAt ?? null, organization.archivedAt ?? null, path);
    database.prepare(`
      UPDATE catalog_state SET revision = ? WHERE singleton = 1
    `).run(revision);
    database.exec("COMMIT");
  } catch (error) {
    rollback(database);
    throw error;
  }
}

function rollback(database: DatabaseLike): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Preserve the original organization mutation failure.
  }
}
