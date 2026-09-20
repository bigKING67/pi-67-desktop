import type { LocalMemoryActivationSnapshot, LocalMemoryHealthCheck } from "@pi67/protocol";
import type { LocalMemoryActivationStore } from "./local-memory-activation-store.js";
import type { LocalMemoryService } from "./local-memory-service.mjs";

type Snapshot = Extract<LocalMemoryActivationSnapshot, { available: true }>;
/** Main owns consent. The Host launch selection never changes within this app run. */
export class LocalMemoryActivationController {
  #preference: Snapshot["preference"] = "unknown";
  #selected = false;
  #initialized = false;
  #initializing = false;
  #revoked = false;
  #closed = false;
  #warmupAttempted = false;
  #issue: Snapshot["issue"] = "none";
  #pending: Promise<LocalMemoryActivationSnapshot> | undefined;
  constructor(private readonly options: {
    store: Pick<LocalMemoryActivationStore, "load" | "save">;
    service: Pick<LocalMemoryService, "connect" | "stop" | "status" | "checkHealth"> & Partial<Pick<LocalMemoryService, "inspect">>;
    prerequisites(): Promise<"ready" | "runtime-missing" | "models-missing">;
  }) {}
  async initialize(): Promise<void> {
    if (this.#initialized || this.#initializing) throw new Error("Activation is already initialized.");
    this.#initializing = true;
    try {
      const enabled = await this.options.store.load();
      if (this.#closed) return;
      this.#preference = enabled ? "enabled" : "disabled";
      this.#selected = enabled;
    } catch { this.#issue = "storage"; }
    finally { this.#initialized = true; this.#initializing = false; }
  }
  get selectedAtLaunch() { return this.#selected; }
  /** Once per app, after Host readiness. Same consent, admission and single-flight as a Session. */
  async warmup(): Promise<"skipped" | "ready" | "unavailable"> {
    if (!this.#initialized || !this.#selected || this.#preference !== "enabled"
      || this.#closed || this.#revoked || this.#warmupAttempted) return "skipped";
    this.#warmupAttempted = true;
    try { await this.connect(); return "ready"; }
    catch { return "unavailable"; } // Lifecycle still exposes failed/blocked; no retry or fallback.
  }
  get(): LocalMemoryActivationSnapshot {
    const lifecycle = this.options.service.status;
    return { available: true, preference: this.#preference, selectedAtLaunch: this.#selected,
      restartRequired: (this.#preference === "enabled") !== this.#selected
        || (this.#preference === "enabled" && this.#revoked),
      lifecycle, busy: this.#pending !== undefined,
      issue: lifecycle === "stop-failed" ? "stop-failed" : this.#issue };
  }
  async check(): Promise<LocalMemoryHealthCheck> {
    const allowed = () => this.#selected && this.#preference === "enabled" && !this.#revoked && !this.#closed;
    const health = allowed() ? await this.options.service.checkHealth() : "not-running";
    return { activation: this.get(), health: allowed() ? health : "not-running" };
  }
  setEnabled(enabled: boolean): Promise<LocalMemoryActivationSnapshot> {
    if (typeof enabled !== "boolean" || !this.#initialized || this.#closed || this.#pending) {
      return Promise.reject(new Error("Memory activation change is unavailable."));
    }
    // Fence cached broker references immediately, even if persisting disable fails.
    const stopping = !enabled ? (this.#revoked = true, this.options.service.stop()) : undefined;
    const stopped = stopping?.then(() => true, () => false);
    const pending = Promise.resolve().then(async () => {
      this.#issue = "none";
      if (enabled) {
        let prerequisite;
        try { prerequisite = await this.options.prerequisites(); }
        catch { this.#issue = "prerequisites"; return; }
        if (prerequisite !== "ready") { this.#issue = prerequisite; return; }
        if (this.#closed) return;
      }
      try { await this.options.store.save(enabled); this.#preference = enabled ? "enabled" : "disabled"; }
      catch { this.#preference = "unknown"; this.#issue = "storage"; }
      if (stopped && !await stopped) this.#issue = "stop-failed";
    }).then(() => {
      this.#pending = undefined;
      return this.get();
    }, (error: unknown) => { this.#pending = undefined; throw error; });
    this.#pending = pending;
    return pending;
  }
  async connect() {
    const allowed = () => this.#selected && this.#preference === "enabled" && !this.#revoked && !this.#closed;
    if (!allowed()) throw new Error("Private memory requires explicit activation and application restart.");
    const connection = await this.options.service.connect();
    if (!allowed()) throw new Error("Private memory activation was revoked.");
    return connection;
  }
  inspect() {
    if (!this.#selected || this.#preference !== "enabled" || this.#revoked || this.#closed || !this.options.service.inspect) {
      throw new Error("Private memory inspection is unavailable.");
    }
    return this.options.service.inspect();
  }
  async stop(): Promise<void> {
    this.#closed = true; this.#revoked = true;
    const [cleanup] = await Promise.allSettled([this.options.service.stop(), this.#pending]);
    if (cleanup.status === "rejected") throw new Error("Private memory cleanup failed.");
  }
}
