import {
  DEFAULT_MAX_ENVELOPE_BYTES,
  correlateInvalidRequest,
  isEnvelopeWithinByteLimit,
  isRendererHello,
  isRequestEnvelope,
  responseEnvelope,
  welcomeEnvelope,
  type AgentCommandType,
  type CommandResults,
  type CommandResponse,
  type HostWelcome,
  type ProtocolError,
  type ProtocolPort,
  type RequestEnvelope
} from "@pi67/protocol";

type PortListener = (event: unknown) => void;

export interface HostConnectionIdentity {
  appInstanceId?: string;
  hostInstanceId: string;
  hostEpoch: number;
}

export interface HostWelcomeRuntime {
  sdkVersion: string;
  eventSequence: number;
}

export class HostConnectionContext {
  private handshaken = false;
  private handshakePending = false;
  private retired = false;
  private closed = false;
  private pendingResponses = 0;
  private negotiatedMaxEnvelopeBytes = DEFAULT_MAX_ENVELOPE_BYTES;
  private readonly seenRequestIds = new Set<string>();
  private readonly messageListener: PortListener = (event) => this.handleMessage(extractData(event));
  private readonly messageErrorListener: PortListener = () => this.retire("message-error");
  private readonly closeListener: PortListener = () => this.close(false, "peer-closed");
  private disconnectNotified = false;

  constructor(
    private readonly port: ProtocolPort,
    readonly identity: HostConnectionIdentity,
    private readonly getWelcomeRuntime: () => Promise<HostWelcomeRuntime>,
    private readonly onRequest: (connection: HostConnectionContext, request: RequestEnvelope) => void,
    private readonly onDisconnect: () => void = () => undefined,
    private readonly maxSeenRequestIds = 2_048
  ) {
    this.addListener("message", this.messageListener);
    this.addListener("messageerror", this.messageErrorListener);
    this.addListener("close", this.closeListener);
    port.start?.();
  }

  get isCurrentCandidate(): boolean {
    return !this.retired && !this.closed;
  }

  beginResponse(): void {
    this.pendingResponses += 1;
  }

  sendSuccess<T extends AgentCommandType>(requestId: string, type: T, result: CommandResults[T]): void {
    const response = { ok: true, type, result } as CommandResponse<T>;
    const envelope = responseEnvelope(requestId, this.identity.hostEpoch, response);
    if (!isEnvelopeWithinByteLimit(envelope, this.negotiatedMaxEnvelopeBytes)) {
      this.sendError(requestId, type, {
        code: "RESOURCE_LIMIT_EXCEEDED",
        message: "The Agent Host response exceeds the negotiated envelope limit.",
        recoverable: true
      });
      return;
    }
    this.sendResponse(
      envelope,
      type === "asset.read"
        ? [(result as CommandResults["asset.read"]).data]
        : undefined
    );
  }

  sendError<T extends AgentCommandType>(requestId: string, type: T, error: ProtocolError): void {
    const response = { ok: false, type, error } as CommandResponse<T>;
    const envelope = responseEnvelope(requestId, this.identity.hostEpoch, response);
    if (isEnvelopeWithinByteLimit(envelope, this.negotiatedMaxEnvelopeBytes)) {
      this.sendResponse(envelope);
      return;
    }
    this.sendResponse(responseEnvelope(requestId, this.identity.hostEpoch, {
      ok: false,
      type,
      error: {
        code: "RESOURCE_LIMIT_EXCEEDED",
        message: "The Agent Host error exceeds the negotiated envelope limit.",
        recoverable: true
      }
    }));
  }

  postEvent(envelope: unknown): boolean {
    if (!this.handshaken || this.retired || this.closed) return false;
    if (!isEnvelopeWithinByteLimit(envelope, this.negotiatedMaxEnvelopeBytes)) {
      this.retire("event-envelope-too-large");
      return false;
    }
    try {
      this.port.postMessage(envelope);
      return true;
    } catch {
      this.retire("event-post-failed");
      return false;
    }
  }

  retire(reason = "connection-replaced"): void {
    if (this.retired) return;
    debugConnection(reason);
    this.retired = true;
    this.notifyDisconnect();
    this.removeListener("message", this.messageListener);
    this.removeListener("messageerror", this.messageErrorListener);
    if (this.pendingResponses === 0) this.close();
  }

  close(closePort = true, reason = "connection-closed"): void {
    if (this.closed) return;
    debugConnection(reason);
    this.closed = true;
    this.notifyDisconnect();
    this.removeListener("message", this.messageListener);
    this.removeListener("messageerror", this.messageErrorListener);
    this.removeListener("close", this.closeListener);
    if (closePort) this.port.close?.();
  }

  private notifyDisconnect(): void {
    if (this.disconnectNotified) return;
    this.disconnectNotified = true;
    this.onDisconnect();
  }

