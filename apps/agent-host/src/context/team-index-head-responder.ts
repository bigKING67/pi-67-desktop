import { isSharedKnowledgeIndexHeadRequest, type SharedKnowledgeIndexHeadCheck, type SharedKnowledgeIndexHeadResult } from "@pi67/protocol";

interface Observation { validUntil: number; signal: AbortSignal; assertValid(): void; release(): void }
interface Entry { controller: AbortController; observation?: Observation; settled: boolean; sent: boolean; cleanup(): void }

/** Private Main parent only. Retain successful observations for invalidation,
 * not just the HTTP response. Cancellation never frees an unfinished IO slot. */
export class TeamIndexHeadResponder {
  #entries = new Map<string, Entry>();
  #stopped = false;
  constructor(private readonly parent: { postMessage(message: SharedKnowledgeIndexHeadResult): void },
    private readonly observe: (input: SharedKnowledgeIndexHeadCheck, signal: AbortSignal) => Promise<Observation>) {}

  handleMessage(value: unknown): boolean {
    if (!isSharedKnowledgeIndexHeadRequest(value)) return false;
    if (this.#stopped) return true;
    if (value.type === "team-index-head-cancel") { this.#entries.get(value.requestId)?.controller.abort(); return true; }
    if (this.#entries.has(value.requestId)) return true;
    if (this.#entries.size >= 4) { this.#send({ type: "team-index-head-result", requestId: value.requestId, ok: false }); return true; }
    const request = structuredClone(value), controller = new AbortController();
    let timer = setTimeout(() => {
      // Abort first: Main may synchronously cancel when it receives the failure.
      // Neither that reply nor cancellation releases an unsettled IO slot.
      controller.abort(new DOMException("Head observation timed out.", "TimeoutError"));
      this.#send({ type: "team-index-head-result", requestId: request.requestId, ok: false });
    }, 8_000); timer.unref?.();
    const retire = () => {
      clearTimeout(timer);
      if (entry.sent) this.#send({ type: "team-index-head-invalidated", requestId: request.requestId });
      if (entry.settled) entry.cleanup();
    };
    const entry: Entry = { controller, settled: false, sent: false, cleanup: () => {
      clearTimeout(timer); controller.signal.removeEventListener("abort", retire);
      entry.observation?.signal.removeEventListener("abort", retireObservation);
      entry.observation?.release(); this.#entries.delete(request.requestId);
    } };
    const retireObservation = () => controller.abort();
    controller.signal.addEventListener("abort", retire, { once: true });
    this.#entries.set(request.requestId, entry);
    void (async () => {
      try {
        controller.signal.throwIfAborted();
        const observation = await this.observe(request, controller.signal);
        entry.observation = observation; entry.settled = true;
        controller.signal.throwIfAborted(); observation.signal.throwIfAborted(); observation.assertValid();
        if (!Number.isSafeInteger(observation.validUntil) || observation.validUntil <= Date.now()) throw new Error();
        observation.signal.addEventListener("abort", retireObservation, { once: true });
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), Math.min(90_000, observation.validUntil - Date.now())); timer.unref?.();
        entry.sent = true;
        if (!this.#send({ type: "team-index-head-result", requestId: request.requestId, ok: true, validUntil: observation.validUntil })) controller.abort();
      } catch {
        entry.settled = true;
        if (!controller.signal.aborted) this.#send({ type: "team-index-head-result", requestId: request.requestId, ok: false });
        entry.cleanup();
      }
    })();
    return true;
  }
  shutdown(): void { this.#stopped = true; for (const entry of this.#entries.values()) entry.controller.abort(); }
  #send(message: SharedKnowledgeIndexHeadResult): boolean {
    if (this.#stopped) return false;
    try { this.parent.postMessage(message); return true; } catch { return false; }
  }
}
