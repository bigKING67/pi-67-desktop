import {
  isReplaySafeControlMutation,
  ProtocolRequestError,
  type AgentCommandType,
  type AgentEvent,
  type CommandPayloads,
  type CommandResults,
  type ProjectionResyncResult,
  type ProtocolError,
  type ProtocolRequestError as ProtocolRequestErrorType
} from "./agent-messages.js";
import {
  APP_PROTOCOL_CONTEXT,
  DEFAULT_MAX_ENVELOPE_BYTES,
  commandEnvelope,
  correlateInvalidResponse,
  createMessageId,
  helloEnvelope,
  isEnvelopeWithinByteLimit,
  isEventEnvelope,
  isHandshakeRejected,
  isHostWelcome,
  isRequestEnvelope,
  isResponseEnvelope,
  protocolContextsEqual,
  type EventEnvelope,
  type HostWelcome,
  type ProtocolContext
} from "./envelope.js";
import { correlateInvalidEvent } from "./event-context.js";

interface PortMessageEvent {
  data: unknown;
}

type PortEventType = "message" | "messageerror" | "close";
type PortListener = (event: unknown) => void;

export interface ProtocolPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  start?(): void;
  close?(): void;
  addEventListener?(type: PortEventType, listener: PortListener): void;
  removeEventListener?(type: PortEventType, listener: PortListener): void;
  on?(type: PortEventType, listener: PortListener): void;
  off?(type: PortEventType, listener: PortListener): void;
}

interface PendingRequest {
  type: AgentCommandType;
  context: ProtocolContext;
  resolve: (value: never) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface AgentConnectionIdentity {
  appInstanceId: string;
  hostInstanceId: string;
  hostEpoch: number;
  sdkVersion: string;
  eventSequence: number;
}

export interface SequenceGap {
  expected: number;
  received: number;
  hostEpoch: number;
}

export interface AgentPortClientOptions {
  rendererInstanceId?: string;
  appInstanceId?: string;
  expectedHostEpoch?: number;
  handshakeTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxEnvelopeBytes?: number;
  onSequenceGap?: (gap: SequenceGap) => void;
}

export interface AgentRequestOptions {
  idempotencyKey?: string;
  context?: ProtocolContext;
}

export type ProjectionResyncInstaller = (result: ProjectionResyncResult) => boolean;

export const CONTROL_MUTATION_ACK_TIMEOUT_MS = 60_000;

export class AgentPortClient {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly eventListeners = new Set<(event: AgentEvent, envelope: EventEnvelope) => void>();
  private readonly sequenceGapListeners = new Set<(gap: SequenceGap) => void>();
  private readonly rendererInstanceId: string;
  private readonly appInstanceId: string;
  private readonly handshakeTimeoutMs: number;
  private readonly expectedHostEpoch: number | undefined;
  private readonly requestTimeoutMs: number;
  private readonly maxEnvelopeBytes: number;
  private negotiatedMaxEnvelopeBytes: number | undefined;
  private readonly readyPromise: Promise<AgentConnectionIdentity>;
  private resolveReady!: (identity: AgentConnectionIdentity) => void;
  private rejectReady!: (error: Error) => void;
  private welcome: HostWelcome | undefined;
  private lastSequence = 0;
  private sequenceBroken = false;
  private projectionResyncAttempt = 0;
  private closed = false;
  private readonly messageListener = (event: unknown) => this.handleMessage(extractEventData(event));
  private readonly messageErrorListener = () => this.teardown(connectionError("Agent connection message could not be decoded."));
  private readonly closeListener = () => this.teardown(connectionError("Agent connection closed."), false);

  constructor(private readonly port: ProtocolPort, options: number | AgentPortClientOptions = {}) {
    const resolved = typeof options === "number" ? { requestTimeoutMs: options } : options;
    this.rendererInstanceId = resolved.rendererInstanceId ?? createMessageId("renderer");
    this.appInstanceId = resolved.appInstanceId ?? createMessageId("app");
    this.handshakeTimeoutMs = resolved.handshakeTimeoutMs ?? 5_000;
    this.expectedHostEpoch = resolved.expectedHostEpoch;
    this.requestTimeoutMs = resolved.requestTimeoutMs ?? 15_000;
    this.maxEnvelopeBytes = resolved.maxEnvelopeBytes ?? DEFAULT_MAX_ENVELOPE_BYTES;
    if (resolved.onSequenceGap) this.sequenceGapListeners.add(resolved.onSequenceGap);
    this.readyPromise = new Promise<AgentConnectionIdentity>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.addPortListener("message", this.messageListener);
    this.addPortListener("messageerror", this.messageErrorListener);
    this.addPortListener("close", this.closeListener);
    port.start?.();
    const handshakeTimeout = setTimeout(() => {
      if (!this.welcome) this.teardown(connectionError("Pi runtime service handshake timed out."));
    }, this.handshakeTimeoutMs);
    void this.readyPromise.finally(() => clearTimeout(handshakeTimeout)).catch(() => undefined);
    try {
      port.postMessage(helloEnvelope(this.rendererInstanceId, this.appInstanceId, this.maxEnvelopeBytes));
    } catch {
      this.teardown(connectionError("Pi runtime service handshake could not be sent."));
    }
  }

