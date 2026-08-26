import type {
  SessionCatalogStatus,
  WorkspaceMessageSearchResult
} from "@pi67/domain";
import type { SessionCatalogContext } from "./session-catalog-contract.js";
import type { SessionCatalogIndexCoordinator } from "./session-catalog-index-coordinator.js";
import { sessionCatalogSummaryFromRecord } from "./session-catalog-projection.js";
import { searchIndexedSessionContent } from "./session-content-index.js";
import { searchWorkspaceSessionContent } from "./session-content-search.js";
import {
  supportsSessionContentIndex,
  type SessionCatalogRecord,
  type SqliteSessionCatalog
} from "./sqlite-session-catalog.js";

export interface SessionCatalogContentSearchOptions {
  workspaceId: string;
  workspaceKey: string;
  query: string;
  context: SessionCatalogContext;
  contextGeneration: number;
  records: readonly SessionCatalogRecord[];
  status: SessionCatalogStatus;
  sqlite: SqliteSessionCatalog | undefined;
  indexes: SessionCatalogIndexCoordinator;
  projectionRecord(fileIdentity: string): SessionCatalogRecord | undefined;
  signal?: AbortSignal;
}

export async function searchSessionCatalogContent(
  options: SessionCatalogContentSearchOptions
): Promise<WorkspaceMessageSearchResult> {
  const { sqlite } = options;
  if (sqlite && options.status.source === "sqlite" && supportsSessionContentIndex(sqlite)) {
    try {
      options.indexes.startContent(options.context, options.contextGeneration, options.records);
      await awaitWithSignal(
        options.indexes.awaitContent(options.context, options.contextGeneration),
        options.signal
      );
      const outcome = await searchIndexedSessionContent({
        workspaceId: options.workspaceId,
        workspaceKey: options.workspaceKey,
        query: options.query,
        records: options.records,
        catalogIncomplete: options.status.incomplete || options.status.rebuilding,
        catalogSkippedCount: options.status.skippedCount,
        sqlite,
        ...(options.signal === undefined ? {} : { signal: options.signal })
      });
      for (const fileIdentity of outcome.staleFileIdentities) {
        sqlite.removeContentIndex(fileIdentity);
        const record = options.projectionRecord(fileIdentity);
        if (record) options.indexes.enqueueContent(record);
      }
      if (outcome.staleFileIdentities.length > 0) {
        options.indexes.startContent(options.context, options.contextGeneration, []);
      }
      const { staleFileIdentities: _stale, ...result } = outcome;
      return result;
    } catch (error) {
      if (options.signal?.aborted) throw error;
    }
  }
  const fallback = await searchWorkspaceSessionContent({
    workspaceId: options.workspaceId,
    query: options.query,
    sessions: options.records.map(sessionCatalogSummaryFromRecord),
    catalogTotal: options.records.length,
    catalogIncomplete: true,
    catalogSkippedCount: options.status.skippedCount,
    ...(options.signal === undefined ? {} : { signal: options.signal })
  });
  return { ...fallback, incomplete: true };
}

function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException("Session content search was cancelled.", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(
      new DOMException("Session content search was cancelled.", "AbortError")
    );
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
