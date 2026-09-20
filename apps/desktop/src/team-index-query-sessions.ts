import { randomUUID } from "node:crypto";
import type { SharedKnowledgeReceiptRequest } from "@pi67/protocol";
import type { openPublishedTeamIndex } from "./team-index-reader.js";
import type { prepareTeamQueryRuntime } from "./team-query-runtime.js";

type Reader = Awaited<ReturnType<typeof openPublishedTeamIndex>>;
type Prepared = { reader: Reader; runtime: Awaited<ReturnType<typeof prepareTeamQueryRuntime>> };
type Query = Extract<SharedKnowledgeReceiptRequest, { type: "shared-knowledge-index-query" }>;
type Read = Extract<SharedKnowledgeReceiptRequest, { type: "shared-knowledge-index-read" | "shared-knowledge-index-read-current" }>;
interface Entry { id: string; controller: AbortController; pending: boolean; used: boolean;
  reader?: Reader; runtime?: Prepared["runtime"]; timer: ReturnType<typeof setTimeout>; started: number; monotonic: number; lastWall: number }
const unavailable = () => new Error("Team index query unavailable.");
type ReadStage = "reader-admission" | "local-body-read" | "current-check";
interface ReadDiagnostic { schema: "new-money.team-read.v1"; outcome: "completed" | "failed" | "cancelled" | "snapshot-changed";
  durationMs: number; stages: Array<{ stage: ReadStage; durationMs: number }> }
const reportRead = (value: ReadDiagnostic) => { console.info("[team-read]", JSON.stringify(value)); };

/** One-shot Main-owned query/read operations, keyed by the dedicated receipt handle.
 * Cancellation signals work; it does not release capacity or dispose an active
 * reader until its underlying preparation/query has actually settled. */
export class TeamIndexQuerySessions {
  #entries = new Map<string, Entry>();
  constructor(private readonly prepare: (handleId: string, signal: AbortSignal) => Promise<Prepared>,
    private readonly prepareRead?: (handleId: string, signal: AbortSignal) => Promise<Reader>,
    private readonly report: (value: ReadDiagnostic) => void = reportRead) {}
  has(handleId: string): boolean { return this.#entries.has(handleId); }
  async open(handleId: string) {
    const entry = this.#reserve(handleId), controller = entry.controller;
    try {
      const prepared = await this.prepare(handleId, controller.signal);
      entry.reader = prepared.reader; entry.runtime = prepared.runtime; this.#check(handleId, entry);
      await entry.reader.assertCurrent(); this.#check(handleId, entry);
      entry.reader.signal.addEventListener("abort", () => this.cancel(handleId), { once: true });
      return { queryId: entry.id, model: { ...entry.reader.models.embedding }, snapshot: { ...entry.reader.snapshot } };
    } catch { controller.abort(); throw unavailable(); }
    finally { entry.pending = false; if (controller.signal.aborted) this.#release(handleId, entry); }
  }
  async read(input: Read) {
    if (!this.prepareRead) throw unavailable();
    const { handleId, assetId, contentRevision } = input, expected = "snapshot" in input ? { ...input.snapshot } : undefined, entry = this.#reserve(handleId);
    const started = performance.now(), stages: ReadDiagnostic["stages"] = [];
    let stage: ReadStage = "reader-admission", stageStart = started, outcome: ReadDiagnostic["outcome"] = "failed";
    const advance = (next: ReadStage) => {
      stages.push({ stage, durationMs: Math.max(0, Math.round(performance.now() - stageStart)) });
      stage = next; stageStart = performance.now();
    };
    try {
      entry.reader = await this.prepareRead(handleId, entry.controller.signal); this.#check(handleId, entry);
      const reader = entry.reader;
      const snapshot = { ...reader.snapshot };
      if (expected && (snapshot.epoch !== expected.epoch || snapshot.cursor !== expected.cursor)) { outcome = "snapshot-changed"; throw unavailable(); }
      advance("local-body-read");
      const result = await reader.readDocument({ assetId, contentRevision }); this.#check(handleId, entry);
      advance("current-check");
      await reader.assertCurrent([result]); this.#check(handleId, entry);
      outcome = "completed";
      return { snapshot, ...result };
    } catch { if (entry.controller.signal.aborted) outcome = "cancelled"; throw unavailable(); }
    finally {
      stages.push({ stage, durationMs: Math.max(0, Math.round(performance.now() - stageStart)) });
      entry.pending = false; this.#release(handleId, entry);
      try { this.report({ schema: "new-money.team-read.v1", outcome, durationMs: Math.max(0, Math.round(performance.now() - started)), stages }); }
      catch { /* Diagnostics never change read results or cleanup. */ }
    }
  }
  #reserve(handleId: string): Entry {
    if (this.#entries.size >= 4 || this.has(handleId)) throw unavailable();
    const controller = new AbortController(), started = Date.now();
    const entry: Entry = { id: randomUUID(), controller, pending: true, used: false, started, lastWall: started,
      monotonic: performance.now(), timer: setTimeout(() => this.cancel(handleId), 60_000) };
    entry.timer.unref?.(); this.#entries.set(handleId, entry);
    return entry;
  }
  async query(input: Query) {
    const entry = this.#entries.get(input.handleId);
    if (!entry || entry.id !== input.queryId || entry.pending || entry.used || !entry.reader || !entry.runtime) throw unavailable();
    this.#check(input.handleId, entry); entry.used = true; entry.pending = true;
    const { reader, runtime } = entry;
    try {
      const hits = await reader.queryVector({ vector: input.vector, limit: input.limit, runtime });
      this.#check(input.handleId, entry); await reader.assertCurrent(hits); this.#check(input.handleId, entry);
      return { snapshot: { ...reader.snapshot }, hits: hits.map(hit => ({ ...hit })) };
    } catch { throw unavailable(); }
    finally { entry.pending = false; this.#release(input.handleId, entry); }
  }
  cancel(handleId: string): void {
    const entry = this.#entries.get(handleId); if (!entry) return;
    entry.controller.abort();
    if (!entry.pending) this.#release(handleId, entry);
  }
  invalidate(): void { for (const handleId of this.#entries.keys()) this.cancel(handleId); }
  #check(handleId: string, entry: Entry): void {
    const now = Date.now(), monotonic = performance.now();
    if (this.#entries.get(handleId) !== entry || entry.controller.signal.aborted || entry.reader?.signal.aborted
        || now < entry.lastWall || now >= entry.started + 60_000 || monotonic < entry.monotonic || monotonic >= entry.monotonic + 60_000) {
      this.cancel(handleId); throw unavailable();
    }
    entry.lastWall = now;
  }
  #release(handleId: string, entry: Entry): void {
    // Delete before dispose: reader abort callbacks may synchronously call cancel.
    if (this.#entries.get(handleId) !== entry) return;
    this.#entries.delete(handleId); clearTimeout(entry.timer); entry.controller.abort(); entry.reader?.dispose();
  }
}
