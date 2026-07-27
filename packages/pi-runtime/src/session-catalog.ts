import {
  RuntimeError,
  type SessionCatalogChangedEvent,
  type SessionCatalogChangedReason,
  type SessionCatalogDegradedReason,
  type SessionCatalogPage,
  type SessionCatalogQuery,
  type SessionCatalogStatus
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
  sortSessionCatalogRecords,
  validateSessionCatalogContext,
  validateSessionCatalogQuery,
  type SessionCatalogDiscoveryResult,
  type ValidatedSessionCatalogQuery
} from "./session-catalog-projection.js";
import { normalizeSessionCatalogPathIdentity } from "./session-path-identity.js";
import {
  openSqliteSessionCatalog,
  type OpenSqliteSessionCatalog,
  type SessionCatalogRecord,
  type SqliteSessionCatalog
} from "./sqlite-session-catalog.js";
const SQLITE_RETRY_MS = { initial: 1_000, maximum: 30_000 };
export type { SessionCatalogDiscoveryResult } from "./session-catalog-projection.js";
export interface SessionCatalogContext {
  sourceKey: string;
  workspaceCwd: string;
  discover(): Promise<SessionCatalogDiscoveryResult>;
}
export interface SessionCatalog {
  query(query: SessionCatalogQuery, context: SessionCatalogContext): Promise<SessionCatalogPage>;
  status(): SessionCatalogStatus;
  reconcile(context: SessionCatalogContext, reason?: SessionCatalogChangedReason): Promise<void>;
  upsert(
    record: SessionCatalogRecord,
    context: SessionCatalogContext,
    reason: Extract<SessionCatalogChangedReason, "session-created" | "session-updated" | "session-imported">
  ): Promise<void>;
  dispose(): Promise<void>;
}
export interface CreateSessionCatalogOptions {
  directory?: string;
  storageRoot?: string;
  onChanged?: (event: SessionCatalogChangedEvent) => void;
  openSqlite?: OpenSqliteSessionCatalog;
  now?: () => number;
}
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
  private sqlite: SqliteSessionCatalog | undefined;
  private sqliteAttempted = false;
  private sqliteRetryAt = 0;
  private sqliteRetryMs = SQLITE_RETRY_MS.initial;
  private sqliteDegradedReason: SessionCatalogDegradedReason | undefined;
  private sqliteOpenFlight: Promise<void> | undefined;
  private fallbackRecords: SessionCatalogRecord[] = [];
  private fallbackReady = false;
  private reconcileFlight: ReconcileFlight | undefined;
  private autoReconciledSource: string | undefined;
  private activeContext: SessionCatalogContext | undefined;
  private contextGeneration = 0;
  private mutationGeneration = 0;
  private readonly pendingUpserts = new Map<string, PendingSessionCatalogUpsert>();
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
  private readonly directory: string | undefined;
  private readonly storageRoot: string | undefined;
  private readonly onChanged: ((event: SessionCatalogChangedEvent) => void) | undefined;
  private readonly openSqlite: OpenSqliteSessionCatalog;
  private readonly now: () => number;
  constructor(options: CreateSessionCatalogOptions) {
    this.directory = options.directory;
    this.storageRoot = options.storageRoot;
    this.onChanged = options.onChanged;
    this.openSqlite = options.openSqlite ?? openSqliteSessionCatalog;
    this.now = options.now ?? (() => Date.now());
  }
  query(query: SessionCatalogQuery, context: SessionCatalogContext): Promise<SessionCatalogPage> {
    const validated = validateSessionCatalogQuery(query);
    return this.withPreparedContext(context, (contextGeneration) => {
      const queryKey = createSessionCatalogQueryKey(
        context.sourceKey, this.activeWorkspaceKey, validated.scope, normalizeSessionCatalogSearch(validated.search ?? "")
      );
      assertSessionCatalogCursor(validated.cursor, this.current.revision, queryKey);
      if (validated.refresh || this.autoReconciledSource !== context.sourceKey) {
        this.autoReconciledSource = context.sourceKey;
        void this.startReconcile(context, "reconciled", contextGeneration).catch(() => undefined);
      }
      const result = this.readProjection(validated);
      assertSessionCatalogCursor(validated.cursor, this.current.revision, queryKey);
      return createBoundedSessionCatalogPage(result, this.current, validated.limit, queryKey);
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
      const safe = sanitizeSessionCatalogRecord(record);
      if (!safe || !this.isCurrentContext(context, contextGeneration)) return;
      this.upsertPrepared(safe, context, reason);
    });
  }
  private upsertPrepared(
    safe: SessionCatalogRecord,
    context: SessionCatalogContext,
    reason: Extract<SessionCatalogChangedReason, "session-created" | "session-updated" | "session-imported">
  ): void {
    const generation = ++this.mutationGeneration;
    this.pendingUpserts.set(safe.path, { generation, record: safe });
    let recoveryScheduled = false;
    const sqliteAwaitingReconcile = this.sqlite !== undefined && this.current.source !== "sqlite";
    if (this.sqlite && this.current.source === "sqlite") {
      try {
        if (this.sqlite.getState().sourceKey === context.sourceKey) {
          const state = this.sqlite.upsert(safe, this.current.revision);
          this.applySqliteState(state, false);
          if (!this.reconcileFlight) this.pendingUpserts.delete(safe.path);
          this.publish(reason);
          return;
        }
      } catch {
        this.demoteSqlite(true);
        recoveryScheduled = true;
      }
    }
    const records = new Map(this.fallbackRecords.map((item) => [item.path, item]));
    records.set(safe.path, safe);
    this.fallbackRecords = sortSessionCatalogRecords([...records.values()]);
    this.fallbackReady = true;
    this.current = {
      ...this.current,
      revision: this.current.revision + 1,
      source: "sdk-fallback",
      state: "fallback",
      rebuilding: this.reconcileFlight !== undefined,
      itemCount: this.fallbackRecords.length,
      ...degradedReason(this.sqliteDegradedReason)
    };
    if (!this.reconcileFlight && !recoveryScheduled && !sqliteAwaitingReconcile) this.pendingUpserts.delete(safe.path);
    this.publish(reason);
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.contextGeneration += 1;
    this.reconcileFlight = undefined;
    try {
      this.sqlite?.close();
    } catch {
      // Shutdown remains safe even if SQLite is already closed.
    }
    this.sqlite = undefined;
    this.fallbackRecords = [];
    this.pendingUpserts.clear();
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
    await this.ensureSqlite();
    this.assertNotDisposed();
    this.activeContext = context;
    if (this.activeSourceKey === context.sourceKey) {
      this.activeWorkspaceKey = normalizeSessionCatalogPathIdentity(context.workspaceCwd);
      return this.contextGeneration;
    }
    const changed = this.activeSourceKey !== undefined;
    if (changed && this.reconcileFlight?.sourceKey !== context.sourceKey) {
      // Pi discovery is not abortable. Detach stale work so the active source never waits for it.
      this.reconcileFlight = undefined;
    }
    this.activeSourceKey = context.sourceKey;
    this.contextGeneration += 1;
    this.activeWorkspaceKey = normalizeSessionCatalogPathIdentity(context.workspaceCwd);
    this.fallbackRecords = [];
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
        ...degradedReason(this.sqlite ? undefined : this.sqliteDegradedReason)
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
    const records = mergePendingSessionCatalogUpserts(discovered.records, this.pendingUpserts, appliedMutation);
    const reconciledAt = this.now();
    if (this.sqlite) {
      try {
        const state = this.sqlite.replaceAll(
          context.sourceKey,
          records,
          { reconciledAt, incomplete: discovered.incomplete, skippedCount: discovered.skippedCount },
          this.current.revision
        );
        if (!this.isCurrentContext(context, contextGeneration)) return;
        this.fallbackRecords = [];
        this.fallbackReady = false;
        this.applySqliteState(state, false);
        clearAppliedSessionCatalogUpserts(this.pendingUpserts, appliedMutation);
        this.publish(reason);
        return;
      } catch {
        this.demoteSqlite(false);
      }
    }
    this.fallbackRecords = records;
    this.fallbackReady = true;
    this.current = {
      revision: this.current.revision + 1,
      source: "sdk-fallback",
      state: "fallback",
      rebuilding: false,
      reconciledAt,
      itemCount: records.length,
      incomplete: discovered.incomplete,
      skippedCount: discovered.skippedCount,
      ...degradedReason(this.sqliteDegradedReason)
    };
    this.autoReconciledSource = context.sourceKey;
    clearAppliedSessionCatalogUpserts(this.pendingUpserts, appliedMutation);
    this.publish(reason);
  }
  private readProjection(query: ValidatedSessionCatalogQuery) {
    if (this.sqlite && this.current.source === "sqlite") {
      try {
        const state = this.sqlite.getState();
        if (state.sourceKey === this.activeSourceKey) {
          return this.sqlite.query({
            scope: query.scope,
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
  private async ensureSqlite(): Promise<void> {
    if (this.sqlite || this.directory === undefined || this.disposed) return;
    if (this.sqliteOpenFlight) return this.sqliteOpenFlight;
    const now = this.now();
    if (this.sqliteAttempted && now < this.sqliteRetryAt) return;
    this.sqliteAttempted = true;
    const lifecycleGeneration = this.contextGeneration;
    const flight = this.openSqlite(this.directory, this.storageRoot)
      .catch(() => ({
        kind: "fallback" as const,
        reason: "unavailable" as const,
        degradedReason: "unavailable" as const
      }))
      .then((result) => {
        if (this.disposed || lifecycleGeneration !== this.contextGeneration) {
          if (result.kind === "ready") result.catalog.close();
          return;
        }
        if (result.kind === "ready") {
          this.sqlite = result.catalog;
          this.sqliteDegradedReason = undefined;
          this.autoReconciledSource = undefined;
          this.sqliteRetryMs = SQLITE_RETRY_MS.initial;
          return;
        }
        this.sqliteDegradedReason = result.degradedReason ?? result.reason;
        this.sqliteRetryAt = now + this.sqliteRetryMs;
        this.sqliteRetryMs = Math.min(this.sqliteRetryMs * 2, SQLITE_RETRY_MS.maximum);
      })
      .finally(() => {
        if (this.sqliteOpenFlight === flight) this.sqliteOpenFlight = undefined;
      });
    this.sqliteOpenFlight = flight;
    return flight;
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
    this.sqliteDegradedReason = undefined;
  }
  private demoteSqlite(scheduleReconcile: boolean): void {
    try {
      this.sqlite?.close();
    } catch {
      // The projection is disposable; fallback stays metadata-only.
    }
    this.sqlite = undefined;
    this.sqliteDegradedReason = "runtime-query";
    this.sqliteRetryAt = this.now() + this.sqliteRetryMs;
    this.sqliteRetryMs = Math.min(this.sqliteRetryMs * 2, SQLITE_RETRY_MS.maximum);
    this.autoReconciledSource = undefined;
    this.fallbackRecords = [];
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
