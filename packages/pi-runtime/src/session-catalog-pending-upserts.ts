import { sortSessionCatalogRecords } from "./session-catalog-projection.js";
import { SessionCatalogIdentityConflictError } from "./session-catalog-record-identity.js";
import type { SessionCatalogRecord } from "./sqlite-session-catalog.js";

export interface PendingSessionCatalogUpsert {
  generation: number;
  record: SessionCatalogRecord;
}

export function mergePendingSessionCatalogUpserts(
  discovered: SessionCatalogRecord[],
  pendingUpserts: ReadonlyMap<string, PendingSessionCatalogUpsert>,
  appliedMutation: number
): SessionCatalogRecord[] {
  const records = new Map(discovered.map((record) => [record.fileIdentity, record]));
  for (const pending of pendingUpserts.values()) {
    if (pending.generation > appliedMutation) continue;
    const discoveredRecord = records.get(pending.record.fileIdentity);
    if (discoveredRecord && discoveredRecord.id !== pending.record.id) {
      throw new SessionCatalogIdentityConflictError(
        "One physical Session carries contradictory Pi Session IDs."
      );
    }
    if (!discoveredRecord || isPendingRecordCurrent(pending.record, discoveredRecord)) {
      for (const [identity, record] of records) {
        if (identity !== pending.record.fileIdentity && record.path === pending.record.path) {
          records.delete(identity);
        }
      }
      records.set(pending.record.fileIdentity, pending.record);
    }
  }
  return sortSessionCatalogRecords([...records.values()]);
}

export function clearAppliedSessionCatalogUpserts(
  pendingUpserts: Map<string, PendingSessionCatalogUpsert>,
  appliedMutation: number
): void {
  for (const [fileIdentity, pending] of pendingUpserts) {
    if (pending.generation <= appliedMutation) pendingUpserts.delete(fileIdentity);
  }
}

function isPendingRecordCurrent(pending: SessionCatalogRecord, discovered: SessionCatalogRecord): boolean {
  return pending.modifiedAt > discovered.modifiedAt
    || (pending.modifiedAt === discovered.modifiedAt && pending.messageCount >= discovered.messageCount);
}
