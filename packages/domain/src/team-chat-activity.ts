import type { TeamChatConversation } from "./team-chat.js";

/** Activity items the service derives for one member (ADR 0006). */
export type TeamChatActivityKind =
  | "mention"
  | "dm"
  | "agent_reply"
  | "agent_failed"
  | "card_assigned"
  | "card_review"
  | "card_changes_requested";

export interface TeamChatActivityItem {
  /** `m:<message>`, `i:<invocation>` or `e:<work card event>`; stable per source row. */
  key: string;
  kind: TeamChatActivityKind;
  conversationId: string;
  /** Sender, Agent, or the member who changed the card. */
  actorUserId: string;
  /** Message to open: the message itself, the asking message, or the card's message. */
  messageSeq?: number;
  /** Message items only, at most 140 characters. */
  preview?: string;
  cardId?: string;
  cardTitle?: string;
  /** Why an Agent request ended without a reply. */
  reason?: string;
  createdAt: number;
  unread: boolean;
  doneAt?: number;
}

export const TEAM_CHAT_ACTIVITY_LIMIT = 200;
export const TEAM_CHAT_ACTIVITY_KEY_PATTERN = "^[mie]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

const MESSAGE_KINDS = new Set<TeamChatActivityKind>(["mention", "dm", "agent_reply"]);

/**
 * Unread as shown: the service's flag, cleared locally as soon as the reader's
 * conversation cursor passes a message item, so reading a conversation clears
 * its activity without waiting for a re-read.
 */
export function teamChatActivityIsUnread(item: TeamChatActivityItem, conversation: TeamChatConversation | undefined): boolean {
  if (!item.unread || item.doneAt !== undefined) return false;
  if (!MESSAGE_KINDS.has(item.kind) || item.messageSeq === undefined || !conversation) return true;
  return item.messageSeq > conversation.lastReadSeq;
}

/**
 * Items whose conversation the reader still belongs to. Leaving, removal or archiving
 * hides their items at once, before the service's next derived list drops them.
 */
export function teamChatActivityInView(
  items: readonly TeamChatActivityItem[],
  conversations: readonly TeamChatConversation[]
): TeamChatActivityItem[] {
  const joined = new Set(conversations.filter((conversation) => conversation.joined).map((conversation) => conversation.id));
  return items.filter((item) => joined.has(item.conversationId));
}

export function teamChatActivityUnreadCount(
  items: readonly TeamChatActivityItem[],
  conversations: readonly TeamChatConversation[]
): number {
  const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  return teamChatActivityInView(items, conversations)
    .filter((item) => teamChatActivityIsUnread(item, byId.get(item.conversationId))).length;
}
