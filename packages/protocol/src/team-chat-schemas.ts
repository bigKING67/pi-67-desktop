import {
  TEAM_CHAT_ACTIVITY_KEY_PATTERN,
  TEAM_CHAT_ACTIVITY_LIMIT,
  TEAM_CHAT_AGENT_LIMITS,
  TEAM_CHAT_CHANNEL_NAME_MAX_CHARS,
  TEAM_CHAT_CLIENT_KEY_PATTERN,
  TEAM_CHAT_MEMBER_BATCH_MAX,
  TEAM_CHAT_MENTION_MAX,
  TEAM_CHAT_MESSAGE_MAX_CHARS,
  TEAM_CHAT_PAGE_MAX,
  TEAM_CHAT_WEBHOOK_NAME_MAX,
  TEAM_CHAT_WORK_CARD_LIMITS
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
const MentionsSchema = Type.Array(IdSchema, { maxItems: TEAM_CHAT_MENTION_MAX });
const PolicySchema = strictObject({
  channelCreation: Type.Union([Type.Literal("members"), Type.Literal("admins")]),
  viewersCanPost: Type.Boolean(),
  retentionDays: Type.Optional(Type.Union([Type.Literal(90), Type.Literal(180), Type.Literal(365)])),
  agentCreation: Type.Union([Type.Literal("members"), Type.Literal("admins")]),
  revision: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
});
const ChannelActionSchema = Type.Union([
  strictObject({ type: Type.Literal("rename"), name: ChannelNameSchema }),
  strictObject({ type: Type.Literal("archive") }),
  strictObject({ type: Type.Literal("unarchive") }),
  strictObject({ type: Type.Literal("addMembers"), userIds: Type.Array(IdSchema, { minItems: 1, maxItems: TEAM_CHAT_MEMBER_BATCH_MAX }) }),
  strictObject({ type: Type.Literal("removeMember"), userId: IdSchema }),
  strictObject({ type: Type.Literal("transferOwner"), userId: IdSchema }),
  strictObject({ type: Type.Literal("leave") })
]);
const InvocationReasonSchema = Type.Union(["daily_limit", "agent_disabled", "not_configured", "model_unavailable",
  "runtime_error", "lease_expired", "cancelled"].map((reason) => Type.Literal(reason)));
const InvocationSummarySchema = strictObject({
  id: IdSchema,
  agentUserId: IdSchema,
  status: Type.Union(["queued", "running", "replied", "failed", "expired", "rejected"].map((status) => Type.Literal(status))),
  reason: Type.Optional(InvocationReasonSchema)
});
const AgentNameSchema = Type.String({ minLength: 1, maxLength: TEAM_CHAT_AGENT_LIMITS.name });
const AgentDescriptionSchema = Type.String({ maxLength: TEAM_CHAT_AGENT_LIMITS.description });
const AgentSchema = strictObject({
  userId: IdSchema,
  name: AgentNameSchema,
  description: AgentDescriptionSchema,
  ownerUserId: IdSchema,
  modelLabel: Type.String({ maxLength: 120 }),
  dailyLimit: Type.Integer({ minimum: 1, maximum: TEAM_CHAT_AGENT_LIMITS.dailyLimit }),
  status: Type.Union([Type.Literal("active"), Type.Literal("disabled")]),
  disabledByAdmin: Type.Boolean(),
  online: Type.Boolean(),
  createdAt: TimestampSchema
});
const ModelRefSchema = strictObject({
  provider: Type.String({ minLength: 1, maxLength: 128 }),
  id: Type.String({ minLength: 1, maxLength: 256 })
});
const AgentBindingSchema = strictObject({
  agentUserId: IdSchema,
  workspaceId: Type.String({ minLength: 1, maxLength: 256 }),
  projectId: IdSchema,
  model: ModelRefSchema,
  enabled: Type.Boolean()
});
const AgentHostStateSchema = strictObject({
  bindings: Type.Array(AgentBindingSchema, { maxItems: TEAM_CHAT_AGENT_LIMITS.perOwner }),
  activity: Type.Array(strictObject({
    agentUserId: IdSchema,
    invocationId: IdSchema,
    state: Type.Union([Type.Literal("running"), Type.Literal("replied"), Type.Literal("failed")]),
    reason: Type.Optional(InvocationReasonSchema),
    at: TimestampSchema
  }), { maxItems: 20 })
});
const WebhookSchema = strictObject({
  botUserId: IdSchema,
  conversationId: IdSchema,
  channelName: ChannelNameSchema,
  name: Type.String({ minLength: 1, maxLength: TEAM_CHAT_WEBHOOK_NAME_MAX }),
  createdBy: IdSchema,
  createdAt: TimestampSchema,
  rotatedAt: Type.Optional(TimestampSchema),
  lastUsedAt: Type.Optional(TimestampSchema)
});
const WebhookSecretSchema = strictObject({
  webhook: WebhookSchema,
  url: Type.String({ minLength: 20, maxLength: 512, pattern: "^https?://[^\\s]+/v1/hooks/chat/" })
});
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
  mentionCount: Type.Integer({ minimum: 0, maximum: 100 }),
  ownerUserId: Type.Optional(IdSchema),
  muted: Type.Optional(Type.Boolean()),
  lastMessageAt: Type.Optional(TimestampSchema),
  lastSenderUserId: Type.Optional(IdSchema),
  lastPreview: Type.Optional(Type.String({ maxLength: 140 })),
  createdAt: TimestampSchema
});

