import { describe, expect, it } from "vitest";
import { teamChatAgentById, teamChatCanCreateAgent, type TeamChatAgent } from "./team-chat-agents.js";
import { TEAM_CHAT_DEFAULT_POLICY } from "./team-chat-governance.js";
import type { TeamChatDirectory, TeamChatMember } from "./team-chat.js";

const agent: TeamChatAgent = {
  userId: "a1", name: "研究助手", description: "", ownerUserId: "me", modelLabel: "", dailyLimit: 50,
  status: "active", disabledByAdmin: false, online: true, createdAt: 1
};
const directory = (role: TeamChatMember["role"], agentCreation: "members" | "admins" = "members"): TeamChatDirectory => ({
  teamId: "t", selfUserId: "me", members: [{ userId: "me", displayName: "我", role }], conversations: [],
  policy: { ...TEAM_CHAT_DEFAULT_POLICY, agentCreation }, agents: [agent]
});

describe("team chat agents", () => {
  it("never lets viewers add Agents and honours the admins-only policy", () => {
    expect(teamChatCanCreateAgent(directory("member"))).toBe(true);
    expect(teamChatCanCreateAgent(directory("viewer"))).toBe(false);
    expect(teamChatCanCreateAgent(directory("member", "admins"))).toBe(false);
    expect(teamChatCanCreateAgent(directory("admin", "admins"))).toBe(true);
  });

  it("finds Agents by principal id", () => {
    expect(teamChatAgentById(directory("member"), "a1")?.name).toBe("研究助手");
    expect(teamChatAgentById(directory("member"), "me")).toBeUndefined();
    expect(teamChatAgentById(undefined, "a1")).toBeUndefined();
  });
});
