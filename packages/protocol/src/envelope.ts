import { Type, Value, type Static } from "./typebox-schema.js";
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
import { isEnvelopeWithinByteLimit } from "./envelope-size.js";
import {
  AppProtocolContextSchema,
  ProtocolContextSchema,
  TaskProtocolContextWithSessionSchema,
  TaskProtocolContextWithoutSessionSchema,
  WorkspaceProtocolContextSchema,
  hasValidCommandContext,
  isProtocolContext,
  type AppProtocolContext,
  type ProtocolContext,
  type TaskProtocolContext,
  type WorkspaceProtocolContext
} from "./protocol-context.js";
import {
  type HandshakeRejected,
  type HostWelcome,
  type RendererHello
} from "./handshake-envelope.js";
import { PROTOCOL_VERSION } from "./protocol-version.js";

export { PROTOCOL_REVISION } from "./protocol-revision.js";
export { DEFAULT_MAX_ENVELOPE_BYTES, PROTOCOL_VERSION } from "./protocol-version.js";
export * from "./handshake-envelope.js";

export { isEnvelopeWithinByteLimit } from "./envelope-size.js";
export {
  APP_PROTOCOL_CONTEXT,
  COMMAND_CONTEXT_SCOPE_REQUIREMENTS,
  ProtocolContextSchema,
  hasValidCommandContext,
  isProtocolContext,
  protocolContextsEqual,
  type AppProtocolContext,
  type ProtocolContext,
  type TaskProtocolContext,
  type WorkspaceProtocolContext
} from "./protocol-context.js";

export interface RequestEnvelope<T extends AgentCommandType = AgentCommandType> {
  protocolVersion: typeof PROTOCOL_VERSION;
  kind: "request";
  requestId: string;
  hostEpoch: number;
  context: ProtocolContext;
  idempotencyKey?: string;
  type: T;
  payload: CommandPayloads[T];
}

export interface SuccessResponseEnvelope<T extends AgentCommandType = AgentCommandType> {
  protocolVersion: typeof PROTOCOL_VERSION;
  kind: "response";
  requestId: string;
  hostEpoch: number;
  context: ProtocolContext;
  type: T;
  ok: true;
  result: import("./agent-messages.js").CommandResults[T];
}

export interface ErrorResponseEnvelope<T extends AgentCommandType = AgentCommandType> {
  protocolVersion: typeof PROTOCOL_VERSION;
  kind: "response";
  requestId: string;
  hostEpoch: number;
  context: ProtocolContext;
  type: T;
  ok: false;
  error: import("./agent-messages.js").ProtocolError;
}

export type ResponseEnvelope<T extends AgentCommandType = AgentCommandType> =
  | SuccessResponseEnvelope<T>
  | ErrorResponseEnvelope<T>;

interface EventEnvelopeBase<T extends AgentEventType = AgentEventType> {
  protocolVersion: typeof PROTOCOL_VERSION;
  kind: "event";
  hostEpoch: number;
  sequence: number;
  type: T;
  payload: EventPayloads[T];
}

export type EventEnvelope<T extends AgentEventType = AgentEventType> =
  | (EventEnvelopeBase<T> & {
      context: AppProtocolContext | WorkspaceProtocolContext;
      taskSequence?: never;
    })
  | (EventEnvelopeBase<T> & {
      context: TaskProtocolContext;
      taskSequence: number;
    });

// Kept as an exported name while call sites migrate from v1 terminology.
export type CommandEnvelope = RequestEnvelope;
export type ProtocolEnvelope = RendererHello | HostWelcome | HandshakeRejected | RequestEnvelope | ResponseEnvelope | EventEnvelope;

export const RequestEnvelopeSchema = strictObject({
  protocolVersion: Type.Literal(PROTOCOL_VERSION),
  kind: Type.Literal("request"),
  requestId: Type.String({ minLength: 1, maxLength: 512 }),
  hostEpoch: Type.Integer({ minimum: 0 }),
  context: ProtocolContextSchema,
  idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  type: Type.String({ minLength: 1, maxLength: 128 }),
  payload: Type.Any()
});

const SuccessResponseEnvelopeSchema = strictObject({
  protocolVersion: Type.Literal(PROTOCOL_VERSION),
  kind: Type.Literal("response"),
  requestId: Type.String({ minLength: 1, maxLength: 512 }),
  hostEpoch: Type.Integer({ minimum: 0 }),
  context: ProtocolContextSchema,
  type: Type.String({ minLength: 1, maxLength: 128 }),
  ok: Type.Literal(true),
  result: Type.Any()
});

const ErrorResponseEnvelopeSchema = strictObject({
  protocolVersion: Type.Literal(PROTOCOL_VERSION),
  kind: Type.Literal("response"),
  requestId: Type.String({ minLength: 1, maxLength: 512 }),
  hostEpoch: Type.Integer({ minimum: 0 }),
  context: ProtocolContextSchema,
  type: Type.String({ minLength: 1, maxLength: 128 }),
  ok: Type.Literal(false),
  error: ProtocolErrorSchema
});

export const ResponseEnvelopeSchema = Type.Union([SuccessResponseEnvelopeSchema, ErrorResponseEnvelopeSchema]);

