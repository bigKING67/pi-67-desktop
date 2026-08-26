import type {
  SessionCatalogStatus
} from "@pi67/domain";
import { SessionCatalogAutomaticTitlePublisher } from "./session-catalog-automatic-title-publisher.js";
import { sortSessionCatalogRecords } from "./session-catalog-projection.js";
import {
  indexSessionContentRecords
} from "./session-content-index.js";
import type { AutomaticTitleReadResult } from "./session-automatic-title.js";
import {
  supportsSessionContentIndex,
  type SessionCatalogRecord,
  type SqliteCatalogState,
  type SqliteSessionCatalog
} from "./sqlite-session-catalog.js";
import type { SessionCatalogContext } from "./session-catalog-contract.js";

interface IndexFlight {
  sourceKey: string;
  contextGeneration: number;
  promise: Promise<void>;
}

interface PendingAutomaticTitleUpdate {
  record: SessionCatalogRecord;
  automaticName: string;
  automaticNameSource: "generated" | "seed";
  context: SessionCatalogContext;
  contextGeneration: number;
}

export interface SessionCatalogIndexCoordinatorOptions {
  sqlite(): SqliteSessionCatalog | undefined;
  status(): SessionCatalogStatus;
  setStatus(status: SessionCatalogStatus): void;
  projectionRecord(fileIdentity: string): SessionCatalogRecord | undefined;
  setProjectionRecord(record: SessionCatalogRecord): void;
  fallback(): { records: SessionCatalogRecord[]; ready: boolean };
  setFallbackRecords(records: SessionCatalogRecord[]): void;
  isCurrentContext(context: SessionCatalogContext, contextGeneration: number): boolean;
  applySqliteState(state: SqliteCatalogState): void;
  demoteSqlite(): void;
  publishAutomaticTitle(): void;
  readAutomaticTitle(path: string): Promise<AutomaticTitleReadResult>;
  isDisposed(): boolean;
}

const AUTOMATIC_TITLE_WORKERS = 4;
const MAX_AUTOMATIC_TITLE_BATCH = 16;

export class SessionCatalogIndexCoordinator {
  private automaticTitleFlight: IndexFlight | undefined;
  private contentIndexFlight: IndexFlight | undefined;
  private automaticTitleActiveReads = 0;
  private automaticTitleCapacity: Promise<void> | undefined;
  private releaseAutomaticTitleCapacity: (() => void) | undefined;
  private readonly pendingAutomaticTitleRecords = new Map<string, SessionCatalogRecord>();
  private readonly pendingContentIndexRecords = new Map<string, SessionCatalogRecord>();
  private readonly pendingAutomaticTitleUpdates = new Map<string, PendingAutomaticTitleUpdate>();
  private automaticTitleBatch: Promise<void> | undefined;
  private readonly publisher = new SessionCatalogAutomaticTitlePublisher();

  constructor(private readonly options: SessionCatalogIndexCoordinatorOptions) {}

  reset(publisher = false): void {
    this.automaticTitleFlight = undefined;
    this.contentIndexFlight = undefined;
    this.pendingAutomaticTitleRecords.clear();
    this.pendingContentIndexRecords.clear();
    this.pendingAutomaticTitleUpdates.clear();
    if (publisher) this.publisher.dispose();
  }

  dispose(): void {
    this.reset(true);
  }

  startContent(
    context: SessionCatalogContext,
    contextGeneration: number,
    records: readonly SessionCatalogRecord[]
  ): void {
    const sqlite = this.options.sqlite();
    if (!this.options.isCurrentContext(context, contextGeneration)
      || !sqlite
      || !supportsSessionContentIndex(sqlite)
      || this.options.status().source !== "sqlite") return;
    for (const record of records) this.pendingContentIndexRecords.set(record.fileIdentity, record);
    const existing = this.contentIndexFlight;
    if (existing?.sourceKey === context.sourceKey && existing.contextGeneration === contextGeneration) return;
    const batch = [...this.pendingContentIndexRecords.values()];
    this.pendingContentIndexRecords.clear();
    if (batch.length === 0) return;
    const promise = indexSessionContentRecords({
      records: batch,
      sqlite,
      isCurrent: (record) => {
        const current = this.options.projectionRecord(record.fileIdentity);
        return this.options.isCurrentContext(context, contextGeneration)
          && current !== undefined
          && sameSessionCatalogRecordVersion(current, record);
      }
    }).catch(() => undefined).finally(() => {
      if (this.contentIndexFlight?.promise !== promise) return;
      this.contentIndexFlight = undefined;
      if (this.pendingContentIndexRecords.size > 0
        && this.options.isCurrentContext(context, contextGeneration)) {
        this.startContent(context, contextGeneration, []);
      }
    });
    this.contentIndexFlight = { sourceKey: context.sourceKey, contextGeneration, promise };
  }