  private handleMessage(data: unknown): void {
    if (!isEnvelopeWithinByteLimit(data, this.negotiatedMaxEnvelopeBytes)) {
      const invalid = this.handshaken ? correlateInvalidRequest(data) : undefined;
      if (invalid) {
        this.sendError(invalid.requestId, invalid.type, {
          code: "RESOURCE_LIMIT_EXCEEDED",
          message: "The request exceeds the negotiated envelope limit.",
          recoverable: true
        });
      } else {
        this.close(true, "request-envelope-too-large");
      }
      return;
    }
    if (!this.handshaken) {
      if (!isRendererHello(data)) {
        this.close(true, "invalid-hello");
        return;
      }
      if (this.identity.appInstanceId !== undefined && data.appInstanceId !== this.identity.appInstanceId) {
        this.close(true, "wrong-app-instance");
        return;
      }
      if (this.handshakePending) return;
      this.handshakePending = true;
      void this.completeHandshake(data.appInstanceId, data.maxEnvelopeBytes);
      return;
    }
    if (!isRequestEnvelope(data)) {
      const invalid = correlateInvalidRequest(data);
      if (invalid) {
        this.sendError(invalid.requestId, invalid.type, invalid.hostEpoch === this.identity.hostEpoch
          ? { code: "INVALID_PAYLOAD", message: "The request payload is invalid.", recoverable: false }
          : {
              code: "STALE_HOST_EPOCH",
              message: "The request targets a stale Agent Host generation.",
              recoverable: true,
              details: { expectedHostEpoch: this.identity.hostEpoch, receivedHostEpoch: invalid.hostEpoch }
            });
      }
      return;
    }
    if (data.hostEpoch !== this.identity.hostEpoch) {
      this.sendError(data.requestId, data.type, {
        code: "STALE_HOST_EPOCH",
        message: "The request targets a stale Agent Host generation.",
        recoverable: true,
        details: { expectedHostEpoch: this.identity.hostEpoch, receivedHostEpoch: data.hostEpoch }
      });
      return;
    }
    if (this.seenRequestIds.has(data.requestId)) {
      this.sendError(data.requestId, data.type, {
        code: "DUPLICATE_REQUEST",
        message: "The request ID has already been used on this connection.",
        recoverable: false
      });
      return;
    }
    this.seenRequestIds.add(data.requestId);
    while (this.seenRequestIds.size > this.maxSeenRequestIds) {
      const oldest = this.seenRequestIds.values().next().value as string | undefined;
      if (oldest === undefined) break;
      this.seenRequestIds.delete(oldest);
    }
    this.beginResponse();
    this.onRequest(this, data);
  }

  private async completeHandshake(appInstanceId: string, peerMaxEnvelopeBytes: number): Promise<void> {
    try {
      const runtime = await this.getWelcomeRuntime();
      if (this.closed || this.retired) return;
      const welcome: HostWelcome = welcomeEnvelope({
        appInstanceId,
        hostInstanceId: this.identity.hostInstanceId,
        hostEpoch: this.identity.hostEpoch,
        sdkVersion: runtime.sdkVersion,
        eventSequence: runtime.eventSequence,
        capabilities: {
          operations: true,
          eventSequence: true,
          structuredErrors: true,
          transferableImages: true,
          transferableAssets: true,
          idempotentControlMutations: true
        },
        maxEnvelopeBytes: Math.min(DEFAULT_MAX_ENVELOPE_BYTES, peerMaxEnvelopeBytes)
      });
      this.negotiatedMaxEnvelopeBytes = welcome.maxEnvelopeBytes;
      this.port.postMessage(welcome);
      this.handshaken = true;
    } catch {
      this.close(true, "handshake-failed");
    } finally {
      this.handshakePending = false;
    }
  }

  private sendResponse(envelope: unknown, transfer?: Transferable[]): void {
    if (this.closed) return;
    try {
      if (transfer && transfer.length > 0) this.port.postMessage(envelope, transfer);
      else this.port.postMessage(envelope);
    } catch (error) {
      debugConnection("response-post-failed", {
        type: envelopeType(envelope),
        error: error instanceof Error ? error.name : "unknown"
      });
      this.retire("response-post-failed");
    } finally {
      this.pendingResponses = Math.max(0, this.pendingResponses - 1);
      if (this.retired && this.pendingResponses === 0) this.close();
    }
  }

  private addListener(type: "message" | "messageerror" | "close", listener: PortListener): void {
    if (this.port.addEventListener) this.port.addEventListener(type, listener);
    else this.port.on?.(type, listener);
  }

  private removeListener(type: "message" | "messageerror" | "close", listener: PortListener): void {
    if (this.port.removeEventListener) this.port.removeEventListener(type, listener);
    else this.port.off?.(type, listener);
  }
}

function debugConnection(
  reason: string,
  detail?: { type: string; error: string }
): void {
  if (process.env.PI67_DEBUG_AGENT_STDERR === "1") {
    const suffix = detail
      ? ` type=${detail.type} error=${detail.error}`
      : "";
    console.error(`[agent-host] connection closed: ${reason}${suffix}`);
  }
}

function envelopeType(envelope: unknown): string {
  if (typeof envelope !== "object" || envelope === null) return "unknown";
  const type = (envelope as { type?: unknown }).type;
  return typeof type === "string" && type.length <= 80 ? type : "unknown";
}

export function isAttachPortMessage(value: unknown): value is {
  type: "attach-port";
  expectedOrigin?: string;
  appInstanceId?: string;
  hostInstanceId?: string;
  hostEpoch?: number;
} {
  if (typeof value !== "object" || value === null || (value as { type?: unknown }).type !== "attach-port") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.expectedOrigin !== undefined && typeof candidate.expectedOrigin !== "string") return false;
  if (candidate.appInstanceId !== undefined && typeof candidate.appInstanceId !== "string") return false;
  if (candidate.hostInstanceId !== undefined && typeof candidate.hostInstanceId !== "string") return false;
  if (candidate.hostEpoch !== undefined && (!Number.isInteger(candidate.hostEpoch) || Number(candidate.hostEpoch) < 0)) return false;
  return true;
}

function extractData(event: unknown): unknown {
  return typeof event === "object" && event !== null && "data" in event
    ? (event as { data: unknown }).data
    : event;
}
