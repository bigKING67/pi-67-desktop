import {
  TEAM_CHAT_DEFAULT_POLICY,
  type TeamChatActivityItem,
  type TeamChatSearchPage,
  TEAM_CHAT_MENTION_MAX,
  type TeamChatChannelAction,
  type TeamChatChannelRoster,
  type TeamChatConversation,
  type TeamChatAgentInvocationSummary,
  type TeamChatMember,
  type TeamChatMessage,
  type TeamChatMessagePage,
  type TeamChatPolicy,
  type TeamChatVisibility,
  type TeamChatWorkCard,
  type TeamChatWorkCardAction,
  type TeamChatWorkCardRef
} from "@pi67/domain";
import {
  asRecord,
  boundedInteger,
  boundedString,
  invalidResponse,
  parseTimestamp
} from "../context/enterprise-context-gateway-validation.js";
import { requestNewMoney } from "../context/new-money-http.js";
import { parseActivity } from "./team-chat-activity-parse.js";
import { parseSearchPage } from "./team-chat-search-parse.js";
import { parseWorkCard } from "./team-chat-work-card-parse.js";

export interface TeamChatAccess {
  endpoint: string;
  accessToken: string;
  teamId: string;
  userId: string;
}

/** Service error codes the renderer turns into specific copy. */
const TEAM_CHAT_SERVICE_ERRORS: ReadonlySet<string> = new Set([
  "entitlement_inactive",
  "chat_message_not_found",
  "chat_message_not_own",
  "chat_message_recalled",
  "chat_message_not_editable",
  "team_not_found",
  "device_team_scope",
  "chat_conversation_not_found",
  "chat_membership_required",
  "chat_channel_private",
  "chat_channel_name_taken",
  "chat_channel_name_invalid",
  "chat_dm_peer_unavailable",
  "chat_dm_self",
  "chat_member_not_in_team",
  "chat_client_key_reused",
  "chat_body_invalid",
  "chat_channel_creation_restricted",
  "chat_viewer_read_only",
  "chat_conversation_archived",
  "chat_mention_invalid",
  "chat_channel_manager_required",
  "chat_owner_must_transfer",
  "chat_owner_not_member",
  "chat_member_not_found",
  "chat_agent_creation_restricted",
  "chat_agent_name_taken",
  "chat_agent_quota_reached",
  "chat_agent_invalid",
  "chat_agent_not_found",
  "chat_agent_owner_required",
  "chat_agent_manager_required",
  "chat_agent_disabled_by_admin",
  "chat_agent_host_invalid",
  "chat_agent_invocation_unavailable",
  "chat_webhook_invalid",
  "chat_webhook_name_taken",
  "chat_webhook_quota_reached",
  "chat_webhook_not_found",
  "work_card_not_found",
  "work_card_invalid",
  "work_card_assignee_invalid",
  "work_card_revision_conflict",
  "work_card_invalid_transition",
  "work_card_not_permitted"
]);

const MAX_CONVERSATIONS = 500;
const MAX_MEMBERS = 100_000;

export class TeamChatGateway {
  readonly #teamBase: string;

  constructor(private readonly access: TeamChatAccess) {
    this.#teamBase = `${access.endpoint.replace(/\/+$/u, "")}/v1/agent/teams/${encodeURIComponent(access.teamId)}`;
  }

  async listMembers(signal?: AbortSignal): Promise<TeamChatMember[]> {
    const value = asRecord(await this.request("/members", { method: "GET" }, signal));
    if (!Array.isArray(value.members) || value.members.length > MAX_MEMBERS) throw invalidResponse("members");
    return value.members.map((item) => {
      const record = asRecord(item);
      const role = record.role;
      if (role !== "owner" && role !== "admin" && role !== "member" && role !== "viewer") throw invalidResponse("member.role");
      return {
        userId: boundedString(record.userId, "member.userId", 128),
        displayName: boundedString(record.displayName, "member.displayName", 160),
        role
      };
    });
  }

