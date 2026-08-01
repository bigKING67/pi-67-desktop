import { Type, type TProperties } from "./typebox-schema.js";
import {
  MAX_PROJECTED_MESSAGE_PARTS,
  MAX_PROJECTED_TEXT_BYTES
} from "@pi67/domain";
import { AssetReferenceSchema } from "./asset-schemas.js";
import { ExtensionToolAdapterSchema } from "./extension-catalog-schemas.js";

const TextPartSchema = messageObject({
  type: Type.Union([Type.Literal("text"), Type.Literal("thinking")]),
  text: Type.String({ maxLength: MAX_PROJECTED_TEXT_BYTES })
});
const ToolCallPartSchema = messageObject({
  type: Type.Literal("tool-call"),
  id: Type.String(),
  name: Type.String(),
  status: Type.Union([
    Type.Literal("pending"),
    Type.Literal("running"),
    Type.Literal("completed"),
    Type.Literal("failed")
  ]),
  summary: Type.Optional(Type.String()),
  adapter: Type.Optional(ExtensionToolAdapterSchema)
});
const ImagePartSchema = messageObject({
  type: Type.Literal("image"),
  mimeType: Type.Union([
    Type.Literal("image/png"),
    Type.Literal("image/jpeg"),
    Type.Literal("image/webp"),
    Type.Literal("image/gif")
  ]),
  asset: Type.Optional(AssetReferenceSchema),
  name: Type.Optional(Type.String({ maxLength: 512 }))
});
const MessagePartSchema = Type.Union([TextPartSchema, ToolCallPartSchema, ImagePartSchema]);

export const SessionMessageSchema = messageObject({
  id: Type.String(),
  role: Type.Union([Type.Literal("user"), Type.Literal("assistant"), Type.Literal("tool"), Type.Literal("system")]),
  parts: Type.Array(MessagePartSchema, { maxItems: MAX_PROJECTED_MESSAGE_PARTS }),
  createdAt: Type.Optional(Type.Number()),
  model: Type.Optional(Type.String()),
  toolName: Type.Optional(Type.String({ maxLength: 128 })),
  stopped: Type.Optional(Type.Boolean()),
  error: Type.Optional(Type.String())
});

export const MessagePageMetadataSchema = messageObject({
  startCursor: Type.Optional(Type.String()),
  endCursor: Type.Optional(Type.String()),
  hasOlder: Type.Boolean(),
  hasNewer: Type.Boolean()
});

export const ConversationPageSchema = messageObject({
  sessionId: Type.String(),
  messages: Type.Array(SessionMessageSchema, { maxItems: 200 }),
  startCursor: Type.Optional(Type.String()),
  endCursor: Type.Optional(Type.String()),
  hasOlder: Type.Boolean(),
  hasNewer: Type.Boolean()
});

function messageObject<T extends TProperties>(properties: T) {
  return Type.Object(properties, { additionalProperties: false });
}