  enqueueContent(record: SessionCatalogRecord): void {
    this.pendingContentIndexRecords.set(record.fileIdentity, record);
  }

  async awaitContent(context: SessionCatalogContext, contextGeneration: number): Promise<void> {
    while (this.options.isCurrentContext(context, contextGeneration)) {
      const flight = this.contentIndexFlight;
      if (flight?.sourceKey === context.sourceKey && flight.contextGeneration === contextGeneration) {
        await flight.promise;
      } else if (this.pendingContentIndexRecords.size > 0) {
        this.startContent(context, contextGeneration, []);
      } else {
        return;
      }
    }
  }

  enqueueAutomaticTitle(
    record: SessionCatalogRecord,
    context: SessionCatalogContext,
    contextGeneration: number
  ): void {
    if (!this.options.isCurrentContext(context, contextGeneration)) return;
    this.pendingAutomaticTitleRecords.set(record.fileIdentity, record);
    this.startAutomaticTitles(context, contextGeneration, []);
  }

  startAutomaticTitles(
    context: SessionCatalogContext,
    contextGeneration: number,
    records: readonly SessionCatalogRecord[]
  ): void {
    if (!this.options.isCurrentContext(context, contextGeneration)) return;
    const existing = this.automaticTitleFlight;
    if (existing?.sourceKey === context.sourceKey && existing.contextGeneration === contextGeneration) return;
    if (!records.some((record) => record.explicitName === undefined && record.automaticName === undefined)
      && this.pendingAutomaticTitleRecords.size === 0) return;
    let next = 0;
    const worker = async () => {
      while (this.options.isCurrentContext(context, contextGeneration)) {
        const record = records[next++] ?? this.takePendingAutomaticTitleRecord();
        if (!record) return;
        if (record.explicitName !== undefined || record.automaticName !== undefined) continue;
        const outcome = await this.readAutomaticTitleBounded(record.path, context, contextGeneration);
        if (!outcome || !this.options.isCurrentContext(context, contextGeneration)) return;
        if (outcome.kind === "failed") {
          this.markAutomaticTitleReadFailure(record, context, contextGeneration);
        } else if (outcome.kind === "title") {
          this.queueAutomaticTitleUpdate(
            record,
            outcome.title,
            outcome.source ?? "seed",
            context,
            contextGeneration
          );
        }
      }
    };
    const promise = Promise.all(Array.from({ length: AUTOMATIC_TITLE_WORKERS }, worker))
      .then(() => undefined)
      .finally(() => {
        if (this.automaticTitleFlight?.promise !== promise) return;
        this.automaticTitleFlight = undefined;
        if (this.pendingAutomaticTitleRecords.size > 0
          && this.options.isCurrentContext(context, contextGeneration)) {
          this.startAutomaticTitles(context, contextGeneration, []);
        }
      });
    this.automaticTitleFlight = { sourceKey: context.sourceKey, contextGeneration, promise };
  }