  async listConversations(signal?: AbortSignal): Promise<TeamChatConversation[]> {
    const value = asRecord(await this.request("/chat/conversations", { method: "GET" }, signal));
    if (!Array.isArray(value.conversations) || value.conversations.length > MAX_CONVERSATIONS) {
      throw invalidResponse("conversations");
    }
    return value.conversations.map(parseConversation);
  }

  async listMessages(
    conversationId: string,
    page: { before?: number; after?: number; limit?: number },
    signal?: AbortSignal
  ): Promise<TeamChatMessagePage> {
    const query = new URLSearchParams();
    if (page.before !== undefined) query.set("before", String(page.before));
    if (page.after !== undefined) query.set("after", String(page.after));
    if (page.limit !== undefined) query.set("limit", String(page.limit));
    const suffix = query.size === 0 ? "" : `?${query}`;
    const value = asRecord(await this.request(`${conversationPath(conversationId)}/messages${suffix}`, { method: "GET" }, signal));
    if (!Array.isArray(value.messages) || value.messages.length > 100 || typeof value.hasMore !== "boolean") {
      throw invalidResponse("messages");
    }
    return { messages: value.messages.map(parseMessage), hasMore: value.hasMore };
  }

  async postMessage(
    conversationId: string,
    input: { clientKey: string; body: string; mentionUserIds?: string[] },
    signal?: AbortSignal
  ): Promise<TeamChatMessage> {
    return parseMessage(await this.request(`${conversationPath(conversationId)}/messages`, {
      method: "POST",
      body: JSON.stringify(input)
    }, signal));
  }

  async getPolicy(signal?: AbortSignal): Promise<TeamChatPolicy> {
    const record = asRecord(await this.request("/chat/policy", { method: "GET" }, signal));
    const channelCreation = record.channelCreation;
    if (channelCreation !== "members" && channelCreation !== "admins") throw invalidResponse("policy.channelCreation");
    if (typeof record.viewersCanPost !== "boolean") throw invalidResponse("policy.viewersCanPost");
    const retentionDays = nullable(record.retentionDays, (item) => {
      if (item !== 90 && item !== 180 && item !== 365) throw invalidResponse("policy.retentionDays");
      return item;
    });
    // Services before the Agent members release omit the field; their default is members.
    const agentCreation = record.agentCreation === "admins" ? "admins" : "members";
    return {
      channelCreation,
      viewersCanPost: record.viewersCanPost,
      agentCreation,
      ...(retentionDays === undefined ? {} : { retentionDays }),
      revision: boundedInteger(record.revision, "policy.revision", 0)
    };
  }

  /** The policy, or defaults when it cannot be read; New Money still enforces the real one. */
  async getPolicyOrDefault(signal?: AbortSignal): Promise<TeamChatPolicy> {
    return this.getPolicy(signal).catch(() => TEAM_CHAT_DEFAULT_POLICY);
  }

  async channelMembers(conversationId: string, signal?: AbortSignal): Promise<TeamChatChannelRoster> {
    const record = asRecord(await this.request(`${conversationPath(conversationId)}/members`, { method: "GET" }, signal));
    if (!Array.isArray(record.members) || record.members.length > MAX_MEMBERS) throw invalidResponse("roster.members");
    return {
      ownerUserId: boundedString(record.ownerUserId, "roster.ownerUserId", 128),
      members: record.members.map((item, index) => {
        const member = asRecord(item);
        return {
          userId: boundedString(member.userId, `roster.members.${index}.userId`, 128),
          joinedAt: parseTimestamp(member.joinedAt, `roster.members.${index}.joinedAt`)
        };
      })
    };
  }

