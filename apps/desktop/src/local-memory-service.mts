import type { KeyObject } from "node:crypto";
import { loadLocalMemoryIdentity } from "./local-memory-identity.mjs";
import { bindLocalMemoryIndex } from "./local-memory-index-binding.mjs";
import { startNativeOpenViking, type OpenVikingModelConfiguration, type NativeOpenVikingHandle } from "./openviking-native-process.mjs";
import { admitOpenVikingRuntime } from "./openviking-runtime-admission.js";
import { OpenVikingSidecarSupervisor } from "./openviking-sidecar-supervisor.mjs";
import { LocalMemoryStartupTrace, type LocalMemoryStartupReceipt } from "./local-memory-startup.mjs";

export interface LocalMemoryServiceConfiguration {
  /** Main-owned installation selection, not supplied by Host or Renderer. */
  runtimeRoot: string;
  manifest: Buffer;
  signature: Buffer;
  dataRoot: string;
  embedding: OpenVikingModelConfiguration & { dimension: number };
  extraction: OpenVikingModelConfiguration;
}

/** Concrete broker service. Config and trust provisioning remain Main-owned. */
export class LocalMemoryService {
  readonly #supervisor: OpenVikingSidecarSupervisor<NativeOpenVikingHandle>;
  #handle: NativeOpenVikingHandle | undefined;
  #healthCheck: Promise<"healthy" | "unavailable" | "not-running"> | undefined;
  #healthAbort: AbortController | undefined;

  constructor(options: {
    trustedKey: KeyObject;
    /** Must honor cancellation; no credential values may be logged. */
    loadConfiguration(signal: AbortSignal): Promise<LocalMemoryServiceConfiguration>;
    recordStartup?(receipt: LocalMemoryStartupReceipt): Promise<void>;
  }) {
    // Trust is separate from the loaded manifest/configuration; never accept a
    // public key from the downloaded bundle itself.
    const trustedKey = options.trustedKey;
    this.#supervisor = new OpenVikingSidecarSupervisor(async (lifecycleSignal, onExit) => {
      // Includes configuration, full-tree admission, native readiness and scope
      // provisioning. Host allows another ten seconds for bounded cleanup/reply.
      const signal = AbortSignal.any([lifecycleSignal, AbortSignal.timeout(60_000)]);
      const trace = new LocalMemoryStartupTrace();
      let outcome: "completed" | "failed" = "failed";
      try {
        const configuration = await trace.measure("configuration", () => options.loadConfiguration(signal));
        signal.throwIfAborted();
        const { python } = await trace.measure("runtime-admission", () => admitOpenVikingRuntime(configuration, trustedKey, signal));
        signal.throwIfAborted();
        const localProfileId = await trace.measure("storage-binding", async () => {
          const identity = await loadLocalMemoryIdentity(configuration.dataRoot);
          signal.throwIfAborted();
          await bindLocalMemoryIndex(configuration.dataRoot, configuration.embedding);
          return identity;
        });
        signal.throwIfAborted();
        const handle = await trace.measure("native-start", () => startNativeOpenViking({ python, dataRoot: configuration.dataRoot, localProfileId,
          embedding: configuration.embedding, extraction: configuration.extraction, startupTrace: trace }, signal, onExit));
        outcome = "completed";
        return handle;
      } finally {
        const receipt = trace.finish(outcome);
        try { await options.recordStartup?.(receipt); }
        catch { console.error("Local memory startup diagnostics could not be saved."); }
      }
    });
  }

  async connect() {
    const handle = await this.#supervisor.ensureStarted();
    if (!this.#supervisor.isCurrent(handle)) throw new Error("Local memory connection is no longer available.");
    this.#handle = handle;
    // Return a copy: callers never receive the Main-only provisioning handle.
    return { ...handle.connection };
  }

  get status() { return this.#supervisor.status; }

  inspect() {
    const handle = this.#handle;
    if (!handle || !this.#supervisor.isCurrent(handle)) throw new Error("Local memory is not running.");
    return { ...handle.connection };
  }

  /** Checks only the admitted live handle; never starts a service or invokes a model. */
  checkHealth(): Promise<"healthy" | "unavailable" | "not-running"> {
    if (this.#healthCheck) return this.#healthCheck;
    const handle = this.#handle;
    if (!handle || !this.#supervisor.isCurrent(handle)) return Promise.resolve("not-running");
    const controller = new AbortController();
    this.#healthAbort = controller;
    const pending = (async () => {
      try {
        const response = await fetch(`${handle.connection.endpoint}/health`, {
          redirect: "error", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3_000)])
        });
        await response.body?.cancel();
        if (!this.#supervisor.isCurrent(handle)) return "not-running" as const;
        return response.ok ? "healthy" as const : "unavailable" as const;
      } catch {
        return this.#supervisor.isCurrent(handle) ? "unavailable" as const : "not-running" as const;
      }
    })().finally(() => { this.#healthCheck = undefined; this.#healthAbort = undefined; });
    this.#healthCheck = pending;
    return pending;
  }

  stop(): Promise<void> {
    this.#healthAbort?.abort();
    return this.#supervisor.stop();
  }
}
