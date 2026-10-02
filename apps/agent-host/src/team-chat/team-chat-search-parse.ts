import {
  TEAM_CHAT_SEARCH_CURSOR_PATTERN,
  TEAM_CHAT_SEARCH_PAGE,
  type TeamChatSearchField,
  type TeamChatSearchPage
} from "@pi67/domain";
import {
  asRecord,
  boundedInteger,
  boundedString,
  invalidResponse,
  parseTimestamp
} from "../context/enterprise-context-gateway-validation.js";

const FIELDS: ReadonlySet<string> = new Set<TeamChatSearchField>(["message", "title", "goal", "acceptance", "summary"]);
const CURSOR = new RegExp(TEAM_CHAT_SEARCH_CURSOR_PATTERN, "u");

/** One page of search hits (ADR 0007): excerpts only, bounded like the protocol. */
export function parseSearchPage(value: unknown): TeamChatSearchPage {
  const record = asRecord(value);
  if (!Array.isArray(record.results) || record.results.length > TEAM_CHAT_SEARCH_PAGE) throw invalidResponse("search.results");
  const nextCursor = record.nextCursor === undefined || record.nextCursor === null
    ? undefined
    : boundedString(record.nextCursor, "search.nextCursor", 64);
  if (nextCursor !== undefined && !CURSOR.test(nextCursor)) throw invalidResponse("search.nextCursor");
  return {
    results: record.results.map((item, index) => {
      const hit = asRecord(item);
      const field = `search.results.${index}`;
      if (typeof hit.field !== "string" || !FIELDS.has(hit.field)) throw invalidResponse(`${field}.field`);
      if (typeof hit.snippet !== "string" || hit.snippet.length > 480) throw invalidResponse(`${field}.snippet`);
      const cardTitle = hit.cardTitle === undefined || hit.cardTitle === null
        ? undefined
        : boundedString(hit.cardTitle, `${field}.cardTitle`, 320);
      return {
        messageId: boundedString(hit.messageId, `${field}.messageId`, 128),
        conversationId: boundedString(hit.conversationId, `${field}.conversationId`, 128),
        seq: boundedInteger(hit.seq, `${field}.seq`, 1),
        senderUserId: boundedString(hit.senderUserId, `${field}.senderUserId`, 128),
        createdAt: parseTimestamp(hit.createdAt, `${field}.createdAt`),
        field: hit.field as TeamChatSearchField,
        snippet: hit.snippet,
        ...(cardTitle === undefined ? {} : { cardTitle })
      };
    }),
    ...(nextCursor === undefined ? {} : { nextCursor })
  };
}
