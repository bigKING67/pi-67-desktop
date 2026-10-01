import {
  TEAM_CHAT_CHANNEL_NAME_MAX_CHARS,
  TEAM_CHAT_CLIENT_KEY_PATTERN,
  TEAM_CHAT_MEMBER_BATCH_MAX,
  TEAM_CHAT_MESSAGE_MAX_CHARS,
  TEAM_CHAT_PAGE_MAX
} from "@pi67/domain";
import { strictObject, Type, type TSchema } from "./typebox-schema.js";
import type {
  TeamChatCommandPayloads,
  TeamChatCommandResults,
  TeamChatEventPayloads
} from "./team-chat-command-messages.js";

// TypeBox counts graphemes, which never exceed the service's code-point count, so
// these bounds admit every valid service value; Host enforces exact code points.
const IdSchema = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9-]+$" });
const SeqSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const TimestampSchema = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const BodySchema = Type.String({ minLength: 1, maxLength: TEAM_CHAT_MESSAGE_MAX_CHARS });
const ChannelNameSchema = Type.String({ minLength: 1, maxLength: TEAM_CHAT_CHANNEL_NAME_MAX_CHARS });
const ClientKeySchema = Type.String({ minLength: 8, maxLength: 64, pattern: TEAM_CHAT_CLIENT_KEY_PATTERN });
const VisibilitySchema = Type.Union([Type.Literal("public"), Type.Literal("private")]);
const RoleSchema = Type.Union([
  Type.Literal("owner"),
  Type.Literal("admin"),
  Type.Literal("member"),
  Type.Literal("viewer")
]);

export const TeamChatConversationSchema = strictObject({
  id: IdSchema,
  kind: Type.Union([Type.Literal("channel"), Type.Literal("dm")]),
  visibility: VisibilitySchema,
  name: Type.Optional(ChannelNameSchema),
  joined: Type.Boolean(),
  memberCount: Type.Integer({ minimum: 0, maximum: 100_000 }),
  memberUserIds: Type.Array(IdSchema, { maxItems: 2 }),
  lastSeq: SeqSchema,
  lastReadSeq: SeqSchema,
  unreadCount: Type.Integer({ minimum: 0, maximum: 100 }),
  lastMessageAt: Type.Optional(TimestampSchema),
  lastSenderUserId: Type.Optional(IdSchema),
  lastPreview: Type.Optional(Type.String({ maxLength: 140 })),
  createdAt: TimestampSchema
});

export const TeamChatMessageSchema = strictObject({
  id: IdSchema,
  conversationId: IdSchema,
  seq: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  senderUserId: IdSchema,
  body: BodySchema,
  clientKey: ClientKeySchema,
  createdAt: TimestampSchema
});

const ConnectionStateSchema = Type.Union([
  strictObject({ status: Type.Literal("signed-out") }),
  strictObject({ status: Type.Literal("connecting") }),
  strictObject({ status: Type.Literal("live"), generation: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }) }),
  strictObject({ status: Type.Literal("reconnecting"), retryAt: TimestampSchema }),
  strictObject({
    status: Type.Literal("unavailable"),
    reason: Type.Union([Type.Literal("entitlement-inactive"), Type.Literal("not-member")])
  })
]);

const EmptySchema = strictObject({});

export const TeamChatCommandPayloadSchemas: Record<keyof TeamChatCommandPayloads, TSchema> = {
  "teamChat.connection.get": EmptySchema,
  "teamChat.directory.get": EmptySchema,
  "teamChat.messages.list": strictObject({
    conversationId: IdSchema,
    before: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
    after: Type.Optional(SeqSchema),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: TEAM_CHAT_PAGE_MAX }))
  }),
  "teamChat.message.send": strictObject({ conversationId: IdSchema, clientKey: ClientKeySchema, body: BodySchema }),
  "teamChat.read.mark": strictObject({ conversationId: IdSchema, lastReadSeq: SeqSchema }),
  "teamChat.channel.create": strictObject({
    name: ChannelNameSchema,
    visibility: VisibilitySchema,
    memberUserIds: Type.Array(IdSchema, { maxItems: TEAM_CHAT_MEMBER_BATCH_MAX })
  }),
  "teamChat.channel.join": strictObject({ conversationId: IdSchema }),
  "teamChat.dm.open": strictObject({ userId: IdSchema })
};

export const TeamChatCommandResultSchemas: Record<keyof TeamChatCommandResults, TSchema> = {
  "teamChat.connection.get": ConnectionStateSchema,
  "teamChat.directory.get": strictObject({
    teamId: IdSchema,
    selfUserId: IdSchema,
    members: Type.Array(strictObject({
      userId: IdSchema,
      displayName: Type.String({ minLength: 1, maxLength: 160 }),
      role: RoleSchema
    }), { maxItems: 100_000 }),
    conversations: Type.Array(TeamChatConversationSchema, { maxItems: 500 })
  }),
  "teamChat.messages.list": strictObject({
    messages: Type.Array(TeamChatMessageSchema, { maxItems: TEAM_CHAT_PAGE_MAX }),
    hasMore: Type.Boolean()
  }),
  "teamChat.message.send": TeamChatMessageSchema,
  "teamChat.read.mark": strictObject({ lastReadSeq: SeqSchema }),
  "teamChat.channel.create": TeamChatConversationSchema,
  "teamChat.channel.join": TeamChatConversationSchema,
  "teamChat.dm.open": TeamChatConversationSchema
};

export const TeamChatEventPayloadSchemas: Record<keyof TeamChatEventPayloads, TSchema> = {
  "teamChat.pushed": Type.Union([
    strictObject({ type: Type.Literal("message.created"), message: TeamChatMessageSchema }),
    strictObject({ type: Type.Literal("conversation.changed"), conversationId: IdSchema }),
    strictObject({ type: Type.Literal("read.changed"), conversationId: IdSchema, lastReadSeq: SeqSchema })
  ]),
  "teamChat.connectionChanged": ConnectionStateSchema
};
