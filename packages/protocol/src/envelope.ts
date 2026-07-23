import { Type, type Static, type TProperties, type TSchema } from "typebox";
import { Value } from "typebox/value";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_TRANSFER_IMAGE_BYTES,
  MAX_TRANSFER_IMAGE_COUNT,
  MAX_TRANSFER_IMAGE_TOTAL_BYTES
} from "./agent-messages.js";
import type {
  AgentCommand,
  AgentCommandType,
  AgentEvent,
  AgentEventType,
  CommandPayloads,
  CommandResponse,
  EventPayloads,
  TransferImage
} from "./agent-messages.js";

export const PROTOCOL_VERSION = 1 as const;

const AgentCommandTypes = [
  "runtime.initialize",
  "runtime.getStatus",
  "workspace.open",
  "workspace.setTrust",
  "session.list",
  "session.create",
  "session.open",
  "session.import",
  "session.branch",
  "session.rollback",
  "session.compact",
  "session.name",
  "prompt.send",
  "prompt.steer",
  "prompt.followUp",
  "turn.abort",
  "model.list",
  "model.select",
  "model.setRuntimeKey",
  "thinking.set",
  "resource.list",
  "resource.reload",
  "command.list",
  "command.invoke",
  "extension.ui.respond",
  "diagnostics.collect",
  "doctor.run"
] as const satisfies readonly AgentCommandType[];

const AgentEventTypes = [
  "runtime.statusChanged",
  "runtime.ready",
  "runtime.crashed",
  "session.snapshot",
  "session.delta",
  "session.listed",
  "session.externalChangeDetected",
  "turn.streamBatch",
  "turn.failed",
  "approval.requested",
  "approval.resolved",
  "extension.ui.requested",
  "extension.ui.updated",
  "extension.compatibilityChanged",
  "resource.changed",
  "diagnostics.progress",
  "doctor.completed"
] as const satisfies readonly AgentEventType[];

const CommandTypeSchema = Type.Union(AgentCommandTypes.map((value) => Type.Literal(value)));
const EventTypeSchema = Type.Union(AgentEventTypes.map((value) => Type.Literal(value)));

const EmptyPayloadSchema = strictObject({});
const TrustSchema = Type.Union([Type.Literal("unknown"), Type.Literal("trusted"), Type.Literal("untrusted")]);
const ApprovalModeSchema = Type.Union([Type.Literal("guided"), Type.Literal("balanced")]);
const PathSchema = Type.String({ minLength: 1, maxLength: 32_768 });
const PromptSchema = Type.String({ maxLength: 2_000_000 });
const TransferImageSchema = strictObject({
  name: Type.String({ minLength: 1, maxLength: 512 }),
  mimeType: Type.String({ minLength: 1, maxLength: 128 }),
  data: Type.Unknown()
});
const PromptPayloadSchema = strictObject({
  text: PromptSchema,
  images: Type.Optional(Type.Array(TransferImageSchema, { maxItems: MAX_TRANSFER_IMAGE_COUNT }))
});
const CommandPayloadSchemas: Record<AgentCommandType, TSchema> = {
  "runtime.initialize": strictObject({
    cwd: PathSchema,
    agentDir: Type.Optional(PathSchema),
    sessionPath: Type.Optional(PathSchema),
    trust: TrustSchema,
    approvalMode: ApprovalModeSchema
  }),
  "runtime.getStatus": EmptyPayloadSchema,
  "workspace.open": strictObject({ cwd: PathSchema, trust: TrustSchema, approvalMode: ApprovalModeSchema }),
  "workspace.setTrust": strictObject({ trust: TrustSchema, approvalMode: ApprovalModeSchema }),
  "session.list": strictObject({ all: Type.Optional(Type.Boolean()) }),
  "session.create": strictObject({ cwd: PathSchema }),
  "session.open": strictObject({ path: PathSchema, cwdOverride: Type.Optional(PathSchema) }),
  "session.import": strictObject({ path: PathSchema }),
  "session.branch": strictObject({ entryId: Type.String({ minLength: 1 }), newFile: Type.Optional(Type.Boolean()) }),
  "session.rollback": strictObject({ entryId: Type.String({ minLength: 1 }), summarize: Type.Optional(Type.Boolean()) }),
  "session.compact": strictObject({ instructions: Type.Optional(PromptSchema) }),
  "session.name": strictObject({ name: Type.String({ minLength: 1, maxLength: 256 }) }),
  "prompt.send": PromptPayloadSchema,
  "prompt.steer": PromptPayloadSchema,
  "prompt.followUp": PromptPayloadSchema,
  "turn.abort": EmptyPayloadSchema,
  "model.list": EmptyPayloadSchema,
  "model.select": strictObject({ provider: Type.String({ minLength: 1, maxLength: 256 }), id: Type.String({ minLength: 1, maxLength: 512 }) }),
  "model.setRuntimeKey": strictObject({ provider: Type.String({ minLength: 1, maxLength: 256 }), apiKey: Type.String({ minLength: 8, maxLength: 16_384 }) }),
  "thinking.set": strictObject({ level: Type.String({ minLength: 1, maxLength: 32 }) }),
  "resource.list": EmptyPayloadSchema,
  "resource.reload": EmptyPayloadSchema,
  "command.list": EmptyPayloadSchema,
  "command.invoke": strictObject({ command: Type.String({ minLength: 1, maxLength: 16_384 }) }),
  "extension.ui.respond": strictObject({
    requestId: Type.String({ minLength: 1, maxLength: 512 }),
    value: Type.Optional(Type.Union([Type.String({ maxLength: 2_000_000 }), Type.Boolean()])),
    cancelled: Type.Optional(Type.Boolean())
  }),
  "diagnostics.collect": EmptyPayloadSchema,
  "doctor.run": EmptyPayloadSchema
};

