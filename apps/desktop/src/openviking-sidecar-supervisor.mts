export interface OpenVikingSidecarHandle {
  stop(): Promise<void>;
}

export type OpenVikingSidecarStatus = "idle" | "starting" | "running" | "failed" | "blocked"
  | "stopping" | "stopped" | "stop-failed";

interface SidecarGeneration<T> {
  controller: AbortController;
  handle?: T;
  stopping?: Promise<void>;
  exited: boolean;
  intentionalStop: boolean;
  failureCounted: boolean;
}

/** Main-owned, demand-driven lifecycle. No model routing or Agent loop. */
export class OpenVikingSidecarSupervisor<T extends OpenVikingSidecarHandle> {
  readonly #launch: (signal: AbortSignal, onExit: () => void) => Promise<T>;
  readonly #now: () => number;
  #generation: SidecarGeneration<T> | undefined;
  #starting: Promise<T> | undefined;
  #stopping: Promise<void> | undefined;
  #failures: number[] = [];
  #disposed = false;
  #blocked = false;
  #shutdownStatus: "stopping" | "stopped" | "stop-failed" | undefined;

  constructor(launch: (signal: AbortSignal, onExit: () => void) => Promise<T>, now = Date.now) {
    this.#launch = launch;
    this.#now = now;
  }

  /** In-memory observation only: never launches, probes or returns child details. */
  get status(): OpenVikingSidecarStatus {
    if (this.#shutdownStatus) return this.#shutdownStatus;
    if (this.#blocked) return "blocked";
    if (this.#starting) return "starting";
    if (this.#generation?.exited) return "failed";
    return this.#generation?.handle ? "running" : "idle";
  }

  /** Recheck after awaits; a resolved startup promise is not a live generation. */
  isCurrent(handle: T): boolean {
    return this.status === "running" && this.#generation?.handle === handle;
  }

  ensureStarted(): Promise<T> {
    if (this.#disposed) return Promise.reject(new Error("OpenViking lifecycle is stopped."));
    if (this.#blocked) return Promise.reject(new Error("OpenViking restart budget exhausted."));
    if (this.#starting) return this.#starting;
    if (this.#generation?.handle && !this.#generation.exited) return Promise.resolve(this.#generation.handle);
    const generation: SidecarGeneration<T> = {
      controller: new AbortController(), exited: false, intentionalStop: false, failureCounted: false
    };
    this.#generation = generation;
    const starting = Promise.resolve().then(() => {
      generation.controller.signal.throwIfAborted();
      return this.#launch(generation.controller.signal, () => {
        generation.exited = true;
        this.#recordFailure(generation);
      });
    }).then(async (handle) => {
      generation.handle = handle;
      if (this.#disposed || generation.exited || generation.controller.signal.aborted) {
        generation.stopping = Promise.resolve().then(() => handle.stop());
        await generation.stopping;
        throw new Error("OpenViking startup was interrupted.");
      }
      return handle;
    }).catch((error: unknown) => {
      generation.exited = true;
      this.#recordFailure(generation);
      throw error;
    }).finally(() => {
      if (this.#starting === starting) this.#starting = undefined;
    });
    this.#starting = starting;
    return starting;
  }

  stop(): Promise<void> {
    if (this.#stopping) return this.#stopping;
    this.#disposed = true;
    this.#shutdownStatus = "stopping";
    const generation = this.#generation;
    if (generation) {
      generation.intentionalStop = true;
      generation.controller.abort();
    }
    const starting = this.#starting;
    this.#stopping = (async () => {
      if (starting) {
        // The launch adapter must clean up on abort; late handles are stopped above.
        await starting.catch(() => undefined);
        await generation?.stopping;
      } else if (generation?.handle) {
        // Native parent exit starts asynchronous descendant/config cleanup.
        // Join its idempotent stop even after onExit; exited is not cleaned up.
        await generation.handle.stop();
      }
    })().then(() => { this.#shutdownStatus = "stopped"; }, (error: unknown) => {
      this.#shutdownStatus = "stop-failed";
      throw error;
    });
    return this.#stopping;
  }

  #recordFailure(generation: SidecarGeneration<T>): void {
    if (generation.intentionalStop || generation.failureCounted) return;
    generation.failureCounted = true;
    const now = this.#now();
    this.#failures = this.#failures.filter((time) => now - time < 10 * 60_000);
    this.#failures.push(now);
    if (this.#failures.length >= 3) this.#blocked = true;
  }
}
