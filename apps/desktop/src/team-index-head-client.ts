import { randomUUID } from "node:crypto";
import { isSharedKnowledgeIndexHeadRequest, isSharedKnowledgeIndexHeadResult,
  type SharedKnowledgeIndexHeadCheck, type SharedKnowledgeIndexHeadRequest, type SharedKnowledgeIndexHeadResult } from "@pi67/protocol";

type Host = { postMessage(message: SharedKnowledgeIndexHeadRequest): void };
type Input = Omit<SharedKnowledgeIndexHeadCheck, "type" | "requestId">;
interface Entry { host: Host; accept(message: SharedKnowledgeIndexHeadResult): void; retire(): void }
const unavailable = () => new Error("Team index head observation unavailable.");

/** Main's current-ready-Host client. A successful reply is a bounded observation,
 * not independent read authorization. Keep it revocable through the commit IO. */
export class TeamIndexHeadClient {
  #entries = new Map<string, Entry>();
  constructor(private readonly currentHost: () => Host | undefined) {}
  verify(input: Input, signal: AbortSignal): Promise<() => void> {
    const host = this.currentHost();
    if (!host || signal.aborted || this.#entries.size >= 4) return Promise.reject(unavailable());
    const { endpoint, userId, teamId, scopeKind, scopeId } = input.owner;
    const request: SharedKnowledgeIndexHeadCheck = { type: "team-index-head-check", requestId: randomUUID(),
      owner: { endpoint, userId, teamId, scopeKind, scopeId }, models: structuredClone(input.models),
      snapshot: { ...input.snapshot }, permissionRevision: input.permissionRevision };
    if (!isSharedKnowledgeIndexHeadRequest(request)) return Promise.reject(unavailable());
    const started = Date.now(), monotonicStart = performance.now();
    return new Promise((resolve, reject) => {
      let retired = false, resolved = false, deadline = started + 90_000, lastWall = started;
      let timer = setTimeout(() => retire(), 10_000); timer.unref?.();
      const retire = () => {
        if (retired) return; retired = true;
        clearTimeout(timer); signal.removeEventListener("abort", retire); this.#entries.delete(request.requestId);
        try { host.postMessage({ type: "team-index-head-cancel", requestId: request.requestId }); } catch { /* Closed Host. */ }
        if (!resolved) reject(unavailable());
      };
      const check = () => {
        const now = Date.now();
        if (retired || signal.aborted || this.currentHost() !== host || now < lastWall || now >= deadline
          || performance.now() < monotonicStart || performance.now() >= monotonicStart + deadline - started) {
          retire(); throw unavailable();
        }
        lastWall = now;
      };
      this.#entries.set(request.requestId, { host, retire, accept: message => {
        if (message.type === "team-index-head-invalidated" || !message.ok) { retire(); return; }
        if (resolved) { retire(); return; }
        deadline = Math.min(deadline, message.validUntil);
        try { check(); } catch { return; }
        clearTimeout(timer); timer = setTimeout(retire, Math.max(0, deadline - Date.now())); timer.unref?.();
        resolved = true; resolve(check);
      } });
      signal.addEventListener("abort", retire, { once: true });
      try { host.postMessage(request); } catch { retire(); }
    });
  }
  handleMessage(host: Host, value: unknown): boolean {
    if (!isSharedKnowledgeIndexHeadResult(value)) return false;
    const entry = this.#entries.get(value.requestId);
    if (entry?.host === host && this.currentHost() === host) entry.accept(value);
    return true;
  }
  retire(): void { for (const entry of this.#entries.values()) entry.retire(); }
}
