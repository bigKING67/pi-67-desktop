import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import {
  MAX_SESSION_CATALOG_PAGE_JSON_BYTES
} from "@pi67/domain";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  isReplaySafeControlMutation,
  MAX_TRANSFER_IMAGE_BYTES,
  MAX_TRANSFER_IMAGE_COUNT,
  MAX_TRANSFER_IMAGE_TOTAL_BYTES,
  type AgentCommandType,
  type AgentEvent,
  type AgentEventType,
  type CommandPayloads,
  type CommandResponse,
  type EventPayloads,
  type TransferImage
} from "./agent-messages.js";
import { isValidAssetReadResult } from "./asset-schemas.js";
import {
  CommandPayloadSchemas,
  CommandResultSchemas,
  EventPayloadSchemas,
  ProtocolErrorSchema,
  strictObject
} from "./schemas.js";
import { hasBoundSessionCatalogCursor } from "./session-catalog-schemas.js";
import { hasValidEventContext } from "./event-context.js";

export const PROTOCOL_VERSION = 2 as const;
export const DEFAULT_MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;

export function isEnvelopeWithinByteLimit(value: unknown, maxBytes: number): boolean {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return false;
  const seen = new WeakSet<object>();
  let bytes = 0;
  const add = (amount: number): boolean => {
    bytes += amount;
    return bytes <= maxBytes;
  };

  const visit = (candidate: unknown): boolean => {
    if (candidate === null) return add(4);
    if (typeof candidate === "string") return add(jsonStringByteLength(candidate));
    if (typeof candidate === "number") return add(Number.isFinite(candidate) ? String(candidate).length : 4);
    if (typeof candidate === "boolean") return add(candidate ? 4 : 5);
    if (candidate instanceof ArrayBuffer) return add(2);
    if (typeof candidate !== "object" || seen.has(candidate)) return false;
    seen.add(candidate);

    if (Array.isArray(candidate)) {
      if (!add(2 + Math.max(0, candidate.length - 1))) return false;
      for (const item of candidate) if (!visit(item)) return false;
      return true;
    }

    let entries: Array<[string, unknown]>;
    try {
      entries = Object.entries(candidate);
    } catch {
      return false;
    }
    if (!add(2 + Math.max(0, entries.length - 1))) return false;
    for (const [key, child] of entries) {
      if (!add(jsonStringByteLength(key) + 1) || !visit(child)) return false;
    }
    return true;
  };

  return visit(value);
}

function jsonStringByteLength(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
      bytes += 2;
    } else if (code < 0x20) {
      bytes += 6;
    } else if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export interface RendererHello {
  protocolVersion: typeof PROTOCOL_VERSION;
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
  kind: "welcome";
  appInstanceId: string;
  hostInstanceId: string;
  hostEpoch: number;
  sdkVersion: string;
  eventSequence: number;
  capabilities: HostCapabilities;
  maxEnvelopeBytes: number;
}

export interface RequestEnvelope<T extends AgentCommandType = AgentCommandType> {
  protocolVersion: typeof PROTOCOL_VERSION;
  kind: "request";
  requestId: string;
  hostEpoch: number;
  idempotencyKey?: string;
  type: T;
  payload: CommandPayloads[T];
}

export interface SuccessResponseEnvelope<T extends AgentCommandType = AgentCommandType> {
  protocolVersion: typeof PROTOCOL_VERSION;
  kind: "response";
  requestId: string;
  hostEpoch: number;
  type: T;
  ok: true;
  result: import("./agent-messages.js").CommandResults[T];
}

export interface ErrorResponseEnvelope<T extends AgentCommandType = AgentCommandType> {
  protocolVersion: typeof PROTOCOL_VERSION;
  kind: "response";
  requestId: string;
  hostEpoch: number;
  type: T;
  ok: false;
  error: import("./agent-messages.js").ProtocolError;
}

export type ResponseEnvelope<T extends AgentCommandType = AgentCommandType> =
  | SuccessResponseEnvelope<T>
  | ErrorResponseEnvelope<T>;

export interface EventEnvelope<T extends AgentEventType = AgentEventType> {
  protocolVersion: typeof PROTOCOL_VERSION;
  kind: "event";
  hostEpoch: number;
  sequence: number;
  type: T;
  payload: EventPayloads[T];
  sessionId?: string;
  sessionGeneration?: number;
  operationId?: string;
}

// Kept as an exported name while call sites migrate from v1 terminology.
export type CommandEnvelope = RequestEnvelope;
export type ProtocolEnvelope = RendererHello | HostWelcome | RequestEnvelope | ResponseEnvelope | EventEnvelope;

