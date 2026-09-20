import type { SharedKnowledgeReceiptRequest } from "@pi67/protocol";
import type { SharedKnowledgeReceiptClient } from "./shared-knowledge-receipt-client.js";
import type { TeamQueryModel } from "./team-query-embedding.js";

type Scope = Extract<SharedKnowledgeReceiptRequest, { type: "shared-knowledge-receipt-open" }>["scope"];
const unavailable = () => new Error("Shared knowledge query unavailable.");
type QueryStage = "receipt-open" | "index-preparation" | "embedding" | "native-query" | "receipt-close";

/** Fixed local phase only, never an upstream message, cause, identity or payload.
 * A phase identifies the failed boundary, not whether its IO physically stopped. */
export class SharedKnowledgeQueryError extends Error {
  constructor(readonly stage: QueryStage) {
    super(`Shared knowledge query unavailable. Stage: ${stage}.`);
  }
}

/** Internal metadata-only transaction. Main admits the index before any embedding
 * request. Hits are observations, never permission to read or process bodies. */
export async function runSharedKnowledgeQuery(options: {
  receipts: Pick<SharedKnowledgeReceiptClient, "request" | "signal">;
  scope: Scope; query: string; limit: number; signal: AbortSignal;
  assertCurrent(this: void): void;
  embed(this: void, query: string, model: TeamQueryModel, signal: AbortSignal): Promise<readonly number[]>;
}) {
  const { receipts, query, limit, embed, assertCurrent } = options, scope = { ...options.scope };
  const signal = AbortSignal.any([options.signal, receipts.signal]);
  const check = () => { signal.throwIfAborted(); assertCurrent(); };
  let handleId: string | undefined;
  let stage: QueryStage = "receipt-open";
  let closing: Promise<boolean> | undefined;
  const close = () => {
    if (!handleId) return Promise.resolve(false);
    return closing ??= receipts.request({ type: "shared-knowledge-receipt-close", handleId })
      .then(result => result.ok && result.type === "shared-knowledge-receipt-close-result", () => false);
  };
  // Close promptly even while a cancelled model transport is still draining.
  // A close ACK is not physical native completion; Main retains that ownership.
  const cancel = () => { void close(); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    check();
    const opened = await receipts.request({ type: "shared-knowledge-receipt-open", scope }, signal);
    if (!opened.ok || opened.type !== "shared-knowledge-receipt-open-result") throw unavailable();
    handleId = opened.handleId; check();
    stage = "index-preparation";
    const prepared = await receipts.request({ type: "shared-knowledge-index-query-prepare", handleId }, signal);
    if (!prepared.ok || prepared.type !== "shared-knowledge-index-query-prepare-result") throw unavailable();
    const snapshot = { ...prepared.snapshot }, model = { ...prepared.model }, queryId = prepared.queryId;
    check();
    stage = "embedding";
    const vector = await embed(query, model, signal); check();
    stage = "native-query";
    const result = await receipts.request({ type: "shared-knowledge-index-query", handleId, queryId, vector: [...vector], limit }, signal);
    if (!result.ok || result.type !== "shared-knowledge-index-query-result"
        || result.snapshot.epoch !== snapshot.epoch || result.snapshot.cursor !== snapshot.cursor
        || result.hits.length > limit) throw unavailable();
    check();
    const hits = result.hits.map(hit => ({ ...hit }));
    stage = "receipt-close";
    if (!await close()) throw unavailable();
    check(); return { snapshot, hits };
  } catch { throw new SharedKnowledgeQueryError(stage); }
  finally { signal.removeEventListener("abort", cancel); await close(); }
}
