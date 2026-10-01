import { teamChatCodePointLength, type TeamChatMessage, type TeamChatWorkCard } from "@pi67/domain";
import type { TeamChatPendingMessage } from "./team-chat-model.js";

/** Consecutive messages from one sender within this window share a header. */
const GROUP_WINDOW_MS = 5 * 60 * 1_000;

/** One message per entry; the first message of each day carries its day label. */
export interface TeamChatTimelineEntry {
  key: string;
  senderUserId: string;
  body: string;
  createdAt: number;
  /** Set on the first message of a calendar day. */
  dayLabel?: string;
  /** First message of a sender group shows the name and time. */
  showHeader: boolean;
  pending?: Pick<TeamChatPendingMessage, "clientKey" | "status" | "error">;
  workCard?: TeamChatWorkCard;
}

/** Orders confirmed then pending messages into day-labelled sender groups. */
export function teamChatTimeline(
  messages: readonly TeamChatMessage[],
  pending: readonly TeamChatPendingMessage[],
  selfUserId: string,
  now: number
): TeamChatTimelineEntry[] {
  const entries: TeamChatTimelineEntry[] = [];
  let lastDay: string | undefined;
  let lastSender: string | undefined;
  let lastAt = 0;
  const push = (item: Omit<TeamChatTimelineEntry, "showHeader" | "dayLabel">) => {
    const day = dayKey(item.createdAt);
    const newDay = day !== lastDay;
    if (newDay) {
      lastDay = day;
      lastSender = undefined;
    }
    const showHeader = item.senderUserId !== lastSender || item.createdAt - lastAt > GROUP_WINDOW_MS;
    entries.push({ ...item, showHeader, ...(newDay ? { dayLabel: dayLabel(item.createdAt, now) } : {}) });
    lastSender = item.senderUserId;
    lastAt = item.createdAt;
  };
  for (const message of messages) {
    push({ key: message.id, senderUserId: message.senderUserId, body: message.body, createdAt: message.createdAt,
      ...(message.workCard === undefined ? {} : { workCard: message.workCard }) });
  }
  for (const item of pending) {
    push({
      key: `pending-${item.clientKey}`,
      senderUserId: selfUserId,
      body: item.body,
      createdAt: item.createdAt,
      pending: { clientKey: item.clientKey, status: item.status, ...(item.error === undefined ? {} : { error: item.error }) }
    });
  }
  return entries;
}

export function formatTeamChatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function dayLabel(timestamp: number, now: number): string {
  const day = startOfDay(timestamp);
  const today = startOfDay(now);
  if (day === today) return "今天";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.getTime()) return "昨天";
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return `${sameYear ? "" : `${date.getFullYear()}年`}${date.getMonth() + 1}月${date.getDate()}日`;
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Remaining characters shown only near the service limit. */
export function teamChatRemainingCharacters(body: string, limit: number): number | undefined {
  const remaining = limit - teamChatCodePointLength(body);
  return remaining <= 400 ? remaining : undefined;
}