export const RendererHelloSchema = strictObject({
  protocolVersion: Type.Literal(PROTOCOL_VERSION),
  kind: Type.Literal("hello"),
  rendererInstanceId: Type.String({ minLength: 1, maxLength: 512 }),
  appInstanceId: Type.String({ minLength: 1, maxLength: 512 }),
  maxEnvelopeBytes: Type.Integer({ minimum: 65_536, maximum: 64 * 1024 * 1024 })
});

export const HostWelcomeSchema = strictObject({
  protocolVersion: Type.Literal(PROTOCOL_VERSION),
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

export const RequestEnvelopeSchema = strictObject({
  protocolVersion: Type.Literal(PROTOCOL_VERSION),
  kind: Type.Literal("request"),
  requestId: Type.String({ minLength: 1, maxLength: 512 }),
  hostEpoch: Type.Integer({ minimum: 0 }),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  type: Type.String({ minLength: 1, maxLength: 128 }),
  payload: Type.Any()
});

const SuccessResponseEnvelopeSchema = strictObject({
  protocolVersion: Type.Literal(PROTOCOL_VERSION),
  kind: Type.Literal("response"),
  requestId: Type.String({ minLength: 1, maxLength: 512 }),
  hostEpoch: Type.Integer({ minimum: 0 }),
  type: Type.String({ minLength: 1, maxLength: 128 }),
  ok: Type.Literal(true),
  result: Type.Any()
});

const ErrorResponseEnvelopeSchema = strictObject({
  protocolVersion: Type.Literal(PROTOCOL_VERSION),
  kind: Type.Literal("response"),
  requestId: Type.String({ minLength: 1, maxLength: 512 }),
  hostEpoch: Type.Integer({ minimum: 0 }),
  type: Type.String({ minLength: 1, maxLength: 128 }),
  ok: Type.Literal(false),
  error: ProtocolErrorSchema
});

export const ResponseEnvelopeSchema = Type.Union([SuccessResponseEnvelopeSchema, ErrorResponseEnvelopeSchema]);

export const EventEnvelopeSchema = strictObject({
  protocolVersion: Type.Literal(PROTOCOL_VERSION),
  kind: Type.Literal("event"),
  hostEpoch: Type.Integer({ minimum: 0 }),
  sequence: Type.Integer({ minimum: 1 }),
  type: Type.String({ minLength: 1, maxLength: 128 }),
  payload: Type.Any(),
  sessionId: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  sessionGeneration: Type.Optional(Type.Integer({ minimum: 0 })),
  operationId: Type.Optional(Type.String({ minLength: 1, maxLength: 512 }))
});

export type RequestEnvelopeShape = Static<typeof RequestEnvelopeSchema>;
export type ResponseEnvelopeShape = Static<typeof ResponseEnvelopeSchema>;
export type EventEnvelopeShape = Static<typeof EventEnvelopeSchema>;

export function isRendererHello(value: unknown): value is RendererHello {
  return Value.Check(RendererHelloSchema, value);
}

export function isHostWelcome(value: unknown): value is HostWelcome {
  return Value.Check(HostWelcomeSchema, value);
}

export function isRequestEnvelope(value: unknown): value is RequestEnvelope {
  if (!Value.Check(RequestEnvelopeSchema, value)) return false;
  const envelope = value as RequestEnvelopeShape;
  const type = envelope.type as AgentCommandType;
  const schema = CommandPayloadSchemas[type];
  if (!schema || !Value.Check(schema, envelope.payload)) return false;
  if (isReplaySafeControlMutation(type) !== (typeof envelope.idempotencyKey === "string")) return false;
  return !isPromptCommand(type) || hasValidTransferImages(envelope.payload);
}

export function correlateInvalidRequest(value: unknown): {
  requestId: string;
  hostEpoch: number;
  type: AgentCommandType;
} | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.protocolVersion !== PROTOCOL_VERSION
    || candidate.kind !== "request"
    || typeof candidate.requestId !== "string"
    || !Number.isSafeInteger(candidate.hostEpoch)
    || typeof candidate.type !== "string"
    || !(candidate.type in CommandPayloadSchemas)
  ) return undefined;
  return {
    requestId: candidate.requestId,
    hostEpoch: Number(candidate.hostEpoch),
    type: candidate.type as AgentCommandType
  };
}

export function isEventEnvelope(value: unknown): value is EventEnvelope {
  if (!Value.Check(EventEnvelopeSchema, value)) return false;
  const envelope = value as EventEnvelopeShape;
  const schema = EventPayloadSchemas[envelope.type as AgentEventType];
  return Boolean(
    schema
    && Value.Check(schema, envelope.payload)
    && hasValidEventContext(envelope as EventEnvelope)
  );
}

