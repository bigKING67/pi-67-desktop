import { describe, expect, it } from "vitest";
import { COMMAND_CONTEXT_SCOPE_REQUIREMENTS } from "./protocol-context.js";
import { CommandPayloadSchemas } from "./command-payload-schemas.js";
import { CommandResultSchemas, EventPayloadSchemas } from "./schemas.js";
import { EVENT_CONTEXT_REQUIREMENTS } from "./event-context.js";
import { Value } from "./typebox-schema.js";

const conversation = {
  id: "11111111-1111-4111-8111-111111111111", kind: "dm", visibility: "private", joined: true, memberCount: 2,
  memberUserIds: ["a", "b"], lastSeq: 2, lastReadSeq: 1, unreadCount: 1, mentionCount: 0, createdAt: 1
};
const message = {
  id: "m1", conversationId: "c1", seq: 1, senderUserId: "u1", body: "😀".repeat(4_000),
  clientKey: "client-key-1", createdAt: 1
};

describe("Team Chat protocol schemas", () => {
  it("binds every command and event to the app scope", () => {
    for (const type of ["teamChat.connection.get", "teamChat.directory.get", "teamChat.messages.list", "teamChat.message.send",
      "teamChat.read.mark", "teamChat.channel.create", "teamChat.channel.join", "teamChat.channel.members", "teamChat.channel.manage", "teamChat.dm.open"] as const) {
      expect(COMMAND_CONTEXT_SCOPE_REQUIREMENTS[type]).toBe("app");
    }
    expect(EVENT_CONTEXT_REQUIREMENTS["teamChat.pushed"].requiredScope).toBe("app");
    expect(EVENT_CONTEXT_REQUIREMENTS["teamChat.connectionChanged"].requiredScope).toBe("app");
  });

  it("admits four thousand astral characters (graphemes) but not unbounded or loose payloads", () => {
    const send = CommandPayloadSchemas["teamChat.message.send"];
    expect(Value.Check(send, { conversationId: "c1", clientKey: "client-key-1", body: message.body })).toBe(true);
    expect(Value.Check(send, { conversationId: "c1", clientKey: "client-key-1", body: `${message.body}a` })).toBe(false);
    expect(Value.Check(send, { conversationId: "c1", clientKey: "short", body: "hi" })).toBe(false);
    expect(Value.Check(send, { conversationId: "c/1", clientKey: "client-key-1", body: "hi" })).toBe(false);
    expect(Value.Check(send, { conversationId: "c1", clientKey: "client-key-1", body: "hi", extra: true })).toBe(false);
    const list = CommandPayloadSchemas["teamChat.messages.list"];
    expect(Value.Check(list, { conversationId: "c1", after: 0, limit: 100 })).toBe(true);
    expect(Value.Check(list, { conversationId: "c1", before: 0 })).toBe(false);
    expect(Value.Check(list, { conversationId: "c1", limit: 101 })).toBe(false);
    const create = CommandPayloadSchemas["teamChat.channel.create"];
    expect(Value.Check(create, { name: "研究", visibility: "public", memberUserIds: [] })).toBe(true);
    expect(Value.Check(create, { name: "研究", visibility: "secret", memberUserIds: [] })).toBe(false);
  });

  it("validates results and push events strictly", () => {
    expect(Value.Check(CommandResultSchemas["teamChat.dm.open"], conversation)).toBe(true);
    expect(Value.Check(CommandResultSchemas["teamChat.dm.open"], { ...conversation, unreadCount: 101 })).toBe(false);
    expect(Value.Check(CommandResultSchemas["teamChat.message.send"], message)).toBe(true);
    expect(Value.Check(CommandResultSchemas["teamChat.message.send"], { ...message, seq: 0 })).toBe(false);
    expect(Value.Check(CommandResultSchemas["teamChat.directory.get"], {
      teamId: "t", selfUserId: "u1", members: [{ userId: "u1", displayName: "Me", role: "viewer" }], conversations: [conversation],
      policy: { channelCreation: "members", viewersCanPost: true, agentCreation: "members", revision: 0 }, agents: []
    })).toBe(true);
    const pushed = EventPayloadSchemas["teamChat.pushed"];
    expect(Value.Check(pushed, { type: "message.created", message })).toBe(true);
    expect(Value.Check(pushed, { type: "read.changed", conversationId: "c1", lastReadSeq: 3 })).toBe(true);
    expect(Value.Check(pushed, { type: "policy.changed" })).toBe(true);
    expect(Value.Check(pushed, { type: "typing", conversationId: "c1" })).toBe(false);
    const state = EventPayloadSchemas["teamChat.connectionChanged"];
    expect(Value.Check(state, { status: "live", generation: 1 })).toBe(true);
    expect(Value.Check(state, { status: "live", generation: 0 })).toBe(false);
    expect(Value.Check(state, { status: "unavailable", reason: "not-member" })).toBe(true);
    expect(Value.Check(state, { status: "unavailable", reason: "other" })).toBe(false);
  });

  it("bounds governance actions, mentions and policy", () => {
    const manage = CommandPayloadSchemas["teamChat.channel.manage"];
    expect(Value.Check(manage, { conversationId: "c1", action: { type: "rename", name: "研究" } })).toBe(true);
    expect(Value.Check(manage, { conversationId: "c1", action: { type: "archive" } })).toBe(true);
    expect(Value.Check(manage, { conversationId: "c1", action: { type: "addMembers", userIds: [] } })).toBe(false);
    expect(Value.Check(manage, { conversationId: "c1", action: { type: "delete" } })).toBe(false);
    const send = CommandPayloadSchemas["teamChat.message.send"];
    const base = { conversationId: "c1", clientKey: "client-key-1", body: "@李雷" };
    expect(Value.Check(send, { ...base, mentionUserIds: ["u2"] })).toBe(true);
    expect(Value.Check(send, { ...base, mentionUserIds: Array.from({ length: 51 }, (_, index) => `u${index}`) })).toBe(false);
    expect(Value.Check(CommandResultSchemas["teamChat.message.send"], { ...message, mentionUserIds: ["u2"] })).toBe(true);
    expect(Value.Check(CommandResultSchemas["teamChat.channel.members"], { ownerUserId: "u1", members: [{ userId: "u1", joinedAt: 1 }] })).toBe(true);
    const directory = CommandResultSchemas["teamChat.directory.get"];
    const policy = (value: object) => ({ teamId: "t", selfUserId: "u1", members: [], conversations: [], policy: value, agents: [] });
    expect(Value.Check(directory, policy({ channelCreation: "admins", viewersCanPost: false, retentionDays: 90, agentCreation: "admins", revision: 3 }))).toBe(true);
    expect(Value.Check(directory, policy({ channelCreation: "admins", viewersCanPost: false, retentionDays: 30, agentCreation: "admins", revision: 3 }))).toBe(false);
  });

  it("bounds Agent commands, invocation states and the host state", () => {
    expect(COMMAND_CONTEXT_SCOPE_REQUIREMENTS["teamChat.agent.host.bind"]).toBe("app");
    expect(EVENT_CONTEXT_REQUIREMENTS["teamChat.agentHostChanged"].requiredScope).toBe("app");
    const create = CommandPayloadSchemas["teamChat.agent.create"];
    expect(Value.Check(create, { name: "研究助手", description: "" })).toBe(true);
    expect(Value.Check(create, { name: "名".repeat(41), description: "" })).toBe(false);
    const binding = { agentUserId: "a1", workspaceId: "w1", projectId: "p1", model: { provider: "anthropic", id: "claude" }, enabled: true };
    expect(Value.Check(CommandPayloadSchemas["teamChat.agent.host.bind"], { binding })).toBe(true);
    expect(Value.Check(CommandPayloadSchemas["teamChat.agent.host.bind"], { binding: { ...binding, model: { provider: "" , id: "x" } } })).toBe(false);
    const asked = { ...message, agentInvocations: [{ id: "i1", agentUserId: "a1", status: "rejected", reason: "daily_limit" }] };
    expect(Value.Check(CommandResultSchemas["teamChat.message.send"], asked)).toBe(true);
    expect(Value.Check(CommandResultSchemas["teamChat.message.send"], { ...asked, agentInvocations: [{ id: "i1", agentUserId: "a1", status: "thinking" }] })).toBe(false);
    const pushed = EventPayloadSchemas["teamChat.pushed"];
    expect(Value.Check(pushed, { type: "agents.changed" })).toBe(true);
    expect(Value.Check(pushed, { type: "agent_invocation.changed", conversationId: "c1", messageId: "m1",
      invocation: { id: "i1", agentUserId: "a1", status: "running" } })).toBe(true);
    expect(Value.Check(pushed, { type: "agent.invoked", invocationId: "i1", agentUserId: "a1", conversationId: "c1" })).toBe(false);
    expect(Value.Check(EventPayloadSchemas["teamChat.agentHostChanged"], {
      bindings: [binding], activity: [{ agentUserId: "a1", invocationId: "i1", state: "failed", reason: "model_unavailable", at: 1 }]
    })).toBe(true);
  });
});
