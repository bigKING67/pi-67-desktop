import { teamChatCodePointLength, type TeamChatAgentInvocationSummary, type TeamChatMessage, type TeamChatWorkCard } from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
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
  mentionUserIds?: string[];
  agentInvocations?: TeamChatAgentInvocationSummary[];
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
      ...(message.workCard === undefined ? {} : { workCard: message.workCard }),
      ...(message.mentionUserIds === undefined ? {} : { mentionUserIds: message.mentionUserIds }),
      ...(message.agentInvocations === undefined ? {} : { agentInvocations: message.agentInvocations }) });
  }
  for (const item of pending) {
    push({
      key: `pending-${item.clientKey}`,
      senderUserId: selfUserId,
      body: item.body,
      createdAt: item.createdAt,
      ...(item.mentionUserIds === undefined ? {} : { mentionUserIds: item.mentionUserIds }),
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

export interface TeamChatMentionCandidate {
  userId: string;
  displayName: string;
  /** Agent members are labelled, and mentioning one discloses what it reads. */
  agent?: boolean;
}

/** Splits a body into text and `@name` runs for the mentioned members, longest name first. */
export function teamChatMentionSegments(
  body: string,
  mentioned: readonly TeamChatMentionCandidate[]
): Array<{ text: string; userId?: string }> {
  const names = [...mentioned].sort((left, right) => right.displayName.length - left.displayName.length);
  const segments: Array<{ text: string; userId?: string }> = [];
  let plain = "";
  for (let index = 0; index < body.length;) {
    const match = body[index] === "@" ? names.find((item) => body.startsWith(item.displayName, index + 1)) : undefined;
    if (!match) {
      plain += body[index];
      index += 1;
      continue;
    }
    if (plain) segments.push({ text: plain });
    plain = "";
    const text = `@${match.displayName}`;
    segments.push({ text, userId: match.userId });
    index += text.length;
  }
  if (plain) segments.push({ text: plain });
  return segments;
}

const MENTION_QUERY = /(^|[^A-Za-z0-9_.])@([^\s@]{0,32})$/u;

/** The `@query` being typed just before the caret, if any; emails do not count. */
export function teamChatMentionQuery(text: string, caret: number): { start: number; query: string } | undefined {
  const match = MENTION_QUERY.exec(text.slice(0, caret));
  if (!match) return undefined;
  const query = match[2] ?? "";
  return { start: caret - query.length - 1, query };
}

/** Members whose name contains the query, prefix matches first, at most eight. */
export function teamChatMentionCandidates(
  query: string,
  members: readonly TeamChatMentionCandidate[]
): TeamChatMentionCandidate[] {
  const needle = query.toLocaleLowerCase();
  const scored = members
    .map((member) => ({ member, position: member.displayName.toLocaleLowerCase().indexOf(needle) }))
    .filter((item) => item.position >= 0)
    .sort((left, right) => (left.position === 0 ? 0 : 1) - (right.position === 0 ? 0 : 1)
      || left.member.displayName.localeCompare(right.member.displayName, "zh-CN"));
  return scored.slice(0, 8).map((item) => item.member);
}

/** Status line for one Agent request on the message that made it; replies speak for themselves. */
export function teamChatInvocationText(
  invocation: Pick<TeamChatAgentInvocationSummary, "status" | "reason">,
  agentName: string,
  agentOnline: boolean
): string | undefined {
  const copy = messages.teamChat;
  const reason = invocation.reason === undefined ? copy.invocationReasons.runtime_error! : copy.invocationReasons[invocation.reason] ?? invocation.reason;
  switch (invocation.status) {
    case "queued": return agentOnline ? copy.invocationQueued(agentName) : copy.invocationWaiting(agentName);
    case "running": return copy.invocationRunning(agentName);
    case "replied": return undefined;
    case "failed": return copy.invocationFailed(agentName, reason);
    case "expired": return copy.invocationExpired(agentName);
    case "rejected": return copy.invocationRejected(agentName, reason);
  }
}
