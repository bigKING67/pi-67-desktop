import { sortSessionCatalogRecords } from "./session-catalog-projection.js";
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
  const records = new Map(discovered.map((record) => [record.path, record]));
  for (const pending of pendingUpserts.values()) {
    if (pending.generation > appliedMutation) continue;
    const discoveredRecord = records.get(pending.record.path);
    if (!discoveredRecord || isPendingRecordCurrent(pending.record, discoveredRecord)) {
      records.set(pending.record.path, pending.record);
    }
  }
  return sortSessionCatalogRecords([...records.values()]);
}

export function clearAppliedSessionCatalogUpserts(
  pendingUpserts: Map<string, PendingSessionCatalogUpsert>,
  appliedMutation: number
): void {
  for (const [path, pending] of pendingUpserts) {
    if (pending.generation <= appliedMutation) pendingUpserts.delete(path);
  }
}

function isPendingRecordCurrent(pending: SessionCatalogRecord, discovered: SessionCatalogRecord): boolean {
  return pending.modifiedAt > discovered.modifiedAt
    || (pending.modifiedAt === discovered.modifiedAt && pending.messageCount >= discovered.messageCount);
}