const WorkCardRefSchema = strictObject({
  kind: Type.Union([Type.Literal("repository"), Type.Literal("branch"), Type.Literal("pull_request"), Type.Literal("link")]),
  label: Type.String({ minLength: 1, maxLength: TEAM_CHAT_WORK_CARD_LIMITS.refLabel }),
  url: Type.Optional(Type.String({ minLength: 9, maxLength: 2_048, pattern: "^https://" }))
});
const WorkCardRefsSchema = Type.Array(WorkCardRefSchema, { maxItems: TEAM_CHAT_WORK_CARD_LIMITS.refs });
const WorkCardSectionSchema = Type.String({ maxLength: TEAM_CHAT_WORK_CARD_LIMITS.section });
const WorkCardSummarySchema = Type.String({ maxLength: TEAM_CHAT_WORK_CARD_LIMITS.summary });
const WorkCardTitleSchema = Type.String({ minLength: 1, maxLength: TEAM_CHAT_WORK_CARD_LIMITS.title });
const WorkCardActionSchema = Type.Union([
  Type.Literal("claim"), Type.Literal("submit_for_review"), Type.Literal("accept"),
  Type.Literal("request_changes"), Type.Literal("close"), Type.Literal("reopen")
]);

export const TeamChatWorkCardSchema = strictObject({
  id: IdSchema,
  conversationId: IdSchema,
  createdBy: IdSchema,
  assigneeUserId: Type.Optional(IdSchema),
  claimedBy: Type.Optional(IdSchema),
  title: WorkCardTitleSchema,
  goal: WorkCardSectionSchema,
  acceptance: WorkCardSectionSchema,
  summary: WorkCardSummarySchema,
  refs: WorkCardRefsSchema,
  status: Type.Union([Type.Literal("todo"), Type.Literal("in_progress"), Type.Literal("in_review"), Type.Literal("done"), Type.Literal("closed")]),
  revision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
});

export const TeamChatMessageSchema = strictObject({
  id: IdSchema,
  conversationId: IdSchema,
  seq: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  senderUserId: IdSchema,
  body: BodySchema,
  clientKey: ClientKeySchema,
  createdAt: TimestampSchema,
  workCard: Type.Optional(TeamChatWorkCardSchema),
  mentionUserIds: Type.Optional(MentionsSchema),
  agentInvocations: Type.Optional(Type.Array(InvocationSummarySchema, { maxItems: TEAM_CHAT_MENTION_MAX }))
});

