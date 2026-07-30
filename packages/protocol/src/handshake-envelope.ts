import { Type, Value, type TProperties } from "./typebox-schema.js";
import { PROTOCOL_REVISION } from "./protocol-revision.js";
import { DEFAULT_MAX_ENVELOPE_BYTES, PROTOCOL_VERSION } from "./protocol-version.js";

export interface RendererHello {
  protocolVersion: typeof PROTOCOL_VERSION;
  protocolRevision: typeof PROTOCOL_REVISION;
  kind: "hello";
  rendererInstanceId: string;
  appInstanceId: string;
  maxEnvelopeBytes: number;
}

export interface HostCapabilities {
  operations: true;
  eventSequence: true;
  structuredErrors: true;
  transferableImages: true;
  transferableAssets: true;
  idempotentControlMutations: true;
}

export interface HostWelcome {
  protocolVersion: typeof PROTOCOL_VERSION;
  protocolRevision: typeof PROTOCOL_REVISION;
  kind: "welcome";
  appInstanceId: string;
  hostInstanceId: string;
  hostEpoch: number;
  sdkVersion: string;
  eventSequence: number;
  capabilities: HostCapabilities;
  maxEnvelopeBytes: number;
}

export interface HandshakeRejected {
  protocolVersion: number;
  protocolRevision: string;
  kind: "handshake-rejected";
  error: import("./agent-messages.js").ProtocolError & { code: "PROTOCOL_MISMATCH" };
}

const ProtocolRevisionSchema = Type.String({ minLength: 64, maxLength: 64, pattern: "^[0-9a-f]{64}$" });

export const RendererHelloSchema = strictObject({
  protocolVersion: Type.Literal(PROTOCOL_VERSION),
  protocolRevision: ProtocolRevisionSchema,
  kind: Type.Literal("hello"),
  rendererInstanceId: Type.String({ minLength: 1, maxLength: 512 }),
  appInstanceId: Type.String({ minLength: 1, maxLength: 512 }),
  maxEnvelopeBytes: Type.Integer({ minimum: 65_536, maximum: 64 * 1024 * 1024 })
});

export const HostWelcomeSchema = strictObject({
  protocolVersion: Type.Literal(PROTOCOL_VERSION),
  protocolRevision: ProtocolRevisionSchema,
  kind: Type.Literal("welcome"),
  appInstanceId: Type.String({ minLength: 1, maxLength: 512 }),
  hostInstanceId: Type.String({ minLength: 1, maxLength: 512 }),
  hostEpoch: Type.Integer({ minimum: 0 }),
  sdkVersion: Type.String({ minLength: 1, maxLength: 128 }),
  eventSequence: Type.Integer({ minimum: 0 }),
  capabilities: strictObject({
    operations: Type.Literal(true),
    eventSequence: Type.Literal(true),
    structuredErrors: Type.Literal(true),
    transferableImages: Type.Literal(true),
    transferableAssets: Type.Literal(true),
    idempotentControlMutations: Type.Literal(true)
  }),
  maxEnvelopeBytes: Type.Integer({ minimum: 65_536, maximum: 64 * 1024 * 1024 })
});

export const HandshakeRejectedSchema = strictObject({
  protocolVersion: Type.Integer({ minimum: 1 }),
  protocolRevision: ProtocolRevisionSchema,
  kind: Type.Literal("handshake-rejected"),
  error: strictObject({
    code: Type.Literal("PROTOCOL_MISMATCH"),
    message: Type.String({ maxLength: 4_096 }),
    recoverable: Type.Boolean()
  })
});

export function isRendererHello(value: unknown): value is RendererHello {
  return Value.Check(RendererHelloSchema, value)
    && (value as RendererHello).protocolRevision === PROTOCOL_REVISION;
}

export function isHostWelcome(value: unknown): value is HostWelcome {
  return Value.Check(HostWelcomeSchema, value)
    && (value as HostWelcome).protocolRevision === PROTOCOL_REVISION;
}

export function isHandshakeRejected(value: unknown): value is HandshakeRejected {
  return Value.Check(HandshakeRejectedSchema, value);
}

export function isHandshakeCandidate(value: unknown): value is {
  protocolVersion: number;
  protocolRevision?: string;
  kind: "hello";
  rendererInstanceId: string;
  appInstanceId: string;
  maxEnvelopeBytes: number;
} {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.kind === "hello"
    && Number.isSafeInteger(candidate.protocolVersion)
    && (candidate.protocolRevision === undefined || typeof candidate.protocolRevision === "string")
    && typeof candidate.rendererInstanceId === "string"
    && typeof candidate.appInstanceId === "string"
    && Number.isSafeInteger(candidate.maxEnvelopeBytes);
}

export function helloEnvelope(
  rendererInstanceId: string,
  appInstanceId: string,
  maxEnvelopeBytes = DEFAULT_MAX_ENVELOPE_BYTES
): RendererHello {
  return {
    protocolVersion: PROTOCOL_VERSION,
    protocolRevision: PROTOCOL_REVISION,
    kind: "hello",
    rendererInstanceId,
    appInstanceId,
    maxEnvelopeBytes
  };
}

export function welcomeEnvelope(
  options: Omit<HostWelcome, "protocolVersion" | "protocolRevision" | "kind">
): HostWelcome {
  return {
    protocolVersion: PROTOCOL_VERSION,
    protocolRevision: PROTOCOL_REVISION,
    kind: "welcome",
    ...options
  };
}

export function handshakeRejectedEnvelope(): HandshakeRejected {
  return {
    protocolVersion: PROTOCOL_VERSION,
    protocolRevision: PROTOCOL_REVISION,
    kind: "handshake-rejected",
    error: {
      code: "PROTOCOL_MISMATCH",
      message: "Pi 运行服务版本不一致，请重启应用。",
      recoverable: true
    }
  };
}

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
