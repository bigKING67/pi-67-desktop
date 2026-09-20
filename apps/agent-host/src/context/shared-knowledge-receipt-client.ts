import { randomUUID } from "node:crypto";
import { isSharedKnowledgeReceiptRequest, isSharedKnowledgeReceiptResult, TEAM_WORKER_PREPARATION_TIMEOUT_MS, TEAM_WORKER_HANDOFF_TIMEOUT_MS,
  type SharedKnowledgeReceiptRequest, type SharedKnowledgeReceiptResult } from "@pi67/protocol";

type Request = SharedKnowledgeReceiptRequest extends infer R ? R extends SharedKnowledgeReceiptRequest ? Omit<R, "requestId"> : never : never;
interface Pending {
  type: SharedKnowledgeReceiptRequest["type"];
  indexHandle?: string;
  resolve(value: SharedKnowledgeReceiptResult): void;
  reject(error: Error): void;
  cleanup(): void;
}

/** Unconnected Host parent-port client. Instantiate for one credential generation;
 * shutdown on account/service change or Host disposal. Results are receipt data,
 * not model permission or index freshness. No retries or cross-scope fallback. */
export class SharedKnowledgeReceiptClient {
  readonly #pending = new Map<string, Pending>();
  readonly #abandonedOpens = new Set<string>();
  readonly #identity: Readonly<{ userId: string; endpoint: string }>;
  #stopped = false;
  readonly #lifetime = new AbortController();
  get signal(): AbortSignal { return this.#lifetime.signal; }
  constructor(private readonly parent: { postMessage(message: SharedKnowledgeReceiptRequest): void },
    identity: { userId: string; endpoint: string }, private readonly timeoutMs = 8_000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error("Invalid receipt IPC timeout.");
    this.#identity = Object.freeze({ userId: identity.userId, endpoint: identity.endpoint });
  }

  request(input: Request, signal?: AbortSignal): Promise<SharedKnowledgeReceiptResult> {
    if (this.#stopped) return Promise.reject(new Error("Shared receipt client is stopped."));
    if (signal?.aborted) return Promise.reject(new Error("Shared receipt request cancelled."));
    if (this.#pending.size >= 16 || (input.type === "shared-knowledge-receipt-open"
      && this.#abandonedOpens.size + this.#pending.size >= 128)) return Promise.reject(new Error("Shared receipt client capacity exceeded."));
    const requestId = randomUUID();
    const message = structuredClone({ ...input, requestId });
    if (!isSharedKnowledgeReceiptRequest(message)) return Promise.reject(new Error("Invalid shared receipt request."));
    return new Promise((resolve, reject) => {
      const abort = () => this.#reject(requestId, "Shared receipt request cancelled.");
      // Receipt IO retains its short timeout. Index preparation has its own Main
      // 60-second bound plus reply margin; no model reservation is held yet.
      const timeout = message.type === "shared-knowledge-index-prepare" || message.type === "shared-knowledge-index-query-prepare" || message.type === "shared-knowledge-index-query" || message.type === "shared-knowledge-index-read" || message.type === "shared-knowledge-index-read-current"
        ? TEAM_WORKER_PREPARATION_TIMEOUT_MS + 2 * TEAM_WORKER_HANDOFF_TIMEOUT_MS
        : message.type === "shared-knowledge-index-wait" ? 400_000
          : message.type === "shared-knowledge-index-publish" ? 100_000 : this.timeoutMs;
      const timer = setTimeout(() => this.#reject(requestId, "Shared receipt request timed out."), timeout);
      timer.unref?.();
      this.#pending.set(requestId, { type: message.type,
        ...(message.type.startsWith("shared-knowledge-index-") && "handleId" in message ? { indexHandle: message.handleId } : {}), resolve, reject, cleanup: () => {
        clearTimeout(timer); signal?.removeEventListener("abort", abort);
      } });
      signal?.addEventListener("abort", abort, { once: true });
      try { this.parent.postMessage(message); }
      catch { this.#reject(requestId, "Shared receipt parent channel is unavailable."); }
    });
  }

  handleResult(value: unknown): boolean {
    if (!isSharedKnowledgeReceiptResult(value)) return false;
    if (this.#abandonedOpens.has(value.requestId)) {
      if (value.type !== "shared-knowledge-receipt-open-result") return false;
      this.#abandonedOpens.delete(value.requestId);
      if (value.ok) this.#closeOrphan(value.handleId);
      return true;
    }
    const pending = this.#pending.get(value.requestId);
    if (!pending) return false;
    if (value.type !== `${pending.type}-result`) {
      this.#reject(value.requestId, "Shared receipt response operation mismatch.");
      return true;
    }
    this.#pending.delete(value.requestId); pending.cleanup();
    if (value.ok && value.type === "shared-knowledge-receipt-open-result"
      && (value.userId !== this.#identity.userId || value.endpoint !== this.#identity.endpoint)) {
      this.#closeOrphan(value.handleId);
      pending.reject(new Error("Shared receipt response identity mismatch."));
    } else pending.resolve(value);
    return true;
  }

  shutdown(): void {
    this.#stopped = true;
    this.#lifetime.abort();
    for (const id of this.#pending.keys()) this.#reject(id, "Shared receipt client is shutting down.");
  }

  #reject(id: string, message: string): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id); pending.cleanup();
    // Bounded tombstones let a late open be closed instead of leaking a Main
    // handle. If replies never arrive, new opens eventually fail capacity closed.
    if (pending.type === "shared-knowledge-receipt-open") this.#abandonedOpens.add(id);
    // An index run owns this separate handle until physical completion. Closing
    // it cancels pending preparation even if its reply/indexId arrives late.
    if (pending.indexHandle) this.#closeOrphan(pending.indexHandle);
    // Closing cancels the exact owner but cannot undo a pointer that Main may
    // already have committed. A lost publish reply never proves non-publication.
    pending.reject(pending.type === "shared-knowledge-index-publish"
      ? Object.assign(new Error(message), { outcome: "indeterminate" as const }) : new Error(message));
  }

  #closeOrphan(handleId: string): void {
    try { this.parent.postMessage({ type: "shared-knowledge-receipt-close", requestId: randomUUID(), handleId }); }
    catch { /* Main Host-generation invalidation remains the final cleanup owner. */ }
  }
}
