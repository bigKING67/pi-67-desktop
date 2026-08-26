import type {
  SessionCatalogChangedReason,
  SessionCatalogStatus
} from "@pi67/domain";
import type { SessionCatalogContext } from "./session-catalog-contract.js";
import type { SessionCatalogIndexCoordinator } from "./session-catalog-index-coordinator.js";
import { sanitizeSessionCatalogDiscovery } from "./session-catalog-projection.js";
import type { SessionCatalogRecordEnricher } from "./session-catalog-record-enricher.js";
import type { SessionCatalogUpsertCoordinator } from "./session-catalog-upsert-coordinator.js";
import type {
  SessionCatalogRecord,
  SqliteCatalogState,
  SqliteSessionCatalog
} from "./sqlite-session-catalog.js";

export interface SessionCatalogReconcilerOptions {
  context: SessionCatalogContext;
  contextGeneration: number;
  reason: SessionCatalogChangedReason;
  isCurrent(): boolean;
  status(): SessionCatalogStatus;
  setStatus(status: SessionCatalogStatus): void;
  sqlite(): SqliteSessionCatalog | undefined;
  recordEnricher: SessionCatalogRecordEnricher;
  upserts: SessionCatalogUpsertCoordinator;
  indexes: SessionCatalogIndexCoordinator;
  now(): number;
  setFallback(records: SessionCatalogRecord[], ready: boolean): void;
  setProjectionRecords(records: readonly SessionCatalogRecord[]): void;
  applySqliteState(state: SqliteCatalogState): void;
  demoteSqlite(): void;
  setAutoReconciledSource(sourceKey: string): void;
  degradedReason(): SessionCatalogStatus["degradedReason"];
  publish(): void;
}

export async function runSessionCatalogReconcile(
  options: SessionCatalogReconcilerOptions
): Promise<void> {
  let discovered;
  try {
    discovered = sanitizeSessionCatalogDiscovery(await options.context.discover());
  } catch {
    if (!options.isCurrent()) return;
    options.setStatus({
      ...options.status(),
      state: options.status().itemCount > 0 ? "fallback" : "unavailable",
      rebuilding: false,
      incomplete: true
    });
    options.publish();
    return;
  }
  if (!options.isCurrent()) return;
  const appliedMutation = options.upserts.generation;
  const discoveredRecords = options.recordEnricher.withOrganizations(
    options.context.sourceKey,
    options.upserts.merge(discovered.records, appliedMutation)
  );
  const reconciledAt = options.now();
  const sqlite = options.sqlite();
  if (sqlite) {
    try {
      const records = sqlite.preserveAutomaticNames?.(
        options.context.sourceKey,
        discoveredRecords
      ) ?? discoveredRecords;
      const state = sqlite.replaceAll(
        options.context.sourceKey,
        records,
        {
          reconciledAt,
          incomplete: discovered.incomplete,
          skippedCount: discovered.skippedCount
        },
        options.status().revision
      );
      if (!options.isCurrent()) return;
      options.setFallback([], false);
      options.setProjectionRecords(records);
      options.applySqliteState(state);
      options.upserts.clearApplied(appliedMutation);
      options.publish();
      options.indexes.startAutomaticTitles(
        options.context,
        options.contextGeneration,
        records
      );
      void options.indexes.awaitAutomaticTitles(options.context, options.contextGeneration)
        .then(() => options.indexes.startContent(
          options.context,
          options.contextGeneration,
          records
        ))
        .catch(() => undefined);
      return;
    } catch {
      options.demoteSqlite();
    }
  }
  options.setFallback(discoveredRecords, true);
  options.setProjectionRecords(discoveredRecords);
  options.setStatus({
    revision: options.status().revision + 1,
    source: "sdk-fallback",
    state: "fallback",
    rebuilding: false,
    reconciledAt,
    itemCount: discoveredRecords.length,
    incomplete: discovered.incomplete,
    skippedCount: discovered.skippedCount,
    ...degradedReason(options.degradedReason())
  });
  options.setAutoReconciledSource(options.context.sourceKey);
  options.upserts.clearApplied(appliedMutation);
  options.publish();
  options.indexes.startAutomaticTitles(
    options.context,
    options.contextGeneration,
    discoveredRecords
  );
}

function degradedReason(reason: SessionCatalogStatus["degradedReason"]) {
  return reason === undefined ? {} : { degradedReason: reason };
}
