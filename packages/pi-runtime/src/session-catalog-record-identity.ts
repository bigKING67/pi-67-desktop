import type { SessionCatalogRecord } from "./sqlite-session-catalog.js";

export class SessionCatalogIdentityConflictError extends Error {
  readonly code = "SESSION_CATALOG_IDENTITY_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "SessionCatalogIdentityConflictError";
  }
}

export function assertSessionCatalogRecordSetConsistency(records: readonly SessionCatalogRecord[]): void {
  const byIdentity = new Map<string, SessionCatalogRecord>();
  const byPath = new Map<string, SessionCatalogRecord>();
  for (const record of records) {
    const identityOwner = byIdentity.get(record.fileIdentity);
    if (identityOwner) {
      throw new SessionCatalogIdentityConflictError(
        identityOwner.id === record.id
          ? "The Session Catalog contains duplicate locators for one physical Session."
          : "One physical Session carries contradictory Pi Session IDs."
      );
    }
    const pathOwner = byPath.get(record.path);
    if (pathOwner && pathOwner.fileIdentity !== record.fileIdentity) {
      throw new SessionCatalogIdentityConflictError(
        "One Session locator resolves to multiple physical Sessions."
      );
    }
    byIdentity.set(record.fileIdentity, record);
    byPath.set(record.path, record);
  }
}

export function upsertSessionCatalogRecordByIdentity(
  records: readonly SessionCatalogRecord[],
  next: SessionCatalogRecord
): SessionCatalogRecord[] {
  const byIdentity = new Map(records.map((record) => [record.fileIdentity, record]));
  const identityOwner = byIdentity.get(next.fileIdentity);
  if (identityOwner && identityOwner.id !== next.id) {
    throw new SessionCatalogIdentityConflictError(
      "One physical Session carries contradictory Pi Session IDs."
    );
  }
  for (const [fileIdentity, record] of byIdentity) {
    if (fileIdentity !== next.fileIdentity && record.path === next.path) byIdentity.delete(fileIdentity);
  }
  byIdentity.set(next.fileIdentity, next);
  return [...byIdentity.values()];
}
