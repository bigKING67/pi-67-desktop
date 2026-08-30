import {
  DEFAULT_MAX_ENVELOPE_BYTES,
  correlateInvalidRequest,
  isEnvelopeWithinByteLimit,
  isEventEnvelope,
  isHandshakeCandidate,
  isRequestCancellationEnvelope,
  isRendererHello,
  isRequestEnvelope,
  isResponseEnvelope,
  responseEnvelope,
  handshakeRejectedEnvelope,
  welcomeEnvelope,
  type AgentCommandType,
  type CommandResults,
  type CommandResponse,
  type HostWelcome,
  type ProtocolError,
  type ProtocolPort,
  type RequestEnvelope
} from "@pi67/protocol";
import {
  classifyDiagnosticError,
  diagnosticBinaryByteEvidence,
  diagnosticEnvelopeType,
  hostDiagnosticReason,
  hostIncident,
  type HostDiagnosticIncidentInput
} from "./host-diagnostic-evidence.js";

const INVALID_HOST_RESPONSE_ERROR: ProtocolError = {
  code: "INTERNAL",
  message: "The Pi runtime service produced an invalid response.",
  recoverable: true
};
const OVERSIZED_HOST_RESPONSE_ERROR: ProtocolError = {
  code: "RESOURCE_LIMIT_EXCEEDED",
  message: "The Pi runtime service response exceeds the negotiated envelope limit.",
  recoverable: true
};
const PENDING_REQUEST_LIMIT_ERROR: ProtocolError = {
  code: "RESOURCE_LIMIT_EXCEEDED",
  message: "The Renderer connection has too many pending requests.",
  recoverable: true
};

type PortListener = (event: unknown) => void;
type ResponseAuthority = Pick<RequestEnvelope, "requestId" | "type" | "context">;
type HostResponsePort = Omit<ProtocolPort, "postMessage"> & {
  postMessage(message: unknown): void;
};

export interface HostConnectionIdentity {
  appInstanceId?: string;
  hostInstanceId: string;
  hostEpoch: number;
}

export interface HostWelcomeRuntime {
  sdkVersion: string;
  eventSequence: number;
}

export interface HostConnectionDiagnostics {
  connectionSequence: number;
  record: (incident: HostDiagnosticIncidentInput) => void;
}

export class HostConnectionContext {
  private handshaken = false;
  private handshakePending = false;
  private retired = false;
  private closed = false;
  private pendingResponses = 0;
  private negotiatedMaxEnvelopeBytes = DEFAULT_MAX_ENVELOPE_BYTES;
  private readonly pendingRequests = new Map<string, ResponseAuthority>();
  private readonly requestAbortControllers = new Map<string, AbortController>();
  private readonly seenRequestIds = new Set<string>();
  private readonly messageListener: PortListener = (event) => this.handleMessage(extractData(event));
  private readonly messageErrorListener: PortListener = () => this.retire("message-error");
  private readonly closeListener: PortListener = () => this.close(false, "peer-closed");
  private disconnectNotified = false;
  private diagnosticCloseRecorded = false;

  constructor(
    private readonly port: HostResponsePort,
    readonly identity: HostConnectionIdentity,
    private readonly getWelcomeRuntime: () => Promise<HostWelcomeRuntime>,
    private readonly onRequest: (connection: HostConnectionContext, request: RequestEnvelope) => void,
    private readonly onDisconnect: () => void = () => undefined,
    private readonly maxSeenRequestIds = 2_048,
    private readonly maxPendingRequests = 256,
    private readonly diagnostics?: HostConnectionDiagnostics
  ) {
    this.addListener("message", this.messageListener);
    this.addListener("messageerror", this.messageErrorListener);
    this.addListener("close", this.closeListener);
    port.start?.();
  }

  get isCurrentCandidate(): boolean {
    return !this.retired && !this.closed;
  }

  beginResponse(request: ResponseAuthority): void {
    this.pendingRequests.set(request.requestId, request);
    this.requestAbortControllers.set(request.requestId, new AbortController());
    this.pendingResponses += 1;
  }

