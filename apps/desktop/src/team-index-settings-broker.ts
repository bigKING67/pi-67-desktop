import { isTeamIndexSettingsRequest, isTeamIndexSettingsMessage, type TeamIndexSettingsMessage } from "@pi67/protocol";
import type { LocalMemoryModelSettingsStore } from "./local-memory-model-settings.js";

type Host = { postMessage(message: TeamIndexSettingsMessage): void };
type Store = Pick<LocalMemoryModelSettingsStore, "load" | "signal">;

/** Current ready utility-process parent only. No Renderer or native-worker route.
 * Capacity includes cancelled/obsolete reads until their filesystem IO settles. */
export class TeamIndexSettingsBroker {
  #pending = new Map<string, { host: Host; controller: AbortController }>();
  #watched: { store: Store; signal: AbortSignal; changed(this: void): void } | undefined;
  #stopped = false;
  constructor(private readonly currentHost: () => Host | undefined, private readonly getStore: () => Store | undefined,
    private readonly retireResources: () => void) {}

  handleMessage(host: Host, value: unknown): boolean {
    if (!isTeamIndexSettingsRequest(value)) return false;
    if (this.#stopped || this.currentHost() !== host) return true;
    if (value.type === "team-index-settings-cancel") {
      const pending = this.#pending.get(value.requestId);
      if (pending?.host === host) pending.controller.abort();
      return true;
    }
    // Duplicate IDs cannot receive a second answer which races the original.
    if (this.#pending.has(value.requestId)) return true;
    if (this.#pending.size >= 4) { this.#send(host, { type: "team-index-settings-result", requestId: value.requestId, ok: false, errorCode: "BUSY" }); return true; }
    const controller = new AbortController();
    this.#pending.set(value.requestId, { host, controller });
    void this.#read(host, value.requestId, controller).finally(() => this.#pending.delete(value.requestId));
    return true;
  }
  retire(): void { for (const value of this.#pending.values()) value.controller.abort(); }
  stop(): void {
    this.#stopped = true; this.retire();
    this.#watched?.signal.removeEventListener("abort", this.#watched.changed); this.#watched = undefined;
  }
  #watch(store: Store): void {
    if (this.#watched?.store === store && this.#watched.signal === store.signal) return;
    const previous = this.#watched;
    previous?.signal.removeEventListener("abort", previous.changed);
    const changed = () => {
      this.retire(); this.retireResources();
      const host = this.currentHost();
      if (host) this.#send(host, { type: "team-index-settings-invalidated" });
      if (!this.#stopped) this.#watch(store);
    };
    this.#watched = { store, signal: store.signal, changed };
    store.signal.addEventListener("abort", changed, { once: true });
    if (previous && previous.store !== store) {
      this.retire(); this.retireResources();
      const host = this.currentHost(); if (host) this.#send(host, { type: "team-index-settings-invalidated" });
    }
  }
  async #read(host: Host, requestId: string, owner: AbortController): Promise<void> {
    const timer = setTimeout(() => owner.abort(), 5_000); timer.unref?.();
    try {
      const store = this.getStore();
      if (!store) throw new Error();
      this.#watch(store);
      const generation = store.signal;
      const settings = await store.load();
      if (generation.aborted || owner.signal.aborted || this.getStore() !== store) return;
      const message = { type: "team-index-settings-result" as const, requestId, ok: true as const, settings };
      if (!isTeamIndexSettingsMessage(message)) throw new Error();
      this.#send(host, message);
    } catch {
      if (!owner.signal.aborted) this.#send(host, { type: "team-index-settings-result", requestId, ok: false, errorCode: "UNAVAILABLE" });
    } finally { clearTimeout(timer); }
  }
  #send(host: Host, message: TeamIndexSettingsMessage): void {
    if (this.#stopped || this.currentHost() !== host) return;
    try { host.postMessage(message); } catch { /* Closed parent; never log secrets. */ }
  }
}