const ActivityKeySchema = Type.String({ minLength: 38, maxLength: 38, pattern: TEAM_CHAT_ACTIVITY_KEY_PATTERN });
const ActivityItemSchema = strictObject({
  key: ActivityKeySchema,
  kind: Type.Union(["mention", "dm", "agent_reply", "agent_failed", "card_assigned", "card_review", "card_changes_requested"]
    .map((kind) => Type.Literal(kind))),
  conversationId: IdSchema,
  actorUserId: IdSchema,
  messageSeq: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
  preview: Type.Optional(Type.String({ maxLength: 140 })),
  cardId: Type.Optional(IdSchema),
  cardTitle: Type.Optional(WorkCardTitleSchema),
  reason: Type.Optional(Type.String({ minLength: 1, maxLength: 40, pattern: "^[a-z_]+$" })),
  createdAt: TimestampSchema,
  unread: Type.Boolean(),
  doneAt: Type.Optional(TimestampSchema)
});

const ConnectionStateSchema = Type.Union([
  strictObject({ status: Type.Literal("signed-out") }),
  strictObject({ status: Type.Literal("connecting") }),
  strictObject({ status: Type.Literal("live"), generation: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }) }),
  strictObject({ status: Type.Literal("reconnecting"), retryAt: TimestampSchema }),
  strictObject({
    status: Type.Literal("unavailable"),
    reason: Type.Union([Type.Literal("entitlement-inactive"), Type.Literal("not-member"), Type.Literal("rejected")])
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
  "teamChat.message.send": strictObject({
    conversationId: IdSchema,
    clientKey: ClientKeySchema,
    body: BodySchema,
    mentionUserIds: Type.Optional(MentionsSchema)
  }),
  "teamChat.read.mark": strictObject({ conversationId: IdSchema, lastReadSeq: SeqSchema }),
  "teamChat.channel.create": strictObject({
    name: ChannelNameSchema,
    visibility: VisibilitySchema,
    memberUserIds: Type.Array(IdSchema, { maxItems: TEAM_CHAT_MEMBER_BATCH_MAX })
  }),
  "teamChat.channel.join": strictObject({ conversationId: IdSchema }),
  "teamChat.channel.members": strictObject({ conversationId: IdSchema }),
  "teamChat.channel.manage": strictObject({ conversationId: IdSchema, action: ChannelActionSchema }),
  "teamChat.dm.open": strictObject({ userId: IdSchema }),
  "teamChat.workCard.create": strictObject({
    conversationId: IdSchema,
    clientKey: ClientKeySchema,
    title: WorkCardTitleSchema,
    goal: WorkCardSectionSchema,
    acceptance: WorkCardSectionSchema,
    summary: WorkCardSummarySchema,
    refs: WorkCardRefsSchema,
    assigneeUserId: Type.Optional(IdSchema)
  }),
  "teamChat.workCard.act": strictObject({
    cardId: IdSchema,
    action: WorkCardActionSchema,
    expectedRevision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
  }),
  "teamChat.agent.create": strictObject({ name: AgentNameSchema, description: AgentDescriptionSchema }),
  "teamChat.agent.update": strictObject({
    agentUserId: IdSchema,
    name: Type.Optional(AgentNameSchema),
    description: Type.Optional(AgentDescriptionSchema),
    dailyLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: TEAM_CHAT_AGENT_LIMITS.dailyLimit }))
  }),
  "teamChat.agent.setDisabled": strictObject({ agentUserId: IdSchema, disabled: Type.Boolean() }),
  "teamChat.agent.remove": strictObject({ agentUserId: IdSchema }),
  "teamChat.agent.host.get": EmptySchema,
  "teamChat.agent.host.bind": strictObject({ binding: AgentBindingSchema }),
  "teamChat.agent.host.unbind": strictObject({ agentUserId: IdSchema }),
  "teamChat.webhook.list": strictObject({ conversationId: IdSchema }),
  "teamChat.webhook.create": strictObject({
    conversationId: IdSchema,
    name: Type.String({ minLength: 1, maxLength: TEAM_CHAT_WEBHOOK_NAME_MAX })
  }),
  "teamChat.webhook.rotate": strictObject({ conversationId: IdSchema, botUserId: IdSchema }),
  "teamChat.webhook.remove": strictObject({ conversationId: IdSchema, botUserId: IdSchema }),
  "teamChat.activity.list": EmptySchema,
  "teamChat.activity.setDone": strictObject({
    keys: Type.Array(ActivityKeySchema, { minItems: 1, maxItems: TEAM_CHAT_ACTIVITY_LIMIT }),
    done: Type.Boolean()
  }),
  "teamChat.activity.markAllRead": EmptySchema,
  "teamChat.conversation.mute": strictObject({ conversationId: IdSchema, muted: Type.Boolean() })
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
    conversations: Type.Array(TeamChatConversationSchema, { maxItems: 500 }),
    policy: PolicySchema,
    agents: Type.Array(AgentSchema, { maxItems: 50 }),
    bots: Type.Array(strictObject({
      userId: IdSchema,
      name: Type.String({ minLength: 1, maxLength: TEAM_CHAT_WEBHOOK_NAME_MAX }),
      conversationId: IdSchema
    }), { maxItems: 100 })
  }),
  "teamChat.messages.list": strictObject({
    messages: Type.Array(TeamChatMessageSchema, { maxItems: TEAM_CHAT_PAGE_MAX }),
    hasMore: Type.Boolean()
  }),
  "teamChat.message.send": TeamChatMessageSchema,
  "teamChat.read.mark": strictObject({ lastReadSeq: SeqSchema }),
  "teamChat.channel.create": TeamChatConversationSchema,
  "teamChat.channel.join": TeamChatConversationSchema,
  "teamChat.channel.members": strictObject({
    ownerUserId: IdSchema,
    members: Type.Array(strictObject({ userId: IdSchema, joinedAt: TimestampSchema }), { maxItems: 100_000 })
  }),
  "teamChat.channel.manage": EmptySchema,
  "teamChat.dm.open": TeamChatConversationSchema,
  "teamChat.workCard.create": TeamChatMessageSchema,
  "teamChat.workCard.act": TeamChatWorkCardSchema,
  "teamChat.agent.create": AgentSchema,
  "teamChat.agent.update": AgentSchema,
  "teamChat.agent.setDisabled": AgentSchema,
  "teamChat.agent.remove": EmptySchema,
  "teamChat.agent.host.get": AgentHostStateSchema,
  "teamChat.agent.host.bind": AgentHostStateSchema,
  "teamChat.agent.host.unbind": AgentHostStateSchema,
  "teamChat.webhook.list": strictObject({ webhooks: Type.Array(WebhookSchema, { maxItems: 10 }) }),
  "teamChat.webhook.create": WebhookSecretSchema,
  "teamChat.webhook.rotate": WebhookSecretSchema,
  "teamChat.webhook.remove": EmptySchema,
  "teamChat.activity.list": strictObject({ items: Type.Array(ActivityItemSchema, { maxItems: TEAM_CHAT_ACTIVITY_LIMIT }) }),
  "teamChat.activity.setDone": EmptySchema,
  "teamChat.activity.markAllRead": EmptySchema,
  "teamChat.conversation.mute": strictObject({ muted: Type.Boolean() })
};

export const TeamChatEventPayloadSchemas: Record<keyof TeamChatEventPayloads, TSchema> = {
  "teamChat.pushed": Type.Union([
    strictObject({ type: Type.Literal("message.created"), message: TeamChatMessageSchema }),
    strictObject({ type: Type.Literal("conversation.changed"), conversationId: IdSchema }),
    strictObject({ type: Type.Literal("work_card.changed"), card: TeamChatWorkCardSchema }),
    strictObject({ type: Type.Literal("read.changed"), conversationId: IdSchema, lastReadSeq: SeqSchema }),
    strictObject({ type: Type.Literal("policy.changed") }),
    strictObject({ type: Type.Literal("agents.changed") }),
    strictObject({
      type: Type.Literal("agent_invocation.changed"),
      conversationId: IdSchema,
      messageId: IdSchema,
      invocation: InvocationSummarySchema
    }),
    strictObject({ type: Type.Literal("activity.changed") })
  ]),
  "teamChat.connectionChanged": ConnectionStateSchema,
  "teamChat.agentHostChanged": AgentHostStateSchema
};
