import type {
  SessionCatalogChangedReason,
  SessionCatalogDegradedReason,
  SessionCatalogStatus
} from "@pi67/domain";
import type { SessionCatalogContext } from "./session-catalog-contract.js";
import type { SessionCatalogIndexCoordinator } from "./session-catalog-index-coordinator.js";
import {
  clearAppliedSessionCatalogUpserts,
  mergePendingSessionCatalogUpserts,
  type PendingSessionCatalogUpsert
} from "./session-catalog-pending-upserts.js";
import {
  sortSessionCatalogRecords
} from "./session-catalog-projection.js";
import { upsertSessionCatalogRecordByIdentity } from "./session-catalog-record-identity.js";
import type { SessionCatalogRecord, SqliteSessionCatalog } from "./sqlite-session-catalog.js";

export interface SessionCatalogUpsertCoordinatorOptions {
  sqlite(): SqliteSessionCatalog | undefined;
  status(): SessionCatalogStatus;
  setStatus(status: SessionCatalogStatus): void;
  fallbackRecords(): SessionCatalogRecord[];
  setFallback(records: SessionCatalogRecord[], ready: boolean): void;
  setProjectionRecord(record: SessionCatalogRecord): void;
  contextGeneration(): number;
  reconcileActive(): boolean;
  indexes: SessionCatalogIndexCoordinator;
  applySqliteState(state: ReturnType<SqliteSessionCatalog["getState"]>): void;
  demoteSqlite(): void;
  publish(reason: SessionCatalogChangedReason): void;
  degradedReason(): SessionCatalogDegradedReason | undefined;
}

export class SessionCatalogUpsertCoordinator {
  private mutationGeneration = 0;
  private readonly pending = new Map<string, PendingSessionCatalogUpsert>();

  constructor(private readonly options: SessionCatalogUpsertCoordinatorOptions) {}

  get generation(): number {
    return this.mutationGeneration;
  }

  reset(): void {
    this.mutationGeneration += 1;
    this.pending.clear();
  }

  merge(records: SessionCatalogRecord[], maximumGeneration: number): SessionCatalogRecord[] {
    return mergePendingSessionCatalogUpserts(records, this.pending, maximumGeneration);
  }

  clearApplied(maximumGeneration: number): void {
    clearAppliedSessionCatalogUpserts(this.pending, maximumGeneration);
  }

  upsert(
    record: SessionCatalogRecord,
    context: SessionCatalogContext,
    reason: Extract<
      SessionCatalogChangedReason,
      "session-created" | "session-updated" | "session-imported"
    >
  ): void {
    const generation = ++this.mutationGeneration;
    this.pending.set(record.fileIdentity, { generation, record });
    this.options.setProjectionRecord(record);
    const contextGeneration = this.options.contextGeneration();
    if (record.explicitName === undefined) {
      this.options.indexes.enqueueAutomaticTitle(record, context, contextGeneration);
    }
    let recoveryScheduled = false;
    const sqlite = this.options.sqlite();
    const sqliteAwaitingReconcile = sqlite !== undefined && this.options.status().source !== "sqlite";
    if (sqlite && this.options.status().source === "sqlite") {
      try {
        if (sqlite.getState().sourceKey === context.sourceKey) {
          const state = sqlite.upsert(record, this.options.status().revision);
          this.options.applySqliteState(state);
          if (!this.options.reconcileActive()) this.pending.delete(record.fileIdentity);
          this.options.publish(reason);
          this.options.indexes.startContent(context, contextGeneration, [record]);
          return;
        }
      } catch {
        this.options.demoteSqlite();
        recoveryScheduled = true;
      }
    }
    const fallbackRecords = sortSessionCatalogRecords(
      upsertSessionCatalogRecordByIdentity(this.options.fallbackRecords(), record)
    );
    this.options.setFallback(fallbackRecords, true);
    this.options.setStatus({
      ...this.options.status(),
      revision: this.options.status().revision + 1,
      source: "sdk-fallback",
      state: "fallback",
      rebuilding: this.options.reconcileActive(),
      itemCount: fallbackRecords.length,
      ...degradedReason(this.options.degradedReason())
    });
    if (!this.options.reconcileActive() && !recoveryScheduled && !sqliteAwaitingReconcile) {
      this.pending.delete(record.fileIdentity);
    }
    this.options.publish(reason);
    this.options.indexes.startContent(context, contextGeneration, [record]);
  }
}

function degradedReason(reason: SessionCatalogDegradedReason | undefined) {
  return reason === undefined ? {} : { degradedReason: reason };
}
