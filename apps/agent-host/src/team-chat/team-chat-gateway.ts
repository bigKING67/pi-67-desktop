import type {
  TeamChatConversation,
  TeamChatMember,
  TeamChatMessage,
  TeamChatMessagePage,
  TeamChatVisibility
} from "@pi67/domain";
import {
  asRecord,
  boundedInteger,
  boundedString,
  invalidResponse,
  parseTimestamp
} from "../context/enterprise-context-gateway-validation.js";
import { requestNewMoney } from "../context/new-money-http.js";

export interface TeamChatAccess {
  endpoint: string;
  accessToken: string;
  teamId: string;
  userId: string;
}

/** Service error codes the renderer turns into specific copy. */
const TEAM_CHAT_SERVICE_ERRORS: ReadonlySet<string> = new Set([
  "entitlement_inactive",
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
  "chat_body_invalid"
]);

const MAX_CONVERSATIONS = 500;
const MAX_MEMBERS = 100_000;

export class TeamChatGateway {
  readonly #teamBase: string;

  constructor(private readonly access: TeamChatAccess) {
    this.#teamBase = `${access.endpoint.replace(/\/+$/u, "")}/v1/agent/teams/${encodeURIComponent(access.teamId)}`;
  }

  async listMembers(signal?: AbortSignal): Promise<TeamChatMember[]> {
    const value = asRecord(await this.#request("/members", { method: "GET" }, signal));
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
    const value = asRecord(await this.#request("/chat/conversations", { method: "GET" }, signal));
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
    const value = asRecord(await this.#request(`${conversationPath(conversationId)}/messages${suffix}`, { method: "GET" }, signal));
    if (!Array.isArray(value.messages) || value.messages.length > 100 || typeof value.hasMore !== "boolean") {
      throw invalidResponse("messages");
    }
    return { messages: value.messages.map(parseMessage), hasMore: value.hasMore };
  }

  async postMessage(conversationId: string, clientKey: string, body: string, signal?: AbortSignal): Promise<TeamChatMessage> {
    return parseMessage(await this.#request(`${conversationPath(conversationId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ clientKey, body })
    }, signal));
  }

  async markRead(conversationId: string, lastReadSeq: number, signal?: AbortSignal): Promise<number> {
    const value = asRecord(await this.#request(`${conversationPath(conversationId)}/read`, {
      method: "PUT",
      body: JSON.stringify({ lastReadSeq })
    }, signal));
    return boundedInteger(value.lastReadSeq, "lastReadSeq", 0);
  }

  async createChannel(
    input: { name: string; visibility: TeamChatVisibility; memberUserIds: string[] },
    signal?: AbortSignal
  ): Promise<TeamChatConversation> {
    return parseConversation(await this.#request("/chat/channels", { method: "POST", body: JSON.stringify(input) }, signal));
  }

  async joinChannel(conversationId: string, signal?: AbortSignal): Promise<TeamChatConversation> {
    return parseConversation(await this.#request(`${conversationPath(conversationId)}/join`, { method: "POST" }, signal));
  }

  async openDirectMessage(userId: string, signal?: AbortSignal): Promise<TeamChatConversation> {
    return parseConversation(await this.#request("/chat/direct-messages", {
      method: "POST",
      body: JSON.stringify({ userId })
    }, signal));
  }

  async issueRealtimeTicket(signal?: AbortSignal): Promise<string> {
    const value = asRecord(await this.#request("/chat/realtime-tickets", { method: "POST" }, signal));
    return boundedString(value.ticket, "ticket", 512);
  }

  #request(path: string, init: RequestInit, signal: AbortSignal | undefined): Promise<unknown> {
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
    ...(lastMessageAt === undefined ? {} : { lastMessageAt }),
    ...(lastSenderUserId === undefined ? {} : { lastSenderUserId }),
    ...(lastPreview === undefined ? {} : { lastPreview }),
    createdAt: parseTimestamp(record.createdAt, "conversation.createdAt")
  };
}

export function parseMessage(value: unknown): TeamChatMessage {
  const record = asRecord(value);
  return {
    id: boundedString(record.id, "message.id", 128),
    conversationId: boundedString(record.conversationId, "message.conversationId", 128),
    seq: boundedInteger(record.seq, "message.seq", 1),
    senderUserId: boundedString(record.senderUserId, "message.senderUserId", 128),
    body: boundedString(record.body, "message.body", 8_000),
    clientKey: boundedString(record.clientKey, "message.clientKey", 64),
    createdAt: parseTimestamp(record.createdAt, "message.createdAt")
  };
}

function nullable<T>(value: unknown, parse: (item: unknown) => T): T | undefined {
  return value === null || value === undefined ? undefined : parse(value);
}
