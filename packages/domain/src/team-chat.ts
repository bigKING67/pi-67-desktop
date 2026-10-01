import type { EnterpriseTeamSummary } from "./context-memory.js";

/** Team Chat (ADR 0003). New Money owns the truth; Desktop state is disposable. */
export const TEAM_CHAT_MESSAGE_MAX_CHARS = 4_000;
export const TEAM_CHAT_CHANNEL_NAME_MAX_CHARS = 80;
export const TEAM_CHAT_PAGE_MAX = 100;
export const TEAM_CHAT_MEMBER_BATCH_MAX = 200;
export const TEAM_CHAT_CLIENT_KEY_PATTERN = "^[A-Za-z0-9_-]{8,64}$";

export type TeamChatConversationKind = "channel" | "dm";
export type TeamChatVisibility = "public" | "private";

export interface TeamChatMember {
  userId: string;
  displayName: string;
  role: EnterpriseTeamSummary["role"];
}

export interface TeamChatConversation {
  id: string;
  kind: TeamChatConversationKind;
  visibility: TeamChatVisibility;
  /** Channel name; absent for direct messages. */
  name?: string;
  joined: boolean;
  memberCount: number;
  /** Both participants for direct messages; empty for channels. */
  memberUserIds: string[];
  lastSeq: number;
  lastReadSeq: number;
  /** Messages from others after `lastReadSeq`, capped at 100 by the service. */
  unreadCount: number;
  lastMessageAt?: number;
  lastSenderUserId?: string;
  lastPreview?: string;
  createdAt: number;
}

export interface TeamChatMessage {
  id: string;
  conversationId: string;
  seq: number;
  senderUserId: string;
  body: string;
  clientKey: string;
  createdAt: number;
}

export interface TeamChatMessagePage {
  messages: TeamChatMessage[];
  hasMore: boolean;
}

export interface TeamChatDirectory {
  teamId: string;
  selfUserId: string;
  members: TeamChatMember[];
  conversations: TeamChatConversation[];
}

export type TeamChatPushEvent =
  | { type: "message.created"; message: TeamChatMessage }
  | { type: "conversation.changed"; conversationId: string }
  | { type: "read.changed"; conversationId: string; lastReadSeq: number };

/**
 * `live` carries a generation that increases on every successful connect, so the
 * renderer reconciles over REST once per connection rather than trusting push alone.
 */
export type TeamChatConnectionState =
  | { status: "signed-out" }
  | { status: "connecting" }
  | { status: "live"; generation: number }
  | { status: "reconnecting"; retryAt: number }
  | { status: "unavailable"; reason: "entitlement-inactive" | "not-member" };

/** Merges by `seq`, keeping one ascending copy of each message. */
export function mergeTeamChatMessages(
  existing: readonly TeamChatMessage[],
  incoming: readonly TeamChatMessage[]
): TeamChatMessage[] {
  if (incoming.length === 0) return existing.slice();
  const bySeq = new Map<number, TeamChatMessage>();
  for (const message of existing) bySeq.set(message.seq, message);
  for (const message of incoming) bySeq.set(message.seq, message);
  return [...bySeq.values()].sort((left, right) => left.seq - right.seq);
}

/** True when the loaded tail does not reach `lastSeq`, so newer messages must be fetched. */
export function teamChatHasTailGap(messages: readonly TeamChatMessage[], lastSeq: number): boolean {
  const tail = messages.at(-1)?.seq ?? 0;
  return tail < lastSeq;
}

export function teamChatDirectPeer(
  conversation: Pick<TeamChatConversation, "kind" | "memberUserIds">,
  selfUserId: string
): string | undefined {
  if (conversation.kind !== "dm") return undefined;
  return conversation.memberUserIds.find((userId) => userId !== selfUserId);
}

export function teamChatUnreadTotal(conversations: readonly TeamChatConversation[]): number {
  return conversations.reduce((total, conversation) => total + (conversation.joined ? conversation.unreadCount : 0), 0);
}

const SURROGATE_PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

/** Unicode code points, matching the service's character limits (Rust `chars`). */
export function teamChatCodePointLength(text: string): number {
  return text.length - (text.match(SURROGATE_PAIR)?.length ?? 0);
}

/** The first `limit` code points, never splitting a surrogate pair. */
export function teamChatCodePointPrefix(text: string, limit: number): string {
  let end = 0;
  for (let count = 0; count < limit && end < text.length; count += 1) {
    end += (text.codePointAt(end) ?? 0) > 0xffff ? 2 : 1;
  }
  return text.slice(0, end);
}

/** C0 controls and DEL, which channel names may not contain. */
export function teamChatHasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