const EventEnvelopeFields = {
  protocolVersion: Type.Literal(PROTOCOL_VERSION),
  kind: Type.Literal("event"),
  hostEpoch: Type.Integer({ minimum: 0 }),
  sequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  type: Type.String({ minLength: 1, maxLength: 128 }),
  payload: Type.Any()
};
export const EventEnvelopeSchema = Type.Union([
  strictObject({ ...EventEnvelopeFields, context: AppProtocolContextSchema }),
  strictObject({ ...EventEnvelopeFields, context: WorkspaceProtocolContextSchema }),
  strictObject({
    ...EventEnvelopeFields,
    context: Type.Union([
      TaskProtocolContextWithoutSessionSchema,
      TaskProtocolContextWithSessionSchema
    ]),
    taskSequence: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  })
]);

export type RequestEnvelopeShape = Static<typeof RequestEnvelopeSchema>;
export type ResponseEnvelopeShape = Static<typeof ResponseEnvelopeSchema>;
export type EventEnvelopeShape = Static<typeof EventEnvelopeSchema>;

export function isRequestEnvelope(value: unknown): value is RequestEnvelope {
  if (!Value.Check(RequestEnvelopeSchema, value)) return false;
  const envelope = value as RequestEnvelopeShape;
  const type = envelope.type as AgentCommandType;
  const schema = CommandPayloadSchemas[type];
  if (!schema || !Value.Check(schema, envelope.payload)) return false;
  if (isReplaySafeControlMutation(type) !== (typeof envelope.idempotencyKey === "string")) return false;
  if (!hasValidCommandContext(type, envelope.context as ProtocolContext)) return false;
  return !isPromptCommand(type) || hasValidTransferImages(envelope.payload);
}

export function correlateInvalidRequest(value: unknown): {
  requestId: string;
  hostEpoch: number;
  type: AgentCommandType;
  context: ProtocolContext;
} | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.protocolVersion !== PROTOCOL_VERSION
    || candidate.kind !== "request"
    || typeof candidate.requestId !== "string"
    || !Number.isSafeInteger(candidate.hostEpoch)
    || !isProtocolContext(candidate.context)
    || typeof candidate.type !== "string"
    || !(candidate.type in CommandPayloadSchemas)
  ) return undefined;
  return {
    requestId: candidate.requestId,
    hostEpoch: Number(candidate.hostEpoch),
    type: candidate.type as AgentCommandType,
    context: candidate.context
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
  if (!hasValidCommandContext(type, envelope.context as ProtocolContext)) return false;
  if (!envelope.ok) return true;
  if (!Value.Check(CommandResultSchemas[type], envelope.result)) return false;
  if (type === "asset.read" && !isValidAssetReadResult(envelope.result)) return false;
  return type !== "session.catalog.query" || (
    hasBoundSessionCatalogCursor(envelope.result)
    && isEnvelopeWithinByteLimit(envelope.result, MAX_SESSION_CATALOG_PAGE_JSON_BYTES)
  );
}

export function correlateInvalidResponse(value: unknown): {
  requestId: string;
  hostEpoch: number;
} | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.protocolVersion !== PROTOCOL_VERSION
    || candidate.kind !== "response"
    || typeof candidate.requestId !== "string"
    || !Number.isSafeInteger(candidate.hostEpoch)
  ) return undefined;
  return {
    requestId: candidate.requestId,
    hostEpoch: Number(candidate.hostEpoch)
  };
}

let localCounter = 0;

export function createMessageId(prefix: string): string {
  localCounter = (localCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}-${Date.now().toString(36)}-${localCounter.toString(36)}`;
}

export function commandEnvelope<T extends AgentCommandType>(
  type: T,
  payload: CommandPayloads[T],
  context: ProtocolContext,
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
    context,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    type,
    payload
  };
}

interface BaseEventEnvelopeContext {
  hostEpoch: number;
  sequence: number;
}

export type EventEnvelopeContext =
  | (BaseEventEnvelopeContext & {
      context: AppProtocolContext | WorkspaceProtocolContext;
      taskSequence?: never;
    })
  | (BaseEventEnvelopeContext & {
      context: TaskProtocolContext;
      taskSequence: number;
    });

export function eventEnvelope<T extends AgentEventType>(
  type: T,
  payload: EventPayloads[T],
  context: EventEnvelopeContext
): EventEnvelope<T> {
  const envelope = {
    protocolVersion: PROTOCOL_VERSION,
    kind: "event",
    hostEpoch: context.hostEpoch,
    sequence: context.sequence,
    context: context.context,
    type,
    payload,
    ...(context.context.scope === "task" ? { taskSequence: context.taskSequence } : {})
  };
  return envelope as EventEnvelope<T>;
}

export function agentEventEnvelope(event: AgentEvent, context: EventEnvelopeContext): EventEnvelope {
  return eventEnvelope(event.type, event.payload, context) as EventEnvelope;
}

export function responseEnvelope<T extends AgentCommandType>(
  requestId: string,
  hostEpoch: number,
  context: ProtocolContext,
  response: CommandResponse<T>
): ResponseEnvelope<T> {
  if (response.ok) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      kind: "response",
      requestId,
      hostEpoch,
      context,
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
    context,
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
