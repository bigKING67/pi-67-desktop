import type { EnterpriseTeamSummary } from "./context-memory.js";
import type { TeamChatAgent, TeamChatAgentInvocationSummary, TeamChatBot } from "./team-chat-agents.js";
import type { TeamChatPolicy } from "./team-chat-governance.js";

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
  /** Unread messages that mention the reader, capped at 100. */
  mentionCount: number;
  /** Channel owner; absent for direct messages. */
  ownerUserId?: string;
  /** The reader muted system notifications here; unread counts still apply. */
  muted?: boolean;
  lastMessageAt?: number;
  lastSenderUserId?: string;
  lastPreview?: string;
  createdAt: number;
}

export type TeamChatWorkCardStatus = "todo" | "in_progress" | "in_review" | "done" | "closed";
export type TeamChatWorkCardAction = "claim" | "submit_for_review" | "accept" | "request_changes" | "close" | "reopen";
export const TEAM_CHAT_WORK_CARD_LIMITS = { title: 160, section: 4_000, summary: 8_000, refs: 10, refLabel: 200 } as const;

export interface TeamChatWorkCardRef {
  kind: "repository" | "branch" | "pull_request" | "link";
  label: string;
  /** HTTPS only. */
  url?: string;
}

/** A hand-off card (ADR 0003): reviewed text and references, never Session transcripts. */
export interface TeamChatWorkCard {
  id: string;
  conversationId: string;
  createdBy: string;
  assigneeUserId?: string;
  claimedBy?: string;
  title: string;
  goal: string;
  acceptance: string;
  summary: string;
  refs: TeamChatWorkCardRef[];
  status: TeamChatWorkCardStatus;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface TeamChatMessage {
  id: string;
  conversationId: string;
  seq: number;
  senderUserId: string;
  body: string;
  clientKey: string;
  createdAt: number;
  workCard?: TeamChatWorkCard;
  /** Conversation members the sender mentioned; absent when none. */
  mentionUserIds?: string[];
  /** Agents this message addressed and the state of each request. */
  agentInvocations?: TeamChatAgentInvocationSummary[];
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
  policy: TeamChatPolicy;
  /** The team's Agent members (never part of `members`). */
  agents: TeamChatAgent[];
  /** Incoming webhook bots, for labelling their messages. */
  bots: TeamChatBot[];
}

export type TeamChatPushEvent =
  | { type: "message.created"; message: TeamChatMessage }
  | { type: "conversation.changed"; conversationId: string }
  | { type: "work_card.changed"; card: TeamChatWorkCard }
  | { type: "read.changed"; conversationId: string; lastReadSeq: number }
  | { type: "policy.changed" }
  | { type: "agents.changed" }
  | { type: "agent_invocation.changed"; conversationId: string; messageId: string; invocation: TeamChatAgentInvocationSummary }
  | { type: "activity.changed" };

/**
 * `live` carries a generation that increases on every successful connect, so the
 * renderer reconciles over REST once per connection rather than trusting push alone.
 */
export type TeamChatConnectionState =
  | { status: "signed-out" }
  | { status: "connecting" }
  | { status: "live"; generation: number }
  | { status: "reconnecting"; retryAt: number }
  /** `rejected`: the service refused this device (revoked session or removed member). */
  | { status: "unavailable"; reason: "entitlement-inactive" | "not-member" | "rejected" };

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

/** Unread for the mode badge; a muted conversation counts only its mentions. */
export function teamChatUnreadTotal(conversations: readonly TeamChatConversation[]): number {
  return conversations.reduce((total, conversation) => total + (!conversation.joined ? 0
    : conversation.muted ? conversation.mentionCount : conversation.unreadCount), 0);
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

/**
 * Actions the service will accept from this member (mirrors the server policy):
 * the assignee, or anyone when unassigned, claims; the claimer submits; the
 * creator accepts, requests changes, closes or reopens.
 */
export function teamChatWorkCardActions(card: TeamChatWorkCard, selfUserId: string): TeamChatWorkCardAction[] {
  const creator = card.createdBy === selfUserId;
  switch (card.status) {
    case "todo":
      return [
        ...(card.assigneeUserId === undefined || card.assigneeUserId === selfUserId ? ["claim" as const] : []),
        ...(creator ? ["close" as const] : [])
      ];
    case "in_progress":
      return [
        ...(card.claimedBy === selfUserId ? ["submit_for_review" as const] : []),
        ...(creator ? ["close" as const] : [])
      ];
    case "in_review":
      return creator ? ["accept", "request_changes", "close"] : [];
    case "done":
    case "closed":
      return creator ? ["reopen"] : [];
  }
}

/** Starting Composer text for Work: the card's reviewed fields only. */
export function teamChatWorkCardBrief(card: Pick<TeamChatWorkCard, "title" | "goal" | "acceptance" | "summary" | "refs">): string {
  const sections = [`任务：${card.title}`];
  if (card.goal.trim()) sections.push(`目标：\n${card.goal.trim()}`);
  if (card.acceptance.trim()) sections.push(`验收条件：\n${card.acceptance.trim()}`);
  if (card.summary.trim()) sections.push(`交接摘要：\n${card.summary.trim()}`);
  if (card.refs.length > 0) {
    sections.push(`参考：\n${card.refs.map((ref) => `- ${ref.label}${ref.url ? ` ${ref.url}` : ""}`).join("\n")}`);
  }
  return sections.join("\n\n");
}
