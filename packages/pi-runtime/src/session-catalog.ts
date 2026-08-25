import {
  RuntimeError,
  type SessionCatalogChangedEvent,
  type SessionCatalogChangedReason,
  type SessionCatalogDegradedReason,
  type SessionCatalogPage,
  type SessionCatalogQuery,
  type SessionCatalogStatus,
  type WorkspaceMessageSearchResult
} from "@pi67/domain";
import { assertSessionCatalogCursor, createSessionCatalogQueryKey } from "./session-catalog-cursor.js";
import {
  clearAppliedSessionCatalogUpserts,
  mergePendingSessionCatalogUpserts,
  type PendingSessionCatalogUpsert
} from "./session-catalog-pending-upserts.js";
import {
  createBoundedSessionCatalogPage,
  normalizeSessionCatalogSearch,
  querySessionCatalogFallback,
  sanitizeSessionCatalogDiscovery,
  sanitizeSessionCatalogRecord,
  sessionCatalogSummaryFromRecord,
  sortSessionCatalogRecords,
  validateSessionCatalogContext,
  validateSessionCatalogQuery,
  type SessionCatalogDiscoveryResult,
  type ValidatedSessionCatalogQuery
} from "./session-catalog-projection.js";
import {
  indexSessionContentRecords,
  searchIndexedSessionContent
} from "./session-content-index.js";
import { searchWorkspaceSessionContent } from "./session-content-search.js";
import { normalizeSessionCatalogWorkspaceIdentity } from "./session-path-identity.js";
import { upsertSessionCatalogRecordByIdentity } from "./session-catalog-record-identity.js";
import type { CreateSessionCatalogOptions, SessionCatalog, SessionCatalogContext } from "./session-catalog-contract.js";
import {
  SessionCatalogRecordEnricher,
  type SessionCatalogOrganizationMutation
} from "./session-catalog-record-enricher.js";
import { SessionCatalogAutomaticTitlePublisher } from "./session-catalog-automatic-title-publisher.js";
import {
  organizeSessionCatalogRecord,
  reorderPinnedSessionCatalogRecords,
  type SessionCatalogOrganizationHost
} from "./session-catalog-organization.js";
import { SessionCatalogSqliteLifecycle } from "./session-catalog-sqlite-lifecycle.js";
import {
  openSqliteSessionCatalog,
  supportsSessionContentIndex,
  type SessionCatalogRecord,
  type SqliteSessionCatalog
} from "./sqlite-session-catalog.js";
export type { SessionCatalogDiscoveryResult } from "./session-catalog-projection.js";
export type { CreateSessionCatalogOptions, SessionCatalog, SessionCatalogContext } from "./session-catalog-contract.js";
interface ReconcileFlight {
  sourceKey: string;
  contextGeneration: number;
  promise: Promise<void>;
}
interface AutomaticTitleFlight {
  sourceKey: string;
  contextGeneration: number;
  promise: Promise<void>;
}
interface ContentIndexFlight {
  sourceKey: string;
  contextGeneration: number;
  promise: Promise<void>;
}
const AUTOMATIC_TITLE_WORKERS = 4;
const MAX_AUTOMATIC_TITLE_BATCH = 16;
export function createSessionCatalog(options: CreateSessionCatalogOptions = {}): SessionCatalog {
  return new DefaultSessionCatalog(options);
}
class DefaultSessionCatalog implements SessionCatalog {
  private activeSourceKey: string | undefined;
  private activeWorkspaceKey = "";
  private readonly sqliteLifecycle: SessionCatalogSqliteLifecycle;
  private fallbackRecords: SessionCatalogRecord[] = [];
  private fallbackReady = false;
  private reconcileFlight: ReconcileFlight | undefined;
  private automaticTitleFlight: AutomaticTitleFlight | undefined;
  private contentIndexFlight: ContentIndexFlight | undefined;
  private automaticTitleActiveReads = 0;
  private automaticTitleCapacity: Promise<void> | undefined;
  private releaseAutomaticTitleCapacity: (() => void) | undefined;
  private readonly pendingAutomaticTitleRecords = new Map<string, SessionCatalogRecord>();
  private readonly pendingContentIndexRecords = new Map<string, SessionCatalogRecord>();
  private readonly pendingAutomaticTitleUpdates = new Map<string, {
    record: SessionCatalogRecord;
    automaticName: string;
    automaticNameSource: "generated" | "seed";
    context: SessionCatalogContext;
    contextGeneration: number;
  }>();
  private automaticTitleBatch: Promise<void> | undefined;
  private autoReconciledSource: string | undefined;
  private activeContext: SessionCatalogContext | undefined;
  private contextGeneration = 0;
  private mutationGeneration = 0;
  private readonly pendingUpserts = new Map<string, PendingSessionCatalogUpsert>();
  private readonly projectionRecords = new Map<string, SessionCatalogRecord>();
  private contextPreparation: Promise<void> = Promise.resolve();
  private disposed = false;
  private current: SessionCatalogStatus = {
    revision: 0,
    source: "sdk-fallback",
    state: "unavailable",
    rebuilding: false,
    itemCount: 0,
    incomplete: true,
    skippedCount: 0
  };
  private readonly onChanged: ((event: SessionCatalogChangedEvent) => void) | undefined;
  private readonly now: () => number;
  private readonly recordEnricher: SessionCatalogRecordEnricher;
  private readonly automaticTitlePublisher = new SessionCatalogAutomaticTitlePublisher();
  constructor(options: CreateSessionCatalogOptions) {
    this.onChanged = options.onChanged;
    this.now = options.now ?? (() => Date.now());
    this.recordEnricher = new SessionCatalogRecordEnricher(options.storageRoot, options.automaticTitleReader);
    this.sqliteLifecycle = new SessionCatalogSqliteLifecycle(
      options.directory,
      options.storageRoot,
      options.openSqlite ?? openSqliteSessionCatalog,
      this.now
    );
  }
  private get sqlite(): SqliteSessionCatalog | undefined {
    return this.sqliteLifecycle.catalog;
  }
  query(query: SessionCatalogQuery, context: SessionCatalogContext): Promise<SessionCatalogPage> {
    const validated = validateSessionCatalogQuery(query);
    return this.withPreparedContext(context, async (contextGeneration) => {
      const queryKey = createSessionCatalogQueryKey(
        context.sourceKey,
        this.activeWorkspaceKey,
        validated.scope,
        validated.view ?? "active",
        normalizeSessionCatalogSearch(validated.search ?? "")
      );
      assertSessionCatalogCursor(validated.cursor, this.current.revision, queryKey);
      let requestedReconcile: Promise<void> | undefined;
      if (validated.refresh || this.autoReconciledSource !== context.sourceKey) {
        this.autoReconciledSource = context.sourceKey;
        requestedReconcile = this.startReconcile(context, "reconciled", contextGeneration);
        void requestedReconcile.catch(() => undefined);
      }
      if (normalizeSessionCatalogSearch(validated.search ?? "").length > 0) {
        await (requestedReconcile ?? (this.hasReadableProjection() ? undefined : this.reconcileFlight?.promise));
        await this.awaitAutomaticTitleIndex(context, contextGeneration);
      }
      assertSessionCatalogCursor(validated.cursor, this.current.revision, queryKey);
      const result = this.readProjection(validated);
      assertSessionCatalogCursor(validated.cursor, this.current.revision, queryKey);
      const page = createBoundedSessionCatalogPage(
        result, this.current, validated.limit, queryKey
      );
      return page;
    });
  }
  searchContent(
    workspaceId: string,
    query: string,
    context: SessionCatalogContext,
    signal?: AbortSignal
  ): Promise<WorkspaceMessageSearchResult> {
    return this.withPreparedContext(context, async (contextGeneration) => {
      const requestedReconcile = this.autoReconciledSource !== context.sourceKey
        ? this.startReconcile(context, "reconciled", contextGeneration)
        : undefined;
      await (requestedReconcile ?? (this.hasReadableProjection() ? undefined : this.reconcileFlight?.promise));
      await this.awaitAutomaticTitleIndex(context, contextGeneration);
      const records = sortSessionCatalogRecords([...this.projectionRecords.values()].filter((record) => (
        record.cwdKey === this.activeWorkspaceKey && record.archivedAt === undefined
      )));
      const sqlite = this.sqlite;
      if (sqlite && this.current.source === "sqlite" && supportsSessionContentIndex(sqlite)) {
        try {
          this.startContentIndex(context, contextGeneration, records);
          await awaitWithSignal(this.awaitContentIndex(context, contextGeneration), signal);
          const outcome = await searchIndexedSessionContent({
            workspaceId,
            workspaceKey: this.activeWorkspaceKey,
            query,
            records,
            catalogIncomplete: this.current.incomplete || this.current.rebuilding,
            catalogSkippedCount: this.current.skippedCount,
            sqlite,
            ...(signal === undefined ? {} : { signal })
          });
          for (const fileIdentity of outcome.staleFileIdentities) {
            sqlite.removeContentIndex(fileIdentity);
            const record = this.projectionRecords.get(fileIdentity);
            if (record) this.pendingContentIndexRecords.set(fileIdentity, record);
          }
          if (outcome.staleFileIdentities.length > 0) {
            this.startContentIndex(context, contextGeneration, []);
          }
          const { staleFileIdentities: _stale, ...result } = outcome;
          return result;
        } catch (error) {
          if (signal?.aborted) throw error;
        }
      }
      const fallback = await searchWorkspaceSessionContent({
        workspaceId,
        query,
        sessions: records.map(sessionCatalogSummaryFromRecord),
        catalogTotal: records.length,
        catalogIncomplete: true,
        catalogSkippedCount: this.current.skippedCount,
        ...(signal === undefined ? {} : { signal })
      });
      return { ...fallback, incomplete: true };
    });
  }
  status(): SessionCatalogStatus {
    return { ...this.current };
  }
  reconcile(
    context: SessionCatalogContext,
    reason: SessionCatalogChangedReason = "reconciled"
  ): Promise<void> {
    return this.withPreparedContext(context, (contextGeneration) => {
      this.autoReconciledSource = context.sourceKey;
      return this.startReconcile(context, reason, contextGeneration);
    });
  }
  async upsert(
    record: SessionCatalogRecord,
    context: SessionCatalogContext,
    reason: Extract<SessionCatalogChangedReason, "session-created" | "session-updated" | "session-imported">
  ): Promise<void> {
    return this.withPreparedContext(context, (contextGeneration) => {
      const safe = sanitizeSessionCatalogRecord(this.recordEnricher.withOrganization(context.sourceKey, record));
      if (!safe || !this.isCurrentContext(context, contextGeneration)) return;
      this.upsertPrepared(safe, context, reason);
    });
  }
  organize(
    path: string,
    mutation: SessionCatalogOrganizationMutation,
    context: SessionCatalogContext
  ): Promise<number> {
    return this.withPreparedContext(context, (generation) => organizeSessionCatalogRecord(
      this.organizationHost(), path, mutation, context, generation
    ));
  }
  reorderPinned(paths: readonly string[], context: SessionCatalogContext): Promise<number> {
    return this.withPreparedContext(context, (generation) => reorderPinnedSessionCatalogRecords(
      this.organizationHost(), paths, context, generation
    ));
  }
  private organizationHost(): SessionCatalogOrganizationHost {
    return {
      recordEnricher: this.recordEnricher,
      now: this.now,
      current: () => this.current,
      sqlite: () => this.sqlite,
      isCurrentContext: (context, generation) => this.isCurrentContext(context, generation),
      readProjection: (query) => this.readProjection(query),
      applySqliteState: (state) => this.applySqliteState(state, false),
      demoteSqlite: () => this.demoteSqlite(true),
      fallbackRecords: () => this.fallbackRecords,
      commitFallback: (records) => {
        this.fallbackRecords = records;
        this.current = { ...this.current, revision: this.current.revision + 1 };
      },
      publish: () => this.publish("conversation-organized")
    };
  }
  private upsertPrepared(
    safe: SessionCatalogRecord,
    context: SessionCatalogContext,
    reason: Extract<SessionCatalogChangedReason, "session-created" | "session-updated" | "session-imported">
  ): void {
    const generation = ++this.mutationGeneration;
    this.pendingUpserts.set(safe.fileIdentity, { generation, record: safe });
    this.projectionRecords.set(safe.fileIdentity, safe);
    if (safe.explicitName === undefined) this.enqueueAutomaticTitleRecord(safe, context, this.contextGeneration);
    let recoveryScheduled = false;
    const sqliteAwaitingReconcile = this.sqlite !== undefined && this.current.source !== "sqlite";
    if (this.sqlite && this.current.source === "sqlite") {
      try {
        if (this.sqlite.getState().sourceKey === context.sourceKey) {
          const state = this.sqlite.upsert(safe, this.current.revision);
          this.applySqliteState(state, false);
          if (!this.reconcileFlight) this.pendingUpserts.delete(safe.fileIdentity);
          this.publish(reason);
          this.startContentIndex(context, this.contextGeneration, [safe]);
          return;
        }
      } catch {
        this.demoteSqlite(true);
        recoveryScheduled = true;
      }
    }
    this.fallbackRecords = sortSessionCatalogRecords(
      upsertSessionCatalogRecordByIdentity(this.fallbackRecords, safe)
    );
    this.fallbackReady = true;
    this.current = {
      ...this.current,
      revision: this.current.revision + 1,
      source: "sdk-fallback",
      state: "fallback",
      rebuilding: this.reconcileFlight !== undefined,
      itemCount: this.fallbackRecords.length,
      ...degradedReason(this.sqliteLifecycle.degradedReason)
    };
    if (!this.reconcileFlight && !recoveryScheduled && !sqliteAwaitingReconcile) this.pendingUpserts.delete(safe.fileIdentity);
    this.publish(reason);
    this.startContentIndex(context, this.contextGeneration, [safe]);
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.contextGeneration += 1;
    this.reconcileFlight = undefined;
    this.automaticTitleFlight = undefined;
    this.contentIndexFlight = undefined;
    this.pendingAutomaticTitleRecords.clear();
    this.pendingContentIndexRecords.clear();
    this.pendingAutomaticTitleUpdates.clear();
    this.sqliteLifecycle.close();
    this.fallbackRecords = [];
    this.projectionRecords.clear();
    this.pendingUpserts.clear();
    this.automaticTitlePublisher.dispose();
    this.recordEnricher.clear();
    this.activeContext = undefined;
  }

