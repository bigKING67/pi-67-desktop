import type { SharedKnowledgeReceiptRequest, SharedKnowledgeIndexSnapshot } from "@pi67/protocol";
import type { SharedKnowledgeReceiptClient } from "./shared-knowledge-receipt-client.js";
import type { TeamModelPortAdmission } from "./team-model-port-admission.js";
import type { TeamWorkerBrokerClient } from "./team-worker-broker-client.js";

type Prepare = Extract<SharedKnowledgeReceiptRequest, { type: "shared-knowledge-index-prepare" }>;
type Scope = Extract<SharedKnowledgeReceiptRequest, { type: "shared-knowledge-receipt-open" }>["scope"];
type Reservation = ReturnType<TeamModelPortAdmission["reserve"]>;

/** Host-only explicit index transaction. Caller owns current identity and model
 * policy; reserve must use that same captured scope/models and the enterprise
 * per-frame guard. Main owns publication authorization and the atomic pointer.
 * No provider credentials, implicit sync, retry or private fallback.
 */
export async function runSharedKnowledgeIndex(options: {
  receipts: Pick<SharedKnowledgeReceiptClient, "request" | "signal">;
  workers: Pick<TeamWorkerBrokerClient, "start">;
  scope: Scope;
  models: Prepare["models"];
  reserve(this: void, signal: AbortSignal): Reservation;
  assertCurrent(this: void): void;
  revalidate(this: void, snapshot: SharedKnowledgeIndexSnapshot, signal: AbortSignal): Promise<() => void>;
  signal: AbortSignal;
}) {
  const { receipts, workers, assertCurrent, reserve, revalidate } = options;
  const scope = { ...options.scope }, models = { embedding: { ...options.models.embedding }, extraction: { ...options.models.extraction } };
  const lifetime = new AbortController(), signal = AbortSignal.any([options.signal, receipts.signal, lifetime.signal]);
  const check = () => { signal.throwIfAborted(); assertCurrent(); };
  let handleId: string | undefined, indexId: string | undefined, reservation: Reservation | undefined;
  let worker: Awaited<ReturnType<TeamWorkerBrokerClient["start"]>> | undefined;
  let startup: ReturnType<TeamWorkerBrokerClient["start"]> | undefined;
  let mainResult: ReturnType<SharedKnowledgeReceiptClient["request"]> | undefined;
  let assertObservation: (() => void) | undefined;
  let publicationMayHaveCommitted = false;
  const unavailable = () => new Error("Shared knowledge index operation failed or was cancelled.");
  const indeterminate = () => Object.assign(new Error("Shared knowledge index publication outcome could not be confirmed. Do not retry automatically."), { outcome: "indeterminate" as const });
  const perform = async () => {
    check();
    const opened = await receipts.request({ type: "shared-knowledge-receipt-open", scope }, signal);
    if (!opened.ok || opened.type !== "shared-knowledge-receipt-open-result") throw unavailable();
    handleId = opened.handleId; check();
    const prepared = await receipts.request({ type: "shared-knowledge-index-prepare", handleId, models }, signal);
    if (!prepared.ok || prepared.type !== "shared-knowledge-index-prepare-result") throw unavailable();
    indexId = prepared.indexId; check();
    // Heavy preparation precedes reservation; no network/model setup belongs in
    // Main's five-second ready→register window.
    reservation = reserve(signal);
    void reservation.connected.catch(() => undefined);
    if (reservation.phase !== "worker") throw unavailable();
    const registered = await receipts.request({ type: "shared-knowledge-index-register", handleId, indexId, workerRequestId: reservation.requestId }, signal);
    if (!registered.ok || registered.type !== "shared-knowledge-index-register-result") throw unavailable();
    check();
    // Start observing Main's exact output verification before asking for spawn.
    // This wait intentionally survives caller abort so cleanup can drain it.
    // Credential/Host loss still rejects it through the receipt client lifecycle.
    mainResult = receipts.request({ type: "shared-knowledge-index-wait", handleId, indexId });
    void mainResult.catch(() => undefined);
    startup = workers.start(reservation);
    const [, snapshot] = await Promise.all([
      startup.then(async current => {
        worker = current; check();
        if (await current.completion !== "completed") throw unavailable();
      }),
      mainResult.then(verified => {
        if (!verified.ok || verified.type !== "shared-knowledge-index-wait-result" || verified.state !== "verified-unpublished") throw unavailable();
        return { ...verified.snapshot };
      })
    ]);
    check();
    assertObservation = await revalidate(snapshot, signal); check(); assertObservation();
    // The early observation is not a commit grant. Main repeats independent
    // read + current-Host head/model checks inside its filesystem publisher.
    publicationMayHaveCommitted = true;
    const published = await receipts.request({ type: "shared-knowledge-index-publish", handleId, indexId }, signal);
    if (published.type !== "shared-knowledge-index-publish-result") throw indeterminate();
    if (!published.ok) {
      publicationMayHaveCommitted = published.errorCode === "PUBLICATION_INDETERMINATE";
      throw publicationMayHaveCommitted ? indeterminate() : unavailable();
    }
    if (published.state !== "published-local" || published.snapshot.epoch !== snapshot.epoch || published.snapshot.cursor !== snapshot.cursor) throw indeterminate();
    check();
    return { state: "published-local" as const, snapshot: { ...published.snapshot } };
  };
  const cleanup = async (successful: boolean) => {
    lifetime.abort(); reservation?.stop();
    if (!successful && handleId && indexId) {
      await receipts.request({ type: "shared-knowledge-index-cancel", handleId, indexId }).catch(() => undefined);
    }
    if (startup) await startup.catch(() => undefined);
    if (worker) {
      if (successful) await worker.stop(); else await worker.stop().catch(() => undefined);
    }
    if (mainResult) await mainResult.catch(() => undefined);
    if (handleId) {
      const closed = await receipts.request({ type: "shared-knowledge-receipt-close", handleId }).catch(() => undefined);
      if (successful && (!closed?.ok || closed.type !== "shared-knowledge-receipt-close-result")) {
        throw new Error("Shared knowledge index handle cleanup could not be confirmed.");
      }
    }
  };
  const result = await perform().catch(async error => {
    // Best-effort cleanup cannot replace a possible-commit outcome with an
    // ordinary cleanup error or imply that closing rolled the pointer back.
    await cleanup(false).catch(() => undefined);
    throw publicationMayHaveCommitted ? indeterminate() : error;
  });
  try {
    await cleanup(true); options.signal.throwIfAborted(); receipts.signal.throwIfAborted(); assertCurrent(); assertObservation!(); return result;
  } catch { throw indeterminate(); }
}