  signalForRequest(requestId: string): AbortSignal {
    const signal = this.requestAbortControllers.get(requestId)?.signal;
    if (signal) return signal;
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  }

  sendSuccess<T extends AgentCommandType>(requestId: string, type: T, result: CommandResults[T]): void {
    const authority = this.pendingAuthority(requestId, type);
    if (!authority) return;
    const response = { ok: true, type, result } as CommandResponse<T>;
    const envelope = responseEnvelope(requestId, this.identity.hostEpoch, authority.context, response);
    if (!isResponseEnvelope(envelope)) {
      this.sendSafeError(authority, INVALID_HOST_RESPONSE_ERROR, true);
      return;
    }
    if (!isEnvelopeWithinByteLimit(envelope, this.negotiatedMaxEnvelopeBytes)) {
      this.sendSafeError(authority, OVERSIZED_HOST_RESPONSE_ERROR, true);
      return;
    }
    this.sendResponse(envelope, requestId);
  }

  sendError<T extends AgentCommandType>(requestId: string, type: T, error: ProtocolError): void {
    const authority = this.pendingAuthority(requestId, type);
    if (!authority) return;
    const response = { ok: false, type, error } as CommandResponse<T>;
    const envelope = responseEnvelope(requestId, this.identity.hostEpoch, authority.context, response);
    if (!isResponseEnvelope(envelope)) {
      this.sendSafeError(authority, INVALID_HOST_RESPONSE_ERROR, true);
      return;
    }
    if (!isEnvelopeWithinByteLimit(envelope, this.negotiatedMaxEnvelopeBytes)) {
      this.sendSafeError(authority, OVERSIZED_HOST_RESPONSE_ERROR, true);
      return;
    }
    this.sendResponse(envelope, requestId);
  }

  postEvent(envelope: unknown): boolean {
    if (!this.handshaken || this.retired || this.closed) return false;
    if (!isEventEnvelope(envelope)) return false;
    if (!isEnvelopeWithinByteLimit(envelope, this.negotiatedMaxEnvelopeBytes)) {
      this.recordIncident(hostIncident("event-post", "failed", { reason: "event-envelope-too-large" }));
      this.retire("event-envelope-too-large");
      return false;
    }
    try {
      this.port.postMessage(envelope);
      return true;
    } catch (error) {
      this.recordIncident(hostIncident("event-post", "failed", {
        reason: "event-post-failed",
        errorClass: classifyDiagnosticError(error)
      }));
      this.retire("event-post-failed");
      return false;
    }
  }

  retire(reason = "connection-replaced"): void {
    if (this.retired) return;
    debugConnection(reason);
    this.recordClose(reason);
    this.retired = true;
    this.abortPendingRequests();
    this.notifyDisconnect();
    this.removeListener("message", this.messageListener);
    this.removeListener("messageerror", this.messageErrorListener);
    if (this.pendingResponses === 0) this.close();
  }

