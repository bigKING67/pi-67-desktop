import type { AgentCommandType, AgentEvent, CommandPayloads, CommandResponse } from "./agent-messages.js";
import { commandEnvelope, isEventEnvelope, isResponseEnvelope } from "./envelope.js";

interface PortMessageEvent {
  data: unknown;
}

export interface ProtocolPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  start?(): void;
  close?(): void;
  addEventListener?(type: "message", listener: (event: PortMessageEvent) => void): void;
  removeEventListener?(type: "message", listener: (event: PortMessageEvent) => void): void;
  on?(type: "message", listener: (event: unknown) => void): void;
  off?(type: "message", listener: (event: unknown) => void): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class AgentPortClient {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly eventListeners = new Set<(event: AgentEvent) => void>();
  private readonly messageListener = (event: unknown) => {
    const data = typeof event === "object" && event !== null && "data" in event
      ? (event as PortMessageEvent).data
      : event;
    this.handleMessage(data);
  };

  constructor(private readonly port: ProtocolPort, private readonly timeoutMs = 30_000) {
    if (port.addEventListener) port.addEventListener("message", this.messageListener);
    else port.on?.("message", this.messageListener);
    port.start?.();
  }

  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  async request<T extends AgentCommandType, TResult = unknown>(
    type: T,
    payload: CommandPayloads[T],
    transfer: Transferable[] = []
  ): Promise<TResult> {
    const envelope = commandEnvelope(type, payload);
    const response = new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(envelope.requestId);
        reject(new Error(`Agent command timed out: ${type}`));
      }, this.timeoutMs);
      this.pending.set(envelope.requestId, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timeout
      });
    });
    this.port.postMessage(envelope, transfer);
    return response;
  }

  dispose(): void {
    if (this.port.removeEventListener) this.port.removeEventListener("message", this.messageListener);
    else this.port.off?.("message", this.messageListener);
    this.port.close?.();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Agent connection closed."));
    }
    this.pending.clear();
    this.eventListeners.clear();
  }

  private handleMessage(data: unknown): void {
    if (isEventEnvelope(data)) {
      for (const listener of this.eventListeners) listener(data.event);
      return;
    }
    if (!isResponseEnvelope(data)) return;
    const pending = this.pending.get(data.requestId);
    if (!pending) return;
    this.pending.delete(data.requestId);
    clearTimeout(pending.timeout);
    settleResponse(data.response, pending);
  }
}

function settleResponse(response: CommandResponse, pending: PendingRequest): void {
  if (response.ok) {
    pending.resolve(response.data);
    return;
  }
  const error = response.error;
  pending.reject(new Error(error ? `${error.code}: ${error.message}` : "Agent command failed."));
}
