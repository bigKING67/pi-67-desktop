import {
  TEAM_CHAT_ACTIVITY_KEY_PATTERN,
  TEAM_CHAT_ACTIVITY_LIMIT,
  type TeamChatActivityItem,
  type TeamChatActivityKind
} from "@pi67/domain";
import {
  asRecord,
  boundedInteger,
  boundedString,
  invalidResponse,
  parseTimestamp
} from "../context/enterprise-context-gateway-validation.js";

const KINDS: ReadonlySet<string> = new Set<TeamChatActivityKind>([
  "mention", "dm", "agent_reply", "agent_failed", "card_assigned", "card_review", "card_changes_requested"
]);
const KEY = new RegExp(TEAM_CHAT_ACTIVITY_KEY_PATTERN, "u");
const REASON = /^[a-z_]{1,40}$/u;

/** The service's activity list (ADR 0006); previews stay within the conversation-list bound. */
export function parseActivity(value: unknown): TeamChatActivityItem[] {
  const record = asRecord(value);
  if (!Array.isArray(record.items) || record.items.length > TEAM_CHAT_ACTIVITY_LIMIT) throw invalidResponse("activity.items");
  return record.items.map((item, index) => parseActivityItem(item, `activity.items.${index}`));
}

function parseActivityItem(value: unknown, field: string): TeamChatActivityItem {
  const record = asRecord(value);
  const key = boundedString(record.key, `${field}.key`, 38);
  if (!KEY.test(key)) throw invalidResponse(`${field}.key`);
  if (typeof record.kind !== "string" || !KINDS.has(record.kind)) throw invalidResponse(`${field}.kind`);
  if (typeof record.unread !== "boolean") throw invalidResponse(`${field}.unread`);
  const optional = <T>(name: string, parse: (item: unknown) => T) => {
    const item = record[name];
    return item === null || item === undefined ? {} : { [name]: parse(item) };
  };
  return {
    key,
    kind: record.kind as TeamChatActivityKind,
    conversationId: boundedString(record.conversationId, `${field}.conversationId`, 128),
    actorUserId: boundedString(record.actorUserId, `${field}.actorUserId`, 128),
    ...optional("messageSeq", (item) => boundedInteger(item, `${field}.messageSeq`, 1)),
    ...optional("preview", (item) => {
      if (typeof item !== "string" || item.length > 280) throw invalidResponse(`${field}.preview`);
      return item;
    }),
    ...optional("cardId", (item) => boundedString(item, `${field}.cardId`, 128)),
    ...optional("cardTitle", (item) => boundedString(item, `${field}.cardTitle`, 320)),
    ...optional("reason", (item) => {
      if (typeof item !== "string" || !REASON.test(item)) throw invalidResponse(`${field}.reason`);
      return item;
    }),
    createdAt: parseTimestamp(record.createdAt, `${field}.createdAt`),
    ...(record.addedByEdit === true ? { addedByEdit: true } : {}),
    unread: record.unread,
    ...optional("doneAt", (item) => parseTimestamp(item, `${field}.doneAt`))
  };
}
