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
  createBoundedSessionCatalogPage,
  normalizeSessionCatalogSearch,
  querySessionCatalogFallback,
  sanitizeSessionCatalogRecord,
  sortSessionCatalogRecords,
  validateSessionCatalogContext,
  validateSessionCatalogQuery,
  type ValidatedSessionCatalogQuery
} from "./session-catalog-projection.js";
import { searchSessionCatalogContent } from "./session-catalog-content-search.js";
import { normalizeSessionCatalogWorkspaceIdentity } from "./session-path-identity.js";
import type { CreateSessionCatalogOptions, SessionCatalog, SessionCatalogContext } from "./session-catalog-contract.js";
import {
  SessionCatalogRecordEnricher,
  type SessionCatalogOrganizationMutation
} from "./session-catalog-record-enricher.js";
import { SessionCatalogIndexCoordinator } from "./session-catalog-index-coordinator.js";
import { runSessionCatalogReconcile } from "./session-catalog-reconciler.js";
import { SessionCatalogUpsertCoordinator } from "./session-catalog-upsert-coordinator.js";
import {
  organizeSessionCatalogRecord,
  reorderPinnedSessionCatalogRecords,
  type SessionCatalogOrganizationHost
} from "./session-catalog-organization.js";
import {
  SessionCatalogSqliteLifecycle,
  sessionCatalogStatusFromSqliteState
} from "./session-catalog-sqlite-lifecycle.js";
import {
  openSqliteSessionCatalog,
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
  private autoReconciledSource: string | undefined;
  private activeContext: SessionCatalogContext | undefined;
  private contextGeneration = 0;
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
  private readonly indexes: SessionCatalogIndexCoordinator;
  private readonly upserts: SessionCatalogUpsertCoordinator;
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
    this.indexes = new SessionCatalogIndexCoordinator({
      sqlite: () => this.sqlite,
      status: () => this.current,
      setStatus: (status) => { this.current = status; },
      projectionRecord: (fileIdentity) => this.projectionRecords.get(fileIdentity),
      setProjectionRecord: (record) => this.projectionRecords.set(record.fileIdentity, record),
      fallback: () => ({ records: this.fallbackRecords, ready: this.fallbackReady }),
      setFallbackRecords: (records) => { this.fallbackRecords = records; },
      isCurrentContext: (context, generation) => this.isCurrentContext(context, generation),
      applySqliteState: (state) => this.applySqliteState(state, false),
      demoteSqlite: () => this.demoteSqlite(true),
      publishAutomaticTitle: () => this.publish("automatic-title"),
      readAutomaticTitle: (path) => this.recordEnricher.readAutomaticTitle(path),
      isDisposed: () => this.disposed
    });
    this.upserts = new SessionCatalogUpsertCoordinator({
      sqlite: () => this.sqlite,
      status: () => this.current,
      setStatus: (status) => { this.current = status; },
      fallbackRecords: () => this.fallbackRecords,
      setFallback: (records, ready) => {
        this.fallbackRecords = records;
        this.fallbackReady = ready;
      },
      setProjectionRecord: (record) => this.projectionRecords.set(record.fileIdentity, record),
      contextGeneration: () => this.contextGeneration,
      reconcileActive: () => this.reconcileFlight !== undefined,
      indexes: this.indexes,
      applySqliteState: (state) => this.applySqliteState(state, false),
      demoteSqlite: () => this.demoteSqlite(true),
      publish: (reason) => this.publish(reason),
      degradedReason: () => this.sqliteLifecycle.degradedReason
    });
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
        await this.indexes.awaitAutomaticTitles(context, contextGeneration);
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
      await this.indexes.awaitAutomaticTitles(context, contextGeneration);
      const records = sortSessionCatalogRecords([...this.projectionRecords.values()].filter((record) => (
        record.cwdKey === this.activeWorkspaceKey && record.archivedAt === undefined
      )));
      return searchSessionCatalogContent({
        workspaceId,
        workspaceKey: this.activeWorkspaceKey,
        query,
        context,
        contextGeneration,
        records,
        status: this.current,
        sqlite: this.sqlite,
        indexes: this.indexes,
        projectionRecord: (fileIdentity) => this.projectionRecords.get(fileIdentity),
        ...(signal === undefined ? {} : { signal })
      });
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
      this.upserts.upsert(safe, context, reason);
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
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.contextGeneration += 1;
    this.reconcileFlight = undefined;
    this.indexes.dispose();
    this.sqliteLifecycle.close();
    this.fallbackRecords = [];
    this.projectionRecords.clear();
    this.upserts.reset();
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
      this.indexes.reset(true);
    }
    this.activeSourceKey = context.sourceKey;
    this.contextGeneration += 1;
    this.activeWorkspaceKey = normalizeSessionCatalogWorkspaceIdentity(context.workspaceCwd);
    this.fallbackRecords = [];
    this.projectionRecords.clear();
    this.fallbackReady = false;
    this.autoReconciledSource = undefined;
    this.upserts.reset();
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
    this.indexes.reset();
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
    await runSessionCatalogReconcile({
      context,
      contextGeneration,
      reason,
      isCurrent: () => this.isCurrentContext(context, contextGeneration),
      status: () => this.current,
      setStatus: (status) => { this.current = status; },
      sqlite: () => this.sqlite,
      recordEnricher: this.recordEnricher,
      upserts: this.upserts,
      indexes: this.indexes,
      now: this.now,
      setFallback: (records, ready) => {
        this.fallbackRecords = records;
        this.fallbackReady = ready;
      },
      setProjectionRecords: (records) => this.setProjectionRecords(records),
      applySqliteState: (state) => this.applySqliteState(state, false),
      demoteSqlite: () => this.demoteSqlite(false),
      setAutoReconciledSource: (sourceKey) => { this.autoReconciledSource = sourceKey; },
      degradedReason: () => this.sqliteLifecycle.degradedReason,
      publish: () => this.publish(reason)
    });
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
    this.current = sessionCatalogStatusFromSqliteState(state, rebuilding, minimumRevision);
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
