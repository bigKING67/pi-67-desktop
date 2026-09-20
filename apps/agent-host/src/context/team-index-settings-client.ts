import { randomUUID } from "node:crypto";
import { isTeamIndexSettingsMessage, type TeamIndexSettings, type TeamIndexSettingsRequest } from "@pi67/protocol";

const unavailable = () => new Error("Team index settings unavailable.");
/** Private parent client only. Invalidations and process shutdown retire both
 * pending reads and already-resolved settings used by an index owner. */
export class TeamIndexSettingsClient {
  #generation = new AbortController();
  #stopped = false;
  #pending = new Map<string, { resolve(settings: TeamIndexSettings): void; fail(): void }>();
  constructor(private readonly parent: { postMessage(message: TeamIndexSettingsRequest): void }) {}
  get signal(): AbortSignal { return this.#generation.signal; }
  load(caller: AbortSignal): Promise<TeamIndexSettings> {
    if (this.#stopped || caller.aborted || this.#pending.size >= 4) return Promise.reject(unavailable());
    const requestId = randomUUID(), signal = AbortSignal.any([caller, this.signal]);
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); this.#pending.delete(requestId); };
      const fail = () => { cleanup(); reject(unavailable()); };
      const abort = () => {
        cleanup();
        try { this.parent.postMessage({ type: "team-index-settings-cancel", requestId }); } catch { /* Closed parent. */ }
        reject(unavailable());
      };
      const timer = setTimeout(abort, 8_000); timer.unref?.();
      this.#pending.set(requestId, { fail, resolve: settings => {
        if (signal.aborted || this.#stopped) { abort(); return; }
        cleanup(); resolve(structuredClone(settings));
      } });
      signal.addEventListener("abort", abort, { once: true });
      try { this.parent.postMessage({ type: "team-index-settings-read", requestId }); } catch { fail(); }
    });
  }
  handleMessage(value: unknown): boolean {
    if (!isTeamIndexSettingsMessage(value)) return false;
    if (this.#stopped) return true;
    if (value.type === "team-index-settings-invalidated") {
      const previous = this.#generation; this.#generation = new AbortController(); previous.abort();
    } else {
      const pending = this.#pending.get(value.requestId);
      if (value.ok) pending?.resolve(value.settings); else pending?.fail();
    }
    return true;
  }
  shutdown(): void { this.#stopped = true; this.#generation.abort(); }
}