  private withPreparedContext<T>(
    context: SessionCatalogContext,
    action: (contextGeneration: number) => T
  ): Promise<Awaited<T>> {
    const preparation = this.contextPreparation.then(async () => ({
      result: action(await this.prepareContextSerially(context))
    }));
    this.contextPreparation = preparation.then(() => undefined, () => undefined);
    return preparation.then(({ result }) => result) as Promise<Awaited<T>>;
  }
  private async prepareContextSerially(context: SessionCatalogContext): Promise<number> {
    this.assertNotDisposed();
    validateSessionCatalogContext(context);
    await this.recordEnricher.initialize();
    await this.ensureSqlite();
    this.assertNotDisposed();
    this.activeContext = context;
    if (this.activeSourceKey === context.sourceKey) {
      this.activeWorkspaceKey = normalizeSessionCatalogWorkspaceIdentity(context.workspaceCwd);
      return this.contextGeneration;
    }
    const changed = this.activeSourceKey !== undefined;
    if (changed && this.reconcileFlight?.sourceKey !== context.sourceKey) {
      // Pi discovery is not abortable. Detach stale work so the active source never waits for it.
      this.reconcileFlight = undefined;
    }
    if (changed) {
      this.automaticTitleFlight = undefined;
      this.contentIndexFlight = undefined;
      this.pendingAutomaticTitleRecords.clear();
      this.pendingContentIndexRecords.clear();
      this.pendingAutomaticTitleUpdates.clear();
      this.automaticTitlePublisher.dispose();
    }
    this.activeSourceKey = context.sourceKey;
    this.contextGeneration += 1;
    this.activeWorkspaceKey = normalizeSessionCatalogWorkspaceIdentity(context.workspaceCwd);
    this.fallbackRecords = [];
    this.projectionRecords.clear();
    this.fallbackReady = false;
    this.autoReconciledSource = undefined;
    this.mutationGeneration += 1;
    this.pendingUpserts.clear();
    let sqliteState: ReturnType<SqliteSessionCatalog["getState"]> | undefined;
    try {
      sqliteState = this.sqlite?.getState();
    } catch {
      this.demoteSqlite(true);
    }
    if (sqliteState?.sourceKey === context.sourceKey) {
      this.applySqliteState(sqliteState, false, changed ? this.current.revision + 1 : undefined);
    } else {
      this.current = {
        revision: Math.max(this.current.revision + 1, (sqliteState?.revision ?? 0) + 1),
        source: this.sqlite ? "sqlite" : "sdk-fallback",
        state: "rebuilding",
        rebuilding: true,
        itemCount: 0,
        incomplete: true,
        skippedCount: 0,
        ...degradedReason(this.sqlite ? undefined : this.sqliteLifecycle.degradedReason)
      };
    }
    if (changed) this.publish("source-changed");
    return this.contextGeneration;
  }
  private startReconcile(
    context: SessionCatalogContext,
    reason: SessionCatalogChangedReason,
    contextGeneration: number
  ): Promise<void> {
    if (!this.isCurrentContext(context, contextGeneration)) return Promise.resolve();
    const existing = this.reconcileFlight;
    if (existing?.sourceKey === context.sourceKey && existing.contextGeneration === contextGeneration) {
      return existing.promise;
    }
    if (existing) this.reconcileFlight = undefined;
    // Reconciliation replaces the record version set; old title callbacks are
    // detached and additionally rejected by their physical-version check.
    this.automaticTitleFlight = undefined;
    this.contentIndexFlight = undefined;
    this.pendingAutomaticTitleRecords.clear();
    this.pendingContentIndexRecords.clear();
    this.pendingAutomaticTitleUpdates.clear();
    this.current = { ...this.current, state: "rebuilding", rebuilding: true };
    const promise = this.runReconcile(context, reason, contextGeneration).finally(() => {
      if (this.reconcileFlight?.promise === promise) this.reconcileFlight = undefined;
    });
    this.reconcileFlight = { sourceKey: context.sourceKey, contextGeneration, promise };
    return promise;
  }
  private async runReconcile(
    context: SessionCatalogContext,
    reason: SessionCatalogChangedReason,
    contextGeneration: number
  ): Promise<void> {
    let discovered: SessionCatalogDiscoveryResult;
    try {
      discovered = sanitizeSessionCatalogDiscovery(await context.discover());
    } catch {
      if (!this.isCurrentContext(context, contextGeneration)) return;
      this.current = {
        ...this.current,
        state: this.current.itemCount > 0 ? "fallback" : "unavailable",
        rebuilding: false,
        incomplete: true
      };
      this.publish(reason);
      return;
    }
    if (!this.isCurrentContext(context, contextGeneration)) return;
    const appliedMutation = this.mutationGeneration;
    const discoveredRecords = this.recordEnricher.withOrganizations(
      context.sourceKey,
      mergePendingSessionCatalogUpserts(discovered.records, this.pendingUpserts, appliedMutation)
    );
    const reconciledAt = this.now();
    if (this.sqlite) {
      try {
        const records = this.sqlite.preserveAutomaticNames?.(context.sourceKey, discoveredRecords) ?? discoveredRecords;
        const state = this.sqlite.replaceAll(
          context.sourceKey,
          records,
          { reconciledAt, incomplete: discovered.incomplete, skippedCount: discovered.skippedCount },
          this.current.revision
        );
        if (!this.isCurrentContext(context, contextGeneration)) return;
        this.fallbackRecords = [];
        this.fallbackReady = false;
        this.setProjectionRecords(records);
        this.applySqliteState(state, false);
        clearAppliedSessionCatalogUpserts(this.pendingUpserts, appliedMutation);
        this.publish(reason);
        this.startAutomaticTitleIndex(context, contextGeneration, records);
        void this.awaitAutomaticTitleIndex(context, contextGeneration)
          .then(() => this.startContentIndex(context, contextGeneration, records))
          .catch(() => undefined);
        return;
      } catch {
        this.demoteSqlite(false);
      }
    }
    this.fallbackRecords = discoveredRecords;
    this.fallbackReady = true;
    this.setProjectionRecords(discoveredRecords);
    this.current = {
      revision: this.current.revision + 1,
      source: "sdk-fallback",
      state: "fallback",
      rebuilding: false,
      reconciledAt,
      itemCount: discoveredRecords.length,
      incomplete: discovered.incomplete,
      skippedCount: discovered.skippedCount,
      ...degradedReason(this.sqliteLifecycle.degradedReason)
    };
    this.autoReconciledSource = context.sourceKey;
    clearAppliedSessionCatalogUpserts(this.pendingUpserts, appliedMutation);
    this.publish(reason);
    this.startAutomaticTitleIndex(context, contextGeneration, discoveredRecords);
  }
  private readProjection(query: ValidatedSessionCatalogQuery) {
    if (this.sqlite && this.current.source === "sqlite") {
      try {
        const state = this.sqlite.getState();
        if (state.sourceKey === this.activeSourceKey) {
          return this.sqlite.query({
            scope: query.scope,
            view: query.view ?? "active",
            cwdKey: this.activeWorkspaceKey,
            ...(query.search === undefined ? {} : { search: normalizeSessionCatalogSearch(query.search) }),
            ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
            limit: query.limit
          });
        }
      } catch {
        this.demoteSqlite(true);
      }
    }
    if (!this.fallbackReady) return { records: [], total: 0, hasMore: false };
    return querySessionCatalogFallback(this.fallbackRecords, this.activeWorkspaceKey, query);
  }
  private hasReadableProjection(): boolean {
    if (this.sqlite && this.current.source === "sqlite") {
      try {
        return this.sqlite.getState().sourceKey === this.activeSourceKey;
      } catch {
        return false;
      }
    }
    return this.fallbackReady;
  }
  private async ensureSqlite(): Promise<void> {
    const lifecycleGeneration = this.contextGeneration;
    const opened = await this.sqliteLifecycle.ensure(() => (
      !this.disposed && lifecycleGeneration === this.contextGeneration
    ));
    if (opened) this.autoReconciledSource = undefined;
  }
  private applySqliteState(
    state: ReturnType<SqliteSessionCatalog["getState"]>,
    rebuilding: boolean,
    minimumRevision?: number
  ): void {
    this.current = {
      revision: Math.max(state.revision, minimumRevision ?? state.revision),
      source: "sqlite",
      state: rebuilding ? "rebuilding" : "ready",
      rebuilding,
      ...(state.reconciledAt === undefined ? {} : { reconciledAt: state.reconciledAt }),
      itemCount: state.itemCount,
      incomplete: state.incomplete,
      skippedCount: state.skippedCount
    };
  }
  private demoteSqlite(scheduleReconcile: boolean): void {
    this.sqliteLifecycle.demote();
    this.autoReconciledSource = undefined;
    this.fallbackRecords = [];
    this.projectionRecords.clear();
    this.fallbackReady = false;
    const context = this.activeContext;
    const contextGeneration = this.contextGeneration;
    this.current = {
      ...this.current,
      revision: this.current.revision + 1,
      source: "sdk-fallback",
      state: context ? "rebuilding" : "unavailable",
      rebuilding: context !== undefined,
      itemCount: 0,
      incomplete: true,
      degradedReason: "runtime-query"
    };
    this.publish("source-changed");
    if (!scheduleReconcile || !context) return;
    queueMicrotask(() => {
      if (!this.isCurrentContext(context, contextGeneration)) return;
      this.autoReconciledSource = context.sourceKey;
      void this.startReconcile(context, "reconciled", contextGeneration).catch(() => undefined);
    });
  }
  private publish(reason: SessionCatalogChangedReason): void {
    if (!this.disposed) this.onChanged?.({ revision: this.current.revision, reason });
  }
  private scheduleAutomaticTitlePublish(context: SessionCatalogContext, contextGeneration: number): void {
    this.automaticTitlePublisher.schedule(
      () => this.isCurrentContext(context, contextGeneration),
      () => this.publish("automatic-title")
    );
  }
  private startContentIndex(
    context: SessionCatalogContext,
    contextGeneration: number,
    records: readonly SessionCatalogRecord[]
  ): void {
    if (!this.isCurrentContext(context, contextGeneration)
      || !this.sqlite
      || !supportsSessionContentIndex(this.sqlite)
      || this.current.source !== "sqlite") return;
    for (const record of records) this.pendingContentIndexRecords.set(record.fileIdentity, record);
    const existing = this.contentIndexFlight;
    if (existing?.sourceKey === context.sourceKey && existing.contextGeneration === contextGeneration) return;
    const batch = [...this.pendingContentIndexRecords.values()];
    this.pendingContentIndexRecords.clear();
    if (batch.length === 0) return;
    const sqlite = this.sqlite;
    const promise = indexSessionContentRecords({
      records: batch,
      sqlite,
      isCurrent: (record) => {
        const current = this.projectionRecords.get(record.fileIdentity);
        return this.isCurrentContext(context, contextGeneration)
          && current !== undefined
          && sameSessionCatalogRecordVersion(current, record);
      }
    }).catch(() => undefined).finally(() => {
      if (this.contentIndexFlight?.promise !== promise) return;
      this.contentIndexFlight = undefined;
      if (this.pendingContentIndexRecords.size > 0 && this.isCurrentContext(context, contextGeneration)) {
        this.startContentIndex(context, contextGeneration, []);
      }
    });
    this.contentIndexFlight = { sourceKey: context.sourceKey, contextGeneration, promise };
  }
  private async awaitContentIndex(context: SessionCatalogContext, contextGeneration: number): Promise<void> {
    while (this.isCurrentContext(context, contextGeneration)) {
      const flight = this.contentIndexFlight;
      if (flight?.sourceKey === context.sourceKey && flight.contextGeneration === contextGeneration) {
        await flight.promise;
        continue;
      }
      if (this.pendingContentIndexRecords.size > 0) {
        this.startContentIndex(context, contextGeneration, []);
        continue;
      }
      return;
    }
  }
  private async awaitAutomaticTitleIndex(context: SessionCatalogContext, contextGeneration: number): Promise<void> {
    while (this.isCurrentContext(context, contextGeneration)) {
      const flight = this.automaticTitleFlight;
      if (flight?.sourceKey === context.sourceKey && flight.contextGeneration === contextGeneration) {
        await flight.promise;
        continue;
      }
      if (this.automaticTitleBatch) {
        await this.automaticTitleBatch;
        continue;
      }
      if (this.pendingAutomaticTitleUpdates.size > 0) {
        this.scheduleAutomaticTitleBatch();
        continue;
      }
      if (this.pendingAutomaticTitleRecords.size > 0) {
        this.startAutomaticTitleIndex(context, contextGeneration, []);
        continue;
      }
      return;
    }
  }
  private startAutomaticTitleIndex(
    context: SessionCatalogContext,
    contextGeneration: number,
    records: readonly SessionCatalogRecord[]
  ): void {
    if (!this.isCurrentContext(context, contextGeneration)) return;
    const existing = this.automaticTitleFlight;
    if (existing?.sourceKey === context.sourceKey && existing.contextGeneration === contextGeneration) return;
    if (!records.some((record) => record.explicitName === undefined && record.automaticName === undefined)
      && this.pendingAutomaticTitleRecords.size === 0) return;
    let next = 0;
    const worker = async () => {
      while (this.isCurrentContext(context, contextGeneration)) {
        const record = records[next++] ?? this.takePendingAutomaticTitleRecord();
        if (!record) return;
        if (record.explicitName !== undefined || record.automaticName !== undefined) continue;
        const outcome = await this.readAutomaticTitleBounded(record.path, context, contextGeneration);
        if (!outcome) return;
        if (!this.isCurrentContext(context, contextGeneration)) return;
        if (outcome.kind === "failed") {
          this.markAutomaticTitleReadFailure(record, context, contextGeneration);
        } else if (outcome.kind === "title") {
          this.queueAutomaticTitleUpdate(record, outcome.title, outcome.source ?? "seed", context, contextGeneration);
        }
      }
    };
    const promise = Promise.all(Array.from({ length: AUTOMATIC_TITLE_WORKERS }, worker)).then(() => undefined).finally(() => {
      if (this.automaticTitleFlight?.promise === promise) {
        this.automaticTitleFlight = undefined;
        if (this.pendingAutomaticTitleRecords.size > 0 && this.isCurrentContext(context, contextGeneration)) {
          this.startAutomaticTitleIndex(context, contextGeneration, []);
        }
      }
    });
    this.automaticTitleFlight = { sourceKey: context.sourceKey, contextGeneration, promise };
  }
  private queueAutomaticTitleUpdate(
    record: SessionCatalogRecord,
    automaticName: string,
    automaticNameSource: "generated" | "seed",
    context: SessionCatalogContext,
    contextGeneration: number
  ): void {
    this.pendingAutomaticTitleUpdates.set(record.fileIdentity, {
      record,
      automaticName,
      automaticNameSource,
      context,
      contextGeneration
    });
    this.scheduleAutomaticTitleBatch();
  }
  private scheduleAutomaticTitleBatch(): void {
    if (this.automaticTitleBatch || this.pendingAutomaticTitleUpdates.size === 0) return;
    let batch!: Promise<void>;
    batch = new Promise<void>((resolve) => queueMicrotask(resolve))
      .then(() => {
        while (this.pendingAutomaticTitleUpdates.size > 0) this.flushAutomaticTitleUpdateBatch();
      })
      .finally(() => {
        if (this.automaticTitleBatch === batch) this.automaticTitleBatch = undefined;
        if (!this.disposed && this.pendingAutomaticTitleUpdates.size > 0) this.scheduleAutomaticTitleBatch();
      });
    this.automaticTitleBatch = batch;
  }
  private flushAutomaticTitleUpdateBatch(): void {
    const updates = [...this.pendingAutomaticTitleUpdates.values()].slice(0, MAX_AUTOMATIC_TITLE_BATCH);
    for (const update of updates) this.pendingAutomaticTitleUpdates.delete(update.record.fileIdentity);
    if (updates.length === 0) return;
    const applicableUpdates = updates.flatMap(({
      record,
      automaticName,
      automaticNameSource,
      context,
      contextGeneration
    }) => {
      const current = this.projectionRecords.get(record.fileIdentity);
      if (!this.isCurrentContext(context, contextGeneration) || !current
        || !sameSessionCatalogRecordVersion(current, record) || current.explicitName !== undefined
        || (current.automaticName === automaticName && current.automaticNameSource === automaticNameSource)) return [];
      return [{ record: { ...current, automaticName, automaticNameSource }, context, contextGeneration }];
    });
    if (applicableUpdates.length === 0) return;
    const context = applicableUpdates[0]!.context;
    const contextGeneration = applicableUpdates[0]!.contextGeneration;
    const currentUpdates = applicableUpdates.map((update) => update.record);
    if (this.sqlite && this.current.source === "sqlite") {
      try {
        const state = this.sqlite.upsertMany(currentUpdates, this.current.revision);
        if (!this.isCurrentContext(context, contextGeneration)) return;
        for (const record of currentUpdates) this.projectionRecords.set(record.fileIdentity, record);
        this.applySqliteState(state, false);
        this.scheduleAutomaticTitlePublish(context, contextGeneration);
        return;
      } catch {
        this.demoteSqlite(true);
        return;
      }
    }
    if (!this.fallbackReady) return;
    this.fallbackRecords = sortSessionCatalogRecords(this.fallbackRecords.map((candidate) => (
      currentUpdates.find((record) => record.fileIdentity === candidate.fileIdentity) ?? candidate
    )));
    for (const record of currentUpdates) this.projectionRecords.set(record.fileIdentity, record);
    this.current = {
      ...this.current,
      revision: this.current.revision + 1,
      itemCount: this.fallbackRecords.length
    };
    this.scheduleAutomaticTitlePublish(context, contextGeneration);
  }
  private enqueueAutomaticTitleRecord(record: SessionCatalogRecord, context: SessionCatalogContext, contextGeneration: number): void {
    if (!this.isCurrentContext(context, contextGeneration)) return;
    this.pendingAutomaticTitleRecords.set(record.fileIdentity, record);
    this.startAutomaticTitleIndex(context, contextGeneration, []);
  }
  private takePendingAutomaticTitleRecord(): SessionCatalogRecord | undefined {
    const next = this.pendingAutomaticTitleRecords.entries().next().value as [string, SessionCatalogRecord] | undefined;
    if (!next) return undefined;
    this.pendingAutomaticTitleRecords.delete(next[0]);
    return next[1];
  }
  private async readAutomaticTitleBounded(path: string, context: SessionCatalogContext, contextGeneration: number) {
    while (this.isCurrentContext(context, contextGeneration) && this.automaticTitleActiveReads >= AUTOMATIC_TITLE_WORKERS) {
      await (this.automaticTitleCapacity ??= new Promise((resolve) => { this.releaseAutomaticTitleCapacity = resolve; }));
    }
    if (!this.isCurrentContext(context, contextGeneration)) return undefined;
    this.automaticTitleActiveReads += 1;
    try {
      return await this.recordEnricher.readAutomaticTitle(path);
    } finally {
      this.automaticTitleActiveReads -= 1;
      this.releaseAutomaticTitleCapacity?.();
      this.automaticTitleCapacity = undefined;
      this.releaseAutomaticTitleCapacity = undefined;
    }
  }
  private markAutomaticTitleReadFailure(record: SessionCatalogRecord, context: SessionCatalogContext, contextGeneration: number): void {
    if (!this.isCurrentContext(context, contextGeneration)) return;
    const current = this.projectionRecords.get(record.fileIdentity);
    if (!current || !sameSessionCatalogRecordVersion(current, record)
      || current.explicitName !== undefined || current.automaticName !== undefined) return;
    const skippedCount = this.current.skippedCount + 1;
    if (this.sqlite && this.current.source === "sqlite") {
      try {
        const state = this.sqlite.setIncomplete(true, skippedCount);
        if (!this.isCurrentContext(context, contextGeneration)) return;
        this.applySqliteState(state, false);
      } catch {
        this.demoteSqlite(true);
        return;
      }
    } else {
      this.current = { ...this.current, incomplete: true, skippedCount };
    }
    this.scheduleAutomaticTitlePublish(context, contextGeneration);
  }
  private setProjectionRecords(records: readonly SessionCatalogRecord[]): void {
    this.projectionRecords.clear();
    for (const record of records) this.projectionRecords.set(record.fileIdentity, record);
  }
  private isCurrentContext(context: SessionCatalogContext, contextGeneration: number): boolean {
    return !this.disposed
      && this.activeSourceKey === context.sourceKey
      && this.contextGeneration === contextGeneration;
  }
  private assertNotDisposed(): void {
    if (this.disposed) throw new RuntimeError("RUNTIME_NOT_READY", "Session Catalog has been disposed.");
  }
}

function degradedReason(reason: SessionCatalogDegradedReason | undefined) {
  return reason === undefined ? {} : { degradedReason: reason };
}

function sameSessionCatalogRecordVersion(
  current: SessionCatalogRecord,
  expected: SessionCatalogRecord
): boolean {
  return current.fileIdentity === expected.fileIdentity
    && current.id === expected.id
    && current.path === expected.path
    && current.modifiedAt === expected.modifiedAt
    && current.messageCount === expected.messageCount;
}

function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Session content search was cancelled.", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Session content search was cancelled.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