  async awaitAutomaticTitles(
    context: SessionCatalogContext,
    contextGeneration: number
  ): Promise<void> {
    while (this.options.isCurrentContext(context, contextGeneration)) {
      const flight = this.automaticTitleFlight;
      if (flight?.sourceKey === context.sourceKey && flight.contextGeneration === contextGeneration) {
        await flight.promise;
      } else if (this.automaticTitleBatch) {
        await this.automaticTitleBatch;
      } else if (this.pendingAutomaticTitleUpdates.size > 0) {
        this.scheduleAutomaticTitleBatch();
      } else if (this.pendingAutomaticTitleRecords.size > 0) {
        this.startAutomaticTitles(context, contextGeneration, []);
      } else {
        return;
      }
    }
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
        if (!this.options.isDisposed() && this.pendingAutomaticTitleUpdates.size > 0) {
          this.scheduleAutomaticTitleBatch();
        }
      });
    this.automaticTitleBatch = batch;
  }

  private flushAutomaticTitleUpdateBatch(): void {
    const updates = [...this.pendingAutomaticTitleUpdates.values()].slice(0, MAX_AUTOMATIC_TITLE_BATCH);
    for (const update of updates) this.pendingAutomaticTitleUpdates.delete(update.record.fileIdentity);
    const applicableUpdates = updates.flatMap((update) => {
      const current = this.options.projectionRecord(update.record.fileIdentity);
      if (!this.options.isCurrentContext(update.context, update.contextGeneration) || !current
        || !sameSessionCatalogRecordVersion(current, update.record) || current.explicitName !== undefined
        || (current.automaticName === update.automaticName
          && current.automaticNameSource === update.automaticNameSource)) return [];
      return [{ ...update, record: {
        ...current,
        automaticName: update.automaticName,
        automaticNameSource: update.automaticNameSource
      } }];
    });
    if (applicableUpdates.length === 0) return;
    const { context, contextGeneration } = applicableUpdates[0]!;
    const records = applicableUpdates.map((update) => update.record);
    const sqlite = this.options.sqlite();
    if (sqlite && this.options.status().source === "sqlite") {
      try {
        const state = sqlite.upsertMany(records, this.options.status().revision);
        if (!this.options.isCurrentContext(context, contextGeneration)) return;
        for (const record of records) this.options.setProjectionRecord(record);
        this.options.applySqliteState(state);
        this.scheduleAutomaticTitlePublish(context, contextGeneration);
      } catch {
        this.options.demoteSqlite();
      }
      return;
    }
    const fallback = this.options.fallback();
    if (!fallback.ready) return;
    const updatedRecords = sortSessionCatalogRecords(fallback.records.map((candidate) => (
      records.find((record) => record.fileIdentity === candidate.fileIdentity) ?? candidate
    )));
    this.options.setFallbackRecords(updatedRecords);
    for (const record of records) this.options.setProjectionRecord(record);
    this.options.setStatus({
      ...this.options.status(),
      revision: this.options.status().revision + 1,
      itemCount: updatedRecords.length
    });
    this.scheduleAutomaticTitlePublish(context, contextGeneration);
  }

  private takePendingAutomaticTitleRecord(): SessionCatalogRecord | undefined {
    const next = this.pendingAutomaticTitleRecords.entries().next().value as
      | [string, SessionCatalogRecord]
      | undefined;
    if (!next) return undefined;
    this.pendingAutomaticTitleRecords.delete(next[0]);
    return next[1];
  }

  private async readAutomaticTitleBounded(
    path: string,
    context: SessionCatalogContext,
    contextGeneration: number
  ): Promise<AutomaticTitleReadResult | undefined> {
    while (this.options.isCurrentContext(context, contextGeneration)
      && this.automaticTitleActiveReads >= AUTOMATIC_TITLE_WORKERS) {
      await (this.automaticTitleCapacity ??= new Promise((resolve) => {
        this.releaseAutomaticTitleCapacity = resolve;
      }));
    }
    if (!this.options.isCurrentContext(context, contextGeneration)) return undefined;
    this.automaticTitleActiveReads += 1;
    try {
      return await this.options.readAutomaticTitle(path);
    } finally {
      this.automaticTitleActiveReads -= 1;
      this.releaseAutomaticTitleCapacity?.();
      this.automaticTitleCapacity = undefined;
      this.releaseAutomaticTitleCapacity = undefined;
    }
  }

  private markAutomaticTitleReadFailure(
    record: SessionCatalogRecord,
    context: SessionCatalogContext,
    contextGeneration: number
  ): void {
    if (!this.options.isCurrentContext(context, contextGeneration)) return;
    const current = this.options.projectionRecord(record.fileIdentity);
    if (!current || !sameSessionCatalogRecordVersion(current, record)
      || current.explicitName !== undefined || current.automaticName !== undefined) return;
    const skippedCount = this.options.status().skippedCount + 1;
    const sqlite = this.options.sqlite();
    if (sqlite && this.options.status().source === "sqlite") {
      try {
        const state = sqlite.setIncomplete(true, skippedCount);
        if (!this.options.isCurrentContext(context, contextGeneration)) return;
        this.options.applySqliteState(state);
      } catch {
        this.options.demoteSqlite();
        return;
      }
    } else {
      this.options.setStatus({ ...this.options.status(), incomplete: true, skippedCount });
    }
    this.scheduleAutomaticTitlePublish(context, contextGeneration);
  }

  private scheduleAutomaticTitlePublish(
    context: SessionCatalogContext,
    contextGeneration: number
  ): void {
    this.publisher.schedule(
      () => this.options.isCurrentContext(context, contextGeneration),
      () => this.options.publishAutomaticTitle()
    );
  }
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
