import { randomUUID } from "node:crypto";
import { isLocalMemoryConnectResult, type LocalMemoryConnection, type LocalMemoryConnectRequest } from "@pi67/protocol";
import { HostCommandError } from "../protocol-error.js";

interface PendingConnection {
  resolve: (connection: LocalMemoryConnection) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function managedLocalMemoryFromEnvironment(environment: NodeJS.ProcessEnv): boolean {
  const mode = environment.PI67_MANAGED_LOCAL_MEMORY;
  if (mode === "1") return true;
  if (mode === undefined || mode === "0") return false;
  throw new Error("Invalid Main-selected local memory mode.");
}

export function managedLocalMemoryOptions(enabled: boolean | undefined, broker: LocalMemoryBrokerClient | undefined) {
  return enabled ? { localMemory: { connect: () => broker?.connect()
    ?? Promise.reject(new Error("Managed local memory broker is unavailable.")) } } : {};
}

export class LocalMemoryBrokerClient {
  #pending: PendingConnection | undefined;
  #requestId: string | undefined;
  #connecting: Promise<LocalMemoryConnection> | undefined;
  #stopped = false;
  #inspection: LocalMemoryBrokerClient | undefined;

  constructor(private readonly parent: { postMessage(message: LocalMemoryConnectRequest): void },
    private readonly timeoutMs = 70_000, private readonly readOnly = false) {}

  inspect(): Promise<LocalMemoryConnection> {
    if (this.#stopped) return Promise.reject(new HostCommandError("CONNECTION_CLOSED", "Local memory broker is stopped.", true));
    this.#inspection ??= new LocalMemoryBrokerClient(this.parent, 5_000, true);
    return this.#inspection.connect();
  }

  connect(): Promise<LocalMemoryConnection> {
    if (this.#stopped) return Promise.reject(new HostCommandError("CONNECTION_CLOSED", "Local memory broker is stopped.", true));
    if (this.#connecting) return this.#connecting;
    const requestId = randomUUID();
    this.#requestId = requestId;
    const connecting = new Promise<LocalMemoryConnection>((resolve, reject) => {
      const timer = setTimeout(() => this.#reject("Local memory startup timed out."), this.timeoutMs);
      timer.unref?.();
      this.#pending = { resolve, reject, timer };
      try { this.parent.postMessage({ type: "local-memory-connect", requestId, ...(this.readOnly ? { start: false as const } : {}) }); }
      catch { this.#reject("Local memory parent channel is unavailable."); }
    }).finally(() => { if (this.#connecting === connecting) this.#connecting = undefined; });
    this.#connecting = connecting;
    return connecting;
  }

  handleResult(message: unknown): boolean {
    if (this.#inspection?.handleResult(message)) return true;
    if (!isLocalMemoryConnectResult(message) || message.requestId !== this.#requestId || !this.#pending) return false;
    const pending = this.#pending;
    this.#clear();
    if (message.ok) pending.resolve(message.connection);
    else pending.reject(new HostCommandError("RUNTIME_NOT_READY", `Local memory is unavailable (${message.errorCode}).`, true));
    return true;
  }

  shutdown(): void {
    this.#stopped = true;
    this.#inspection?.shutdown();
    this.#reject("Local memory broker is shutting down.");
  }

  #reject(message: string): void {
    const pending = this.#pending;
    this.#clear();
    pending?.reject(new HostCommandError("RUNTIME_NOT_READY", message, true));
  }

  #clear(): void {
    if (this.#pending) clearTimeout(this.#pending.timer);
    this.#pending = undefined;
    this.#requestId = undefined;
  }
}
