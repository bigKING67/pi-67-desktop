import {
  NATIVE_NOTIFICATION_TEXT_LIMITS,
  teamChatCodePointLength,
  teamChatCodePointPrefix,
  type TeamChatActivityItem,
  type TeamChatDirectory
} from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import { conversationTitle, memberById } from "./team-chat-model.js";

/** `#channel`, or "与 X 的私信" for a direct message. */
export function activityWhere(directory: TeamChatDirectory | undefined, conversationId: string): string {
  const copy = messages.teamChat;
  const conversation = directory?.conversations.find((item) => item.id === conversationId);
  if (!conversation) return copy.unknownConversation;
  const title = conversationTitle(directory, conversation, copy.unknownTeammate);
  return conversation.kind === "channel" ? `#${title}` : copy.activityDirectWith(title);
}

/** Who acted, with Agents named as such. */
function activityActor(directory: TeamChatDirectory | undefined, userId: string): string {
  const copy = messages.teamChat;
  const participant = memberById(directory, userId);
  if (!participant) return copy.unknownTeammate;
  return participant.agent ? copy.activityAgentName(participant.displayName) : participant.displayName;
}

/** One line saying who did what, without content. */
export function activityTitle(item: TeamChatActivityItem, directory: TeamChatDirectory | undefined): string {
  const titles = messages.teamChat.activityTitles;
  const actor = activityActor(directory, item.actorUserId);
  return item.kind === "mention" ? titles.mention(actor, activityWhere(directory, item.conversationId)) : titles[item.kind](actor);
}

/** What an item is about: the message preview or card title, or why an Agent did not reply. */
export function activityDetail(item: TeamChatActivityItem): string | undefined {
  const copy = messages.teamChat;
  if (item.kind === "agent_failed") {
    return item.reason === "expired" ? copy.activityExpired
      : item.reason ? copy.invocationReasons[item.reason as keyof typeof copy.invocationReasons] ?? undefined : undefined;
  }
  return item.cardTitle ?? item.preview;
}

/**
 * System notification wording (ADR 0006): who and where by default; the message
 * preview or card title only when the user turned previews on. Several items in one
 * conversation merge into one notification.
 */
export function activityNotificationText(
  items: readonly TeamChatActivityItem[],
  directory: TeamChatDirectory | undefined,
  preview: boolean
): { title: string; body: string } {
  const copy = messages.teamChat;
  const latest = items.at(-1)!;
  const where = activityWhere(directory, latest.conversationId);
  const detail = latest.kind === "agent_failed" || preview ? activityDetail(latest) : undefined;
  const text = items.length === 1
    ? { title: activityTitle(latest, directory), body: latest.kind === "mention" || latest.kind === "dm" ? detail ?? "" : join(where, detail) }
    : { title: copy.activityMerged(items.length, where), body: activityTitle(latest, directory) };
  return {
    title: bounded(text.title, NATIVE_NOTIFICATION_TEXT_LIMITS.title) || copy.activity,
    body: bounded(text.body, NATIVE_NOTIFICATION_TEXT_LIMITS.body)
  };
}

function join(where: string, detail: string | undefined): string {
  return detail ? `${where} · ${detail}` : where;
}

/** Notification text is single-line and within the bridge bounds. */
function bounded(text: string, limit: number): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return teamChatCodePointLength(line) <= limit ? line : `${teamChatCodePointPrefix(line, limit - 1)}…`;
}