export const CommandEnvelopeSchema = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    kind: Type.Literal("command"),
    messageId: Type.String({ minLength: 1 }),
    requestId: Type.String({ minLength: 1 }),
    sessionId: Type.Optional(Type.String()),
    timestamp: Type.Number(),
    command: Type.Object({
      type: CommandTypeSchema,
      payload: Type.Unknown()
    })
  },
  { additionalProperties: false }
);

export const EventEnvelopeSchema = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    kind: Type.Literal("event"),
    messageId: Type.String({ minLength: 1 }),
    sessionId: Type.Optional(Type.String()),
    sequence: Type.Optional(Type.Integer({ minimum: 0 })),
    timestamp: Type.Number(),
    event: Type.Object({
      type: EventTypeSchema,
      payload: Type.Unknown()
    })
  },
  { additionalProperties: false }
);

export const ResponseEnvelopeSchema = Type.Object(
  {
    protocolVersion: Type.Literal(PROTOCOL_VERSION),
    kind: Type.Literal("response"),
    messageId: Type.String({ minLength: 1 }),
    requestId: Type.String({ minLength: 1 }),
    timestamp: Type.Number(),
    response: Type.Object({
      ok: Type.Boolean(),
      data: Type.Optional(Type.Unknown()),
      error: Type.Optional(
        Type.Object({
          code: Type.String(),
          message: Type.String(),
          recoverable: Type.Boolean()
        })
      )
    })
  },
  { additionalProperties: false }
);

export type CommandEnvelopeShape = Static<typeof CommandEnvelopeSchema>;
export type EventEnvelopeShape = Static<typeof EventEnvelopeSchema>;
export type ResponseEnvelopeShape = Static<typeof ResponseEnvelopeSchema>;

export interface CommandEnvelope extends Omit<CommandEnvelopeShape, "command"> {
  command: AgentCommand;
}

export interface EventEnvelope extends Omit<EventEnvelopeShape, "event"> {
  event: AgentEvent;
}

export interface ResponseEnvelope extends Omit<ResponseEnvelopeShape, "response"> {
  response: CommandResponse;
}

export type ProtocolEnvelope = CommandEnvelope | EventEnvelope | ResponseEnvelope;

export function isCommandEnvelope(value: unknown): value is CommandEnvelope {
  if (!Value.Check(CommandEnvelopeSchema, value)) return false;
  const envelope = value as CommandEnvelopeShape;
  const schema = CommandPayloadSchemas[envelope.command.type as AgentCommandType];
  if (!schema || !Value.Check(schema, envelope.command.payload)) return false;
  if (isPromptCommand(envelope.command.type)) {
    const images = (envelope.command.payload as { images?: unknown }).images;
    return images === undefined || isTransferImageArray(images);
  }
  return true;
}

export function isEventEnvelope(value: unknown): value is EventEnvelope {
  return Value.Check(EventEnvelopeSchema, value);
}

export function isResponseEnvelope(value: unknown): value is ResponseEnvelope {
  return Value.Check(ResponseEnvelopeSchema, value);
}

let localCounter = 0;

export function createMessageId(prefix: string): string {
  localCounter = (localCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}-${Date.now().toString(36)}-${localCounter.toString(36)}`;
}

export function commandEnvelope<T extends AgentCommandType>(
  type: T,
  payload: CommandPayloads[T]
): CommandEnvelope {
  const requestId = createMessageId("request");
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "command",
    messageId: createMessageId("command"),
    requestId,
    timestamp: Date.now(),
    command: { type, payload } as AgentCommand
  };
}

export function eventEnvelope<T extends AgentEventType>(
  type: T,
  payload: EventPayloads[T],
  sequence?: number,
  sessionId?: string
): EventEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "event",
    messageId: createMessageId("event"),
    timestamp: Date.now(),
    ...(sequence === undefined ? {} : { sequence }),
    ...(sessionId === undefined ? {} : { sessionId }),
    event: { type, payload } as AgentEvent
  };
}

export function agentEventEnvelope(
  event: AgentEvent,
  sequence?: number,
  sessionId?: string
): EventEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "event",
    messageId: createMessageId("event"),
    timestamp: Date.now(),
    ...(sequence === undefined ? {} : { sequence }),
    ...(sessionId === undefined ? {} : { sessionId }),
    event
  };
}

export function responseEnvelope(requestId: string, response: CommandResponse): ResponseEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: "response",
    messageId: createMessageId("response"),
    requestId,
    timestamp: Date.now(),
    response
  };
}

function strictObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}

function isPromptCommand(type: string): boolean {
  return type === "prompt.send" || type === "prompt.steer" || type === "prompt.followUp";
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
