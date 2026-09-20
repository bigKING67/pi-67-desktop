import {
  isLocalMemoryConnectRequest, isLocalMemoryConnectResult,
  type LocalMemoryConnection, type LocalMemoryConnectResult
} from "@pi67/protocol";

export interface LocalMemoryServicePort {
  connect(): Promise<LocalMemoryConnection>;
  inspect?(): LocalMemoryConnection;
  stop(): Promise<void>;
}

/** Only the current utility-process parent channel may call this broker. */
export class LocalMemorySupervisor {
  #stopped = false;
  #connection: Promise<LocalMemoryConnection> | undefined;
  #activeService: LocalMemoryServicePort | undefined;
  #stop: Promise<void> | undefined;

  constructor(private readonly getService: () => LocalMemoryServicePort | undefined) {}

  operation(message: unknown): Promise<LocalMemoryConnectResult> | undefined {
    if (!isLocalMemoryConnectRequest(message)) return undefined;
    return this.#connect(message.requestId, message.start !== false);
  }

  stop(): Promise<void> {
    if (this.#stop) return this.#stop;
    this.#stopped = true;
    // Service.stop must abort any in-flight connect, not wait for it to finish.
    this.#stop = this.#activeService?.stop() ?? Promise.resolve();
    return this.#stop;
  }

  async #connect(requestId: string, start: boolean): Promise<LocalMemoryConnectResult> {
    const failure = (errorCode: "NOT_CONFIGURED" | "RUNTIME_UNAVAILABLE" | "STOPPING"): LocalMemoryConnectResult => ({
      type: "local-memory-connect-result", requestId, ok: false, errorCode
    });
    if (this.#stopped) return failure("STOPPING");
    try {
      const service = this.#activeService ?? this.getService();
      if (!service) return failure("NOT_CONFIGURED");
      if (!start) {
        if (!service.inspect) return failure("RUNTIME_UNAVAILABLE");
        const result = { type: "local-memory-connect-result" as const, requestId, ok: true as const, connection: service.inspect() };
        return isLocalMemoryConnectResult(result) ? result : failure("RUNTIME_UNAVAILABLE");
      }
      this.#activeService = service;
      this.#connection ??= service.connect();
      const pending = this.#connection;
      let connection: LocalMemoryConnection;
      try { connection = await pending; }
      finally { if (this.#connection === pending) this.#connection = undefined; }
      if (this.#stopped) return failure("STOPPING");
      const result = { type: "local-memory-connect-result" as const, requestId, ok: true as const, connection };
      if (!isLocalMemoryConnectResult(result)) return failure("RUNTIME_UNAVAILABLE");
      return result;
    } catch {
      // Never forward model credentials, filesystem paths or native child output.
      return failure(this.#stopped ? "STOPPING" : "RUNTIME_UNAVAILABLE");
    }
  }
}
