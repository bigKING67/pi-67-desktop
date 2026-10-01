import type { TeamChatConversation, TeamChatDirectory } from "./team-chat.js";

/** Channel governance and team chat policy (ADR 0003, P2.5). New Money enforces; these mirror it for UI. */
export const TEAM_CHAT_MENTION_MAX = 50;

export type TeamChatRetentionDays = 90 | 180 | 365;

export interface TeamChatPolicy {
  channelCreation: "members" | "admins";
  viewersCanPost: boolean;
  /** Plain messages older than this are purged; absent keeps them forever. Work Cards are always kept. */
  retentionDays?: TeamChatRetentionDays;
  /** Who may add Agents (viewers never can). */
  agentCreation: "members" | "admins";
  /** 0 until an owner/admin first saves the policy. */
  revision: number;
}

export const TEAM_CHAT_DEFAULT_POLICY: TeamChatPolicy = {
  channelCreation: "members", viewersCanPost: true, agentCreation: "members", revision: 0
};

export interface TeamChatChannelRoster {
  ownerUserId: string;
  members: Array<{ userId: string; joinedAt: number }>;
}

export type TeamChatChannelAction =
  | { type: "rename"; name: string }
  | { type: "archive" }
  | { type: "unarchive" }
  | { type: "addMembers"; userIds: string[] }
  | { type: "removeMember"; userId: string }
  | { type: "transferOwner"; userId: string }
  | { type: "leave" };

function selfRole(directory: TeamChatDirectory) {
  return directory.members.find((member) => member.userId === directory.selfUserId)?.role;
}

function isTeamAdmin(directory: TeamChatDirectory): boolean {
  const role = selfRole(directory);
  return role === "owner" || role === "admin";
}

export function teamChatCanCreateChannel(directory: TeamChatDirectory): boolean {
  return directory.policy.channelCreation === "members" || isTeamAdmin(directory);
}

/** Viewers are read-only when the policy says so; everyone else may post. */
export function teamChatCanPost(directory: TeamChatDirectory): boolean {
  return directory.policy.viewersCanPost || selfRole(directory) !== "viewer";
}

/** The channel owner or a team owner/admin manages a channel. */
export function teamChatCanManageChannel(directory: TeamChatDirectory, conversation: Pick<TeamChatConversation, "kind" | "ownerUserId">): boolean {
  if (conversation.kind !== "channel") return false;
  return conversation.ownerUserId === directory.selfUserId || isTeamAdmin(directory);
}

/** Picked mentions whose `@name` the sender kept in the final text, deduplicated and capped. */
export function teamChatRetainedMentions(
  body: string,
  picks: ReadonlyArray<{ userId: string; displayName: string }>,
  selfUserId: string
): string[] {
  const kept = new Set<string>();
  for (const pick of picks) {
    if (pick.userId !== selfUserId && body.includes(`@${pick.displayName}`)) kept.add(pick.userId);
  }
  return [...kept].slice(0, TEAM_CHAT_MENTION_MAX);
}
