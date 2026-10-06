/** Team Chat message search (ADR 0007). */
export const TEAM_CHAT_SEARCH_QUERY_MAX = 100;
export const TEAM_CHAT_SEARCH_PAGE = 50;
export const TEAM_CHAT_SEARCH_CURSOR_PATTERN = "^[0-9]{1,20}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

/** Where a hit matched: a plain message, or a Work Card section. */
export type TeamChatSearchField = "message" | "title" | "goal" | "acceptance" | "summary" | "attachment";

export interface TeamChatSearchHit {
  messageId: string;
  conversationId: string;
  seq: number;
  senderUserId: string;
  createdAt: number;
  field: TeamChatSearchField;
  /** One line around the first match, never the whole body. */
  snippet: string;
  cardTitle?: string;
}

export interface TeamChatSearchPage {
  results: TeamChatSearchHit[];
  /** Present while older matches remain. */
  nextCursor?: string;
}