  close(closePort = true, reason = "connection-closed"): void {
    if (this.closed) return;
    debugConnection(reason);
    this.recordClose(reason);
    this.closed = true;
    this.abortPendingRequests();
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
        this.sendUntrackedError(invalid, {
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
        if (isHandshakeCandidate(data)) {
          try {
            this.port.postMessage(handshakeRejectedEnvelope());
          } catch {
            // The connection is closed below either way.
          }
        }
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
    if (isRequestCancellationEnvelope(data)) {
      if (data.hostEpoch === this.identity.hostEpoch) {
        this.requestAbortControllers.get(data.requestId)?.abort();
      }
      return;
    }
    if (!isRequestEnvelope(data)) {
      const invalid = correlateInvalidRequest(data);
      if (invalid) {
        this.sendUntrackedError(invalid, invalid.hostEpoch === this.identity.hostEpoch
          ? { code: "INVALID_PAYLOAD", message: "The request payload is invalid.", recoverable: false }
          : {
              code: "STALE_HOST_EPOCH",
              message: "The request targets a stale Pi runtime service generation.",
              recoverable: true,
              details: { expectedHostEpoch: this.identity.hostEpoch, receivedHostEpoch: invalid.hostEpoch }
            });
      }
      return;
    }
    if (data.hostEpoch !== this.identity.hostEpoch) {
      this.sendUntrackedError(data, {
        code: "STALE_HOST_EPOCH",
        message: "The request targets a stale Pi runtime service generation.",
        recoverable: true,
        details: { expectedHostEpoch: this.identity.hostEpoch, receivedHostEpoch: data.hostEpoch }
      });
      return;
    }
    if (this.seenRequestIds.has(data.requestId)) {
      this.sendUntrackedError(data, {
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
    if (this.pendingRequests.size >= this.maxPendingRequests) {
      this.sendUntrackedError(data, PENDING_REQUEST_LIMIT_ERROR);
      return;
    }
    this.beginResponse(data);
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
    } catch (error) {
      this.recordIncident(hostIncident("handshake", "failed", {
        reason: "handshake-failed",
        errorClass: classifyDiagnosticError(error)
      }));
      this.close(true, "handshake-failed");
    } finally {
      this.handshakePending = false;
    }
  }

  private sendUntrackedError(authority: ResponseAuthority, error: ProtocolError): void {
    this.sendSafeError(authority, error, false);
  }

  private sendSafeError(
    authority: ResponseAuthority,
    error: ProtocolError,
    tracked: boolean
  ): void {
    const envelope = responseEnvelope(authority.requestId, this.identity.hostEpoch, authority.context, {
      ok: false,
      type: authority.type,
      error
    });
    if (
      !isResponseEnvelope(envelope)
      || !isEnvelopeWithinByteLimit(envelope, this.negotiatedMaxEnvelopeBytes)
    ) {
      debugConnection("response-fallback-invalid", { type: authority.type, error: "invalid-envelope" });
      if (tracked) this.completeResponse(authority.requestId);
      return;
    }
    this.sendResponse(envelope, tracked ? authority.requestId : undefined);
  }

  private sendResponse(
    envelope: unknown,
    trackedRequestId?: string
  ): void {
    if (this.closed) {
      if (trackedRequestId !== undefined) this.completeResponse(trackedRequestId);
      return;
    }
    try {
      this.port.postMessage(envelope);
    } catch (error) {
      this.recordIncident(hostIncident("response-post", "failed", {
        command: diagnosticEnvelopeType(envelope),
        errorClass: classifyDiagnosticError(error),
        reason: "response-post-failed",
        ...diagnosticBinaryByteEvidence(envelope)
      }));
      debugConnection("response-post-failed", {
        type: diagnosticEnvelopeType(envelope),
        error: error instanceof Error ? error.name : "unknown"
      });
      this.retire("response-post-failed");
    } finally {
      if (trackedRequestId !== undefined) this.completeResponse(trackedRequestId);
    }
  }

  private pendingAuthority<T extends AgentCommandType>(
    requestId: string,
    type: T
  ): ResponseAuthority | undefined {
    const authority = this.pendingRequests.get(requestId);
    if (!authority) return undefined;
    if (authority.type !== type) {
      this.sendSafeError(authority, INVALID_HOST_RESPONSE_ERROR, true);
      return undefined;
    }
    return authority;
  }

  private completeResponse(requestId: string): void {
    this.pendingRequests.delete(requestId);
    this.requestAbortControllers.delete(requestId);
    this.pendingResponses = Math.max(0, this.pendingResponses - 1);
    if (this.retired && this.pendingResponses === 0) this.close();
  }

  private abortPendingRequests(): void {
    for (const controller of this.requestAbortControllers.values()) controller.abort();
  }

  private recordClose(reason: string): void {
    if (this.diagnosticCloseRecorded) return;
    this.diagnosticCloseRecorded = true;
    this.recordIncident(hostIncident("port-close", "closed", {
      reason: hostDiagnosticReason(reason)
    }));
  }

  private recordIncident(incident: HostDiagnosticIncidentInput): void {
    if (!this.diagnostics) return;
    this.diagnostics.record({
      ...incident,
      connectionSequence: this.diagnostics.connectionSequence,
      hostEpoch: this.identity.hostEpoch
    });
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