  get identity(): AgentConnectionIdentity | undefined {
    if (!this.welcome) return undefined;
    return toConnectionIdentity(this.welcome);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  waitUntilReady(): Promise<AgentConnectionIdentity> {
    return this.readyPromise;
  }

  onEvent(listener: (event: AgentEvent, envelope: EventEnvelope) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onSequenceGap(listener: (gap: SequenceGap) => void): () => void {
    this.sequenceGapListeners.add(listener);
    return () => this.sequenceGapListeners.delete(listener);
  }

  async resyncProjection(
    install: ProjectionResyncInstaller,
    context: ProtocolContext = APP_PROTOCOL_CONTEXT
  ): Promise<boolean> {
    const attempt = ++this.projectionResyncAttempt;
    // The authoritative snapshot owns every event through its sequence. Keep
    // later events closed until the caller has installed that snapshot.
    this.sequenceBroken = true;
    const result = await this.request("projection.resync", {}, [], { context });
    if (result.hostEpoch !== this.welcome?.hostEpoch) {
      throw new ProtocolRequestError({
        code: "STALE_HOST_EPOCH",
        message: "Projection resync returned a stale Host generation.",
        recoverable: true
      });
    }
    if (!this.canCommitProjectionResync(attempt)) return false;
    if (result.eventSequence < this.lastSequence) {
      throw new ProtocolRequestError({
        code: "INVALID_PAYLOAD",
        message: "Projection resync returned a regressive event sequence.",
        recoverable: true,
        details: {
          currentEventSequence: this.lastSequence,
          receivedEventSequence: result.eventSequence
        }
      });
    }
    if (!install(result)) return false;
    if (!this.canCommitProjectionResync(attempt)) return false;
    this.lastSequence = result.eventSequence;
    this.sequenceBroken = false;
    return true;
  }

  async request<T extends AgentCommandType, TResult = CommandResults[T]>(
    type: T,
    payload: CommandPayloads[T],
    transfer: Transferable[] = [],
    options: AgentRequestOptions = {}
  ): Promise<TResult> {
    const identity = await this.readyPromise;
    if (this.closed) throw connectionError("Agent connection closed.");
    if (options.idempotencyKey !== undefined && !isReplaySafeControlMutation(type)) {
      throw new ProtocolRequestError({
        code: "INVALID_PAYLOAD",
        message: `Agent command does not accept an idempotency key: ${type}`,
        recoverable: false
      });
    }
    const envelope = commandEnvelope(
      type,
      payload,
      options.context ?? APP_PROTOCOL_CONTEXT,
      identity.hostEpoch,
      options.idempotencyKey
    );
    if (!isRequestEnvelope(envelope)) {
      throw new ProtocolRequestError({
        code: "INVALID_PAYLOAD",
        message: `Agent request is invalid: ${type}`,
        recoverable: false
      });
    }
    if (!isEnvelopeWithinByteLimit(envelope, this.negotiatedMaxEnvelopeBytes ?? this.maxEnvelopeBytes)) {
      throw new ProtocolRequestError({
        code: "RESOURCE_LIMIT_EXCEEDED",
        message: `Agent request exceeds the negotiated envelope limit: ${type}`,
        recoverable: true
      });
    }
    const response = new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(envelope.requestId);
        reject(new ProtocolRequestError({
          code: "REQUEST_TIMEOUT",
          message: `Agent request acknowledgement timed out: ${type}`,
          recoverable: true
        }));
      }, timeoutFor(type, this.requestTimeoutMs));
      this.pending.set(envelope.requestId, {
        type,
        context: envelope.context,
        resolve: resolve as (value: never) => void,
        reject,
        timeout
      });
    });
    try {
      this.port.postMessage(envelope, transfer);
    } catch {
      this.teardown(connectionError(`Agent request could not be sent: ${type}`));
    }
    return response;
  }

  dispose(): void {
    this.teardown(connectionError("Agent connection closed."));
  }

  private handleMessage(data: unknown): void {
    if (!isEnvelopeWithinByteLimit(data, this.negotiatedMaxEnvelopeBytes ?? this.maxEnvelopeBytes)) {
      this.teardown(new ProtocolRequestError({
        code: "RESOURCE_LIMIT_EXCEEDED",
        message: "The Pi runtime service sent an envelope larger than the negotiated limit.",
        recoverable: true
      }));
      return;
    }
    if (isHandshakeRejected(data)) {
      this.teardown(new ProtocolRequestError(data.error));
      return;
    }
    if (isHostWelcome(data)) {
      this.handleWelcome(data);
      return;
    }
    if (!this.welcome || this.closed) return;
    if (isEventEnvelope(data)) {
      if (data.hostEpoch !== this.welcome.hostEpoch) return;
      if (this.sequenceBroken) return;
      const expected = this.lastSequence + 1;
      if (data.sequence !== expected) {
        const gap = { expected, received: data.sequence, hostEpoch: data.hostEpoch };
        this.sequenceBroken = true;
        for (const listener of this.sequenceGapListeners) listener(gap);
        return;
      }
      this.lastSequence = data.sequence;
      for (const listener of this.eventListeners) listener({ type: data.type, payload: data.payload } as AgentEvent, data);
      return;
    }
    const invalidEvent = correlateInvalidEvent(data);
    if (invalidEvent?.hostEpoch === this.welcome.hostEpoch) {
      this.teardown(new ProtocolRequestError({
        code: "INVALID_PAYLOAD",
        message: "Pi 运行服务发送了无效的事件响应。",
        recoverable: true
      }));
      return;
    }
    if (!isResponseEnvelope(data)) {
      const invalid = correlateInvalidResponse(data);
      if (invalid?.hostEpoch === this.welcome.hostEpoch && this.pending.has(invalid.requestId)) {
        this.teardown(new ProtocolRequestError({
          code: "INVALID_PAYLOAD",
          message: "Pi 运行服务返回了无法匹配当前请求的响应。",
          recoverable: true
        }));
      }
      return;
    }
    if (data.hostEpoch !== this.welcome.hostEpoch) return;
    const pending = this.pending.get(data.requestId);
    if (!pending) return;
    if (pending.type !== data.type || !protocolContextsEqual(pending.context, data.context)) {
      this.teardown(new ProtocolRequestError({
        code: "INVALID_PAYLOAD",
        message: "Pi 运行服务返回了属于其他工作区或任务的响应。",
        recoverable: true
      }));
      return;
    }
    this.pending.delete(data.requestId);
    clearTimeout(pending.timeout);
    if (data.ok) pending.resolve(data.result as never);
    else pending.reject(new ProtocolRequestError(data.error));
  }

  private handleWelcome(welcome: HostWelcome): void {
    if (this.welcome || this.closed) return;
    if (welcome.appInstanceId !== this.appInstanceId) {
      this.teardown(connectionError("Pi runtime service handshake used the wrong application identity."));
      return;
    }
    if (this.expectedHostEpoch !== undefined && welcome.hostEpoch !== this.expectedHostEpoch) {
      this.teardown(new ProtocolRequestError({
        code: "STALE_HOST_EPOCH",
        message: "Pi runtime service handshake used an unexpected service generation.",
        recoverable: true,
        details: { expectedHostEpoch: this.expectedHostEpoch, receivedHostEpoch: welcome.hostEpoch }
      }));
      return;
    }
    this.welcome = welcome;
    this.negotiatedMaxEnvelopeBytes = Math.min(this.maxEnvelopeBytes, welcome.maxEnvelopeBytes);
    this.lastSequence = welcome.eventSequence;
    this.resolveReady(toConnectionIdentity(welcome));
  }

  private canCommitProjectionResync(attempt: number): boolean {
    return !this.closed
      && this.welcome !== undefined
      && attempt === this.projectionResyncAttempt;
  }

  private teardown(error: ProtocolRequestErrorType, closePort = true): void {
    if (this.closed) return;
    this.closed = true;
    this.removePortListener("message", this.messageListener);
    this.removePortListener("messageerror", this.messageErrorListener);
    this.removePortListener("close", this.closeListener);
    if (closePort) this.port.close?.();
    if (!this.welcome) this.rejectReady(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.eventListeners.clear();
    this.sequenceGapListeners.clear();
  }

  private addPortListener(type: PortEventType, listener: PortListener): void {
    if (this.port.addEventListener) this.port.addEventListener(type, listener);
    else this.port.on?.(type, listener);
  }

  private removePortListener(type: PortEventType, listener: PortListener): void {
    if (this.port.removeEventListener) this.port.removeEventListener(type, listener);
    else this.port.off?.(type, listener);
  }
}

function extractEventData(event: unknown): unknown {
  return typeof event === "object" && event !== null && "data" in event
    ? (event as PortMessageEvent).data
    : event;
}

function toConnectionIdentity(welcome: HostWelcome): AgentConnectionIdentity {
  return {
    appInstanceId: welcome.appInstanceId,
    hostInstanceId: welcome.hostInstanceId,
    hostEpoch: welcome.hostEpoch,
    sdkVersion: welcome.sdkVersion,
    eventSequence: welcome.eventSequence
  };
}

function connectionError(message: string): ProtocolRequestError {
  const error: ProtocolError = { code: "CONNECTION_CLOSED", message, recoverable: true };
  return new ProtocolRequestError(error);
}

function timeoutFor(type: AgentCommandType, fallback: number): number {
  if (isReplaySafeControlMutation(type)) return CONTROL_MUTATION_ACK_TIMEOUT_MS;
  if (type === "prompt.submit" || type === "command.invoke" || type === "session.compact" || type === "session.import") return 5_000;
  if (type === "runtime.getStatus") return 5_000;
  return fallback;
}