export function isResponseEnvelope(value: unknown): value is ResponseEnvelope {
  if (!Value.Check(ResponseEnvelopeSchema, value)) return false;
  const envelope = value as ResponseEnvelopeShape;
  const type = envelope.type as AgentCommandType;
  if (!CommandResultSchemas[type]) return false;
  if (!envelope.ok) return true;
  if (!Value.Check(CommandResultSchemas[type], envelope.result)) return false;
  if (type === "asset.read" && !isValidAssetReadResult(envelope.result)) return false;
  return type !== "session.catalog.query" || (
    hasBoundSessionCatalogCursor(envelope.result)
    && isEnvelopeWithinByteLimit(envelope.result, MAX_SESSION_CATALOG_PAGE_JSON_BYTES)
  );
}

export function correlateInvalidResponse(value: unknown): { requestId: string; hostEpoch: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.protocolVersion !== PROTOCOL_VERSION
    || candidate.kind !== "response"
    || typeof candidate.requestId !== "string"
    || !Number.isSafeInteger(candidate.hostEpoch)
  ) return undefined;
  return { requestId: candidate.requestId, hostEpoch: Number(candidate.hostEpoch) };
}

let localCounter = 0;

export function createMessageId(prefix: string): string {
  localCounter = (localCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}-${Date.now().toString(36)}-${localCounter.toString(36)}`;
}

export function helloEnvelope(
  rendererInstanceId: string,
  appInstanceId: string,
  maxEnvelopeBytes = DEFAULT_MAX_ENVELOPE_BYTES
): RendererHello {
  return { protocolVersion: PROTOCOL_VERSION, kind: "hello", rendererInstanceId, appInstanceId, maxEnvelopeBytes };
}

export function welcomeEnvelope(options: Omit<HostWelcome, "protocolVersion" | "kind">): HostWelcome {
  return { protocolVersion: PROTOCOL_VERSION, kind: "welcome", ...options };
}

export function commandEnvelope<T extends AgentCommandType>(
  type: T,
  payload: CommandPayloads[T],
  hostEpoch = 0,
  idempotencyKey = isReplaySafeControlMutation(type) ? createMessageId("mutation") : undefined
): RequestEnvelope<T> {
  if (!isReplaySafeControlMutation(type) && idempotencyKey !== undefined) {
    throw new TypeError(`Command ${type} does not accept an idempotency key.`);
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "request",
    requestId: createMessageId("request"),
    hostEpoch,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    type,
    payload
  };
}

export interface EventEnvelopeContext {
  hostEpoch: number;
  sequence: number;
  sessionId?: string;
  sessionGeneration?: number;
  operationId?: string;
}

export function eventEnvelope<T extends AgentEventType>(
  type: T,
  payload: EventPayloads[T],
  context: EventEnvelopeContext = { hostEpoch: 0, sequence: 1 }
): EventEnvelope<T> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "event",
    hostEpoch: context.hostEpoch,
    sequence: context.sequence,
    type,
    payload,
    ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
    ...(context.sessionGeneration === undefined ? {} : { sessionGeneration: context.sessionGeneration }),
    ...(context.operationId === undefined ? {} : { operationId: context.operationId })
  };
}

export function agentEventEnvelope(event: AgentEvent, context: EventEnvelopeContext): EventEnvelope {
  return eventEnvelope(event.type, event.payload, context) as EventEnvelope;
}

export function responseEnvelope<T extends AgentCommandType>(
  requestId: string,
  hostEpoch: number,
  response: CommandResponse<T>
): ResponseEnvelope<T> {
  if (response.ok) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      kind: "response",
      requestId,
      hostEpoch,
      type: response.type,
      ok: true,
      result: response.result
    };
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "response",
    requestId,
    hostEpoch,
    type: response.type,
    ok: false,
    error: response.error
  };
}

function isPromptCommand(type: AgentCommandType): boolean {
  return type === "prompt.submit" || type === "prompt.steer" || type === "prompt.followUp";
}

function hasValidTransferImages(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const images = (payload as { images?: unknown }).images;
  return images === undefined || isTransferImageArray(images);
}

function isTransferImageArray(value: unknown): value is TransferImage[] {
  if (!Array.isArray(value) || value.length > MAX_TRANSFER_IMAGE_COUNT) return false;
  let totalBytes = 0;
  for (const image of value) {
    if (typeof image !== "object" || image === null) return false;
    const candidate = image as Partial<TransferImage>;
    if (!ALLOWED_IMAGE_MIME_TYPES.some((mimeType) => mimeType === candidate.mimeType)) return false;
    if (!(candidate.data instanceof ArrayBuffer) || candidate.data.byteLength > MAX_TRANSFER_IMAGE_BYTES) return false;
    totalBytes += candidate.data.byteLength;
    if (totalBytes > MAX_TRANSFER_IMAGE_TOTAL_BYTES) return false;
  }
  return true;
}