  async manageChannel(conversationId: string, action: TeamChatChannelAction, signal?: AbortSignal): Promise<void> {
    const path = conversationPath(conversationId);
    const [suffix, init]: [string, RequestInit] = (() => {
      switch (action.type) {
        case "rename": return ["", { method: "PATCH", body: JSON.stringify({ name: action.name }) }];
        case "archive": return ["/archive", { method: "POST" }];
        case "unarchive": return ["/unarchive", { method: "POST" }];
        case "addMembers": return ["/members", { method: "POST", body: JSON.stringify({ userIds: action.userIds }) }];
        case "removeMember": return [`/members/${encodeURIComponent(action.userId)}`, { method: "DELETE" }];
        case "transferOwner": return ["/owner", { method: "PUT", body: JSON.stringify({ userId: action.userId }) }];
        case "leave": return ["/leave", { method: "POST" }];
      }
    })();
    await this.request(`${path}${suffix}`, init, signal);
  }

  /** The sender's edit (ADR 0008); earlier text is not kept by the service. */
  async editMessage(
    conversationId: string,
    messageId: string,
    input: { body: string; mentionUserIds?: string[] },
    signal?: AbortSignal
  ): Promise<TeamChatMessage> {
    return parseMessage(await this.request(`${conversationPath(conversationId)}/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      body: JSON.stringify(input)
    }, signal));
  }

  async recallMessage(conversationId: string, messageId: string, signal?: AbortSignal): Promise<TeamChatMessage> {
    return parseMessage(await this.request(`${conversationPath(conversationId)}/messages/${encodeURIComponent(messageId)}`, {
      method: "DELETE"
    }, signal));
  }

  async markRead(conversationId: string, lastReadSeq: number, signal?: AbortSignal): Promise<number> {
    const value = asRecord(await this.request(`${conversationPath(conversationId)}/read`, {
      method: "PUT",
      body: JSON.stringify({ lastReadSeq })
    }, signal));
    return boundedInteger(value.lastReadSeq, "lastReadSeq", 0);
  }

  async createChannel(
    input: { name: string; visibility: TeamChatVisibility; memberUserIds: string[] },
    signal?: AbortSignal
  ): Promise<TeamChatConversation> {
    return parseConversation(await this.request("/chat/channels", { method: "POST", body: JSON.stringify(input) }, signal));
  }

  async joinChannel(conversationId: string, signal?: AbortSignal): Promise<TeamChatConversation> {
    return parseConversation(await this.request(`${conversationPath(conversationId)}/join`, { method: "POST" }, signal));
  }

  async openDirectMessage(userId: string, signal?: AbortSignal): Promise<TeamChatConversation> {
    return parseConversation(await this.request("/chat/direct-messages", {
      method: "POST",
      body: JSON.stringify({ userId })
    }, signal));
  }

  async createWorkCard(
    conversationId: string,
    input: { clientKey: string; title: string; goal: string; acceptance: string; summary: string;
      refs: TeamChatWorkCardRef[]; assigneeUserId?: string },
    signal?: AbortSignal
  ): Promise<TeamChatMessage> {
    return parseMessage(await this.request(`${conversationPath(conversationId)}/work-cards`, {
      method: "POST",
      body: JSON.stringify(input)
    }, signal));
  }

  async actOnWorkCard(cardId: string, action: TeamChatWorkCardAction, expectedRevision: number, signal?: AbortSignal): Promise<TeamChatWorkCard> {
    return parseWorkCard(await this.request(`/chat/work-cards/${encodeURIComponent(cardId)}/actions`, {
      method: "POST",
      body: JSON.stringify({ action, expectedRevision })
    }, signal));
  }

  async listActivity(signal?: AbortSignal): Promise<TeamChatActivityItem[]> {
    return parseActivity(await this.request("/chat/activity", { method: "GET" }, signal));
  }

  async searchMessages(
    input: { query: string; conversationId?: string; senderUserId?: string; cursor?: string },
    signal?: AbortSignal
  ): Promise<TeamChatSearchPage> {
    const params = new URLSearchParams({ q: input.query });
    if (input.conversationId !== undefined) params.set("conversationId", input.conversationId);
    if (input.senderUserId !== undefined) params.set("senderUserId", input.senderUserId);
    if (input.cursor !== undefined) params.set("cursor", input.cursor);
    return parseSearchPage(await this.request(`/chat/search?${params.toString()}`, { method: "GET" }, signal));
  }

  async setActivityDone(keys: readonly string[], done: boolean, signal?: AbortSignal): Promise<void> {
    await this.request("/chat/activity/done", { method: "POST", body: JSON.stringify({ keys, done }) }, signal);
  }

  async markActivityRead(signal?: AbortSignal): Promise<void> {
    await this.request("/chat/activity/read", { method: "POST" }, signal);
  }

  async muteConversation(conversationId: string, muted: boolean, signal?: AbortSignal): Promise<boolean> {
    const value = asRecord(await this.request(`${conversationPath(conversationId)}/mute`, {
      method: "PUT",
      body: JSON.stringify({ muted })
    }, signal));
    if (typeof value.muted !== "boolean") throw invalidResponse("muted");
    return value.muted;
  }

  /** `hostAgentIds` are this Desktop's enabled Agents; while connected they show as online. */
  async issueRealtimeTicket(signal?: AbortSignal, hostAgentIds: readonly string[] = []): Promise<string> {
    const value = asRecord(await this.request("/chat/realtime-tickets", hostAgentIds.length === 0
      ? { method: "POST" }
      : { method: "POST", body: JSON.stringify({ hostAgentIds }) }, signal));
    return boundedString(value.ticket, "ticket", 512);
  }

  protected request(path: string, init: RequestInit, signal: AbortSignal | undefined): Promise<unknown> {
    return requestNewMoney(`${this.#teamBase}${path}`, { ...init, ...(signal === undefined ? {} : { signal }) }, {
      accessToken: this.access.accessToken,
      surfacedErrors: TEAM_CHAT_SERVICE_ERRORS
    });
  }
}

function conversationPath(conversationId: string): string {
  return `/chat/conversations/${encodeURIComponent(conversationId)}`;
}

export function parseConversation(value: unknown): TeamChatConversation {
  const record = asRecord(value);
  const kind = record.kind;
  const visibility = record.visibility;
  if (kind !== "channel" && kind !== "dm") throw invalidResponse("conversation.kind");
  if (visibility !== "public" && visibility !== "private") throw invalidResponse("conversation.visibility");
  if (typeof record.joined !== "boolean") throw invalidResponse("conversation.joined");
  if (!Array.isArray(record.memberUserIds) || record.memberUserIds.length > 2) {
    throw invalidResponse("conversation.memberUserIds");
  }
  const name = nullable(record.name, (item) => boundedString(item, "conversation.name", 160));
  if ((kind === "channel") !== (name !== undefined)) throw invalidResponse("conversation.name");
  const lastMessageAt = nullable(record.lastMessageAt, (item) => parseTimestamp(item, "conversation.lastMessageAt"));
  const lastSenderUserId = nullable(record.lastSenderUserId, (item) => boundedString(item, "conversation.lastSenderUserId", 128));
  const ownerUserId = nullable(record.ownerUserId, (item) => boundedString(item, "conversation.ownerUserId", 128));
  if (record.muted !== undefined && typeof record.muted !== "boolean") throw invalidResponse("conversation.muted");
  const lastPreview = nullable(record.lastPreview, (item) => {
    if (typeof item !== "string" || item.length > 280) throw invalidResponse("conversation.lastPreview");
    return item;
  });
  return {
    id: boundedString(record.id, "conversation.id", 128),
    kind,
    visibility,
    ...(name === undefined ? {} : { name }),
    joined: record.joined,
    memberCount: boundedInteger(record.memberCount, "conversation.memberCount", 0, MAX_MEMBERS),
    memberUserIds: record.memberUserIds.map((item, index) => boundedString(item, `conversation.memberUserIds.${index}`, 128)),
    lastSeq: boundedInteger(record.lastSeq, "conversation.lastSeq", 0),
    lastReadSeq: boundedInteger(record.lastReadSeq, "conversation.lastReadSeq", 0),
    unreadCount: boundedInteger(record.unreadCount, "conversation.unreadCount", 0, 100),
    mentionCount: record.mentionCount === undefined ? 0 : boundedInteger(record.mentionCount, "conversation.mentionCount", 0, 100),
    ...(ownerUserId === undefined ? {} : { ownerUserId }),
    ...(record.muted === true ? { muted: true } : {}),
    ...(lastMessageAt === undefined ? {} : { lastMessageAt }),
    ...(lastSenderUserId === undefined ? {} : { lastSenderUserId }),
    ...(lastPreview === undefined ? {} : { lastPreview }),
    createdAt: parseTimestamp(record.createdAt, "conversation.createdAt")
  };
}

export function parseMessage(value: unknown): TeamChatMessage {
  const record = asRecord(value);
  const workCard = nullable(record.workCard, parseWorkCard);
  const mentions = nullable(record.mentionUserIds, (item) => {
    if (!Array.isArray(item) || item.length > TEAM_CHAT_MENTION_MAX) throw invalidResponse("message.mentionUserIds");
    return item.map((userId, index) => boundedString(userId, `message.mentionUserIds.${index}`, 128));
  });
  const editedAt = nullable(record.editedAt, (item) => parseTimestamp(item, "message.editedAt"));
  const recalledAt = nullable(record.recalledAt, (item) => parseTimestamp(item, "message.recalledAt"));
  const recalledBy = nullable(record.recalledBy, (item) => boundedString(item, "message.recalledBy", 128));
  // Only a recalled message has an empty body.
  if (recalledAt !== undefined ? record.body !== "" : typeof record.body !== "string" || record.body.length === 0) {
    throw invalidResponse("message.body");
  }
  const invocations = nullable(record.agentInvocations, (item) => {
    if (!Array.isArray(item) || item.length > TEAM_CHAT_MENTION_MAX) throw invalidResponse("message.agentInvocations");
    return item.map(parseInvocationSummary);
  });
  return {
    ...(workCard === undefined ? {} : { workCard }),
    ...(mentions === undefined || mentions.length === 0 ? {} : { mentionUserIds: mentions }),
    ...(invocations === undefined || invocations.length === 0 ? {} : { agentInvocations: invocations }),
    id: boundedString(record.id, "message.id", 128),
    conversationId: boundedString(record.conversationId, "message.conversationId", 128),
    seq: boundedInteger(record.seq, "message.seq", 1),
    senderUserId: boundedString(record.senderUserId, "message.senderUserId", 128),
    body: recalledAt === undefined ? boundedString(record.body, "message.body", 8_000) : "",
    ...(editedAt === undefined ? {} : { editedAt }),
    ...(recalledAt === undefined ? {} : { recalledAt }),
    ...(recalledBy === undefined ? {} : { recalledBy }),
    clientKey: boundedString(record.clientKey, "message.clientKey", 64),
    createdAt: parseTimestamp(record.createdAt, "message.createdAt")
  };
}

const INVOCATION_STATUSES = new Set(["queued", "running", "replied", "failed", "expired", "rejected"]);
const INVOCATION_REASONS = new Set(["daily_limit", "agent_disabled", "not_configured", "model_unavailable",
  "runtime_error", "lease_expired", "cancelled"]);

export function parseInvocationSummary(value: unknown): TeamChatAgentInvocationSummary {
  const record = asRecord(value);
  if (typeof record.status !== "string" || !INVOCATION_STATUSES.has(record.status)) throw invalidResponse("invocation.status");
  const reason = nullable(record.reason, (item) => {
    if (typeof item !== "string" || !INVOCATION_REASONS.has(item)) throw invalidResponse("invocation.reason");
    return item as NonNullable<TeamChatAgentInvocationSummary["reason"]>;
  });
  return {
    id: boundedString(record.id, "invocation.id", 128),
    agentUserId: boundedString(record.agentUserId, "invocation.agentUserId", 128),
    status: record.status as TeamChatAgentInvocationSummary["status"],
    ...(reason === undefined ? {} : { reason })
  };
}

export function nullable<T>(value: unknown, parse: (item: unknown) => T): T | undefined {
  return value === null || value === undefined ? undefined : parse(value);
}
