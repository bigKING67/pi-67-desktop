import {
  isReplaySafeControlMutation,
  ProtocolRequestError,
  type AgentCommandType,
  type AgentEvent,
  type CommandPayloads,
  type CommandResults,
  type ProjectionResyncResult,
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
import {
  bindRequestAbort,
  postRequestCancellation,
  requestCancelled,
  waitForRequestConnection
} from "./port-request-cancellation.js";
import { acknowledgementTimeout } from "./port-request-timeout.js";
import type { RendererConnectionTeardownReason } from "./runtime-diagnostics-contract.js";
import {
  agentConnectionError as connectionError,
  extractPortEventData as extractEventData,
  toAgentConnectionIdentity as toConnectionIdentity,
  type AgentConnectionIdentity,
  type SequenceGap
} from "./port-client-connection.js";
import {
  releasePendingPortRequest,
  type PendingPortRequest,
  type PortEventType,
  type PortListener,
  type ProtocolPort
} from "./port-client-state.js";

export type { AgentConnectionIdentity, SequenceGap } from "./port-client-connection.js";
export type { ProtocolPort } from "./port-client-state.js";

export { CONTROL_MUTATION_ACK_TIMEOUT_MS } from "./port-request-timeout.js";

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
  ackTimeoutMs?: number;
  signal?: AbortSignal;
}

export type ProjectionResyncInstaller = (result: ProjectionResyncResult) => boolean;

export class AgentPortClient {
  private readonly pending = new Map<string, PendingPortRequest>();
  private readonly eventListeners = new Set<(event: AgentEvent, envelope: EventEnvelope) => void>();
  private readonly sequenceGapListeners = new Set<(gap: SequenceGap) => void>();
  private readonly teardownListeners = new Set<(
    error: ProtocolRequestErrorType,
    reason: RendererConnectionTeardownReason
  ) => void>();
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
  private teardownReceipt: {
    error: ProtocolRequestErrorType;
    reason: RendererConnectionTeardownReason;
  } | undefined;
  private readonly messageListener = (event: unknown) => this.handleMessage(extractEventData(event));
  private readonly messageErrorListener = () => this.teardown(
    connectionError("Agent connection message could not be decoded."),
    true,
    "message-decode-failed"
  );
  private readonly closeListener = () => this.teardown(
    connectionError("Agent connection closed."),
    false,
    "port-closed"
  );

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
      if (!this.welcome) this.teardown(
        connectionError("Pi runtime service handshake timed out."),
        true,
        "handshake-timeout"
      );
    }, this.handshakeTimeoutMs);
    void this.readyPromise.finally(() => clearTimeout(handshakeTimeout)).catch(() => undefined);
    try {
      port.postMessage(helloEnvelope(this.rendererInstanceId, this.appInstanceId, this.maxEnvelopeBytes));
    } catch {
      this.teardown(
        connectionError("Pi runtime service handshake could not be sent."),
        true,
        "handshake-send-failed"
      );
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

  onTeardown(listener: (
    error: ProtocolRequestErrorType,
    reason: RendererConnectionTeardownReason
  ) => void): () => void {
    const receipt = this.teardownReceipt;
    if (receipt) {
      queueMicrotask(() => listener(receipt.error, receipt.reason));
      return () => undefined;
    }
    this.teardownListeners.add(listener);
    return () => this.teardownListeners.delete(listener);
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
    const identity = await waitForRequestConnection(this.readyPromise, options.signal, type);
    if (this.closed) throw connectionError("Agent connection closed.");
    if (options.signal?.aborted) throw requestCancelled(type);
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
    const ackTimeoutMs = acknowledgementTimeout(options.ackTimeoutMs, type, this.requestTimeoutMs);
    const response = new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.takePending(envelope.requestId);
        if (!pending) return;
        if (pending.sent) this.cancelHostRequest(envelope.requestId, identity.hostEpoch);
        reject(new ProtocolRequestError({
          code: "REQUEST_TIMEOUT",
          message: `Agent request acknowledgement timed out: ${type}`,
          recoverable: true
        }));
      }, ackTimeoutMs);
      const pending: PendingPortRequest = {
        type,
        context: envelope.context,
        resolve: resolve as (value: never) => void,
        reject,
        timeout,
        sent: false
      };
      if (options.signal) {
        const onAbort = () => {
          const cancelled = this.takePending(envelope.requestId);
          if (!cancelled) return;
          if (cancelled.sent) this.cancelHostRequest(envelope.requestId, identity.hostEpoch);
          reject(requestCancelled(type));
        };
        pending.abort = bindRequestAbort(options.signal, onAbort);
      }
      this.pending.set(envelope.requestId, pending);
    });
    const pending = this.pending.get(envelope.requestId);
    if (!pending) return response;
    try {
      pending.sent = true;
      this.port.postMessage(envelope, transfer);
    } catch {
      this.teardown(
        connectionError(`Agent request could not be sent: ${type}`),
        true,
        "request-send-failed"
      );
    }
    return response;
  }

  dispose(): void {
    this.teardown(connectionError("Agent connection closed."), true, "disposed");
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
      this.teardown(new ProtocolRequestError(data.error), true, "handshake-rejected");
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
    this.takePending(data.requestId);
    if (data.ok) pending.resolve(data.result as never);
    else pending.reject(new ProtocolRequestError(data.error));
  }

  private handleWelcome(welcome: HostWelcome): void {
    if (this.welcome || this.closed) return;
    if (welcome.appInstanceId !== this.appInstanceId) {
      this.teardown(
        connectionError("Pi runtime service handshake used the wrong application identity."),
        true,
        "handshake-identity-mismatch"
      );
      return;
    }
    if (this.expectedHostEpoch !== undefined && welcome.hostEpoch !== this.expectedHostEpoch) {
      this.teardown(new ProtocolRequestError({
        code: "STALE_HOST_EPOCH",
        message: "Pi runtime service handshake used an unexpected service generation.",
        recoverable: true,
        details: { expectedHostEpoch: this.expectedHostEpoch, receivedHostEpoch: welcome.hostEpoch }
      }), true, "handshake-identity-mismatch");
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

  private teardown(
    error: ProtocolRequestErrorType,
    closePort = true,
    reason: RendererConnectionTeardownReason = "protocol-violation"
  ): void {
    if (this.closed) return;
    this.closed = true;
    this.teardownReceipt = { error, reason };
    this.removePortListener("message", this.messageListener);
    this.removePortListener("messageerror", this.messageErrorListener);
    this.removePortListener("close", this.closeListener);
    if (closePort) this.port.close?.();
    if (!this.welcome) this.rejectReady(error);
    for (const pending of this.pending.values()) {
      releasePendingPortRequest(pending);
      pending.reject(error);
    }
    this.pending.clear();
    for (const listener of this.teardownListeners) listener(error, reason);
    this.teardownListeners.clear();
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

  private takePending(requestId: string): PendingPortRequest | undefined {
    const pending = this.pending.get(requestId);
    if (!pending) return undefined;
    this.pending.delete(requestId);
    releasePendingPortRequest(pending);
    return pending;
  }

  private cancelHostRequest(requestId: string, hostEpoch: number): void {
    if (this.closed) return;
    postRequestCancellation(this.port, requestId, hostEpoch, () => this.teardown(
      connectionError("Agent request cancellation could not be sent."),
      true,
      "request-cancellation-send-failed"
    ));
  }
}
