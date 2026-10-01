import { describe, expect, it } from "vitest";
import {
  TEAM_CHAT_DEFAULT_POLICY,
  teamChatCanCreateChannel,
  teamChatCanManageChannel,
  teamChatCanPost,
  teamChatRetainedMentions
} from "./team-chat-governance.js";
import type { TeamChatDirectory, TeamChatMember } from "./team-chat.js";

const directory = (role: TeamChatMember["role"], policy = TEAM_CHAT_DEFAULT_POLICY): TeamChatDirectory => ({
  teamId: "t1",
  selfUserId: "me",
  members: [{ userId: "me", displayName: "我", role }, { userId: "u2", displayName: "李雷", role: "member" }],
  conversations: [],
  policy
});

describe("team chat governance", () => {
  it("lets admins create channels when the policy restricts members", () => {
    const restricted = { ...TEAM_CHAT_DEFAULT_POLICY, channelCreation: "admins" as const, revision: 2 };
    expect(teamChatCanCreateChannel(directory("member"))).toBe(true);
    expect(teamChatCanCreateChannel(directory("member", restricted))).toBe(false);
    expect(teamChatCanCreateChannel(directory("admin", restricted))).toBe(true);
  });

  it("makes only viewers read-only, and only when the policy says so", () => {
    const readOnly = { ...TEAM_CHAT_DEFAULT_POLICY, viewersCanPost: false, revision: 1 };
    expect(teamChatCanPost(directory("viewer"))).toBe(true);
    expect(teamChatCanPost(directory("viewer", readOnly))).toBe(false);
    expect(teamChatCanPost(directory("member", readOnly))).toBe(true);
  });

  it("lets the channel owner or a team owner/admin manage channels, never direct messages", () => {
    expect(teamChatCanManageChannel(directory("member"), { kind: "channel", ownerUserId: "me" })).toBe(true);
    expect(teamChatCanManageChannel(directory("member"), { kind: "channel", ownerUserId: "u2" })).toBe(false);
    expect(teamChatCanManageChannel(directory("owner"), { kind: "channel", ownerUserId: "u2" })).toBe(true);
    expect(teamChatCanManageChannel(directory("owner"), { kind: "dm" })).toBe(false);
  });

  it("keeps picked mentions only while their @name stays in the text", () => {
    const picks = [{ userId: "u2", displayName: "李雷" }, { userId: "u3", displayName: "韩梅梅" }, { userId: "me", displayName: "我" }];
    expect(teamChatRetainedMentions("@李雷 看下这个 @我", picks, "me")).toEqual(["u2"]);
    expect(teamChatRetainedMentions("@李雷@韩梅梅 @李雷", picks, "me")).toEqual(["u2", "u3"]);
    expect(teamChatRetainedMentions("没有提及", picks, "me")).toEqual([]);
  });
});
