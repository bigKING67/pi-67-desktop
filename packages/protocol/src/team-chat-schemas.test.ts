import { describe, expect, it } from "vitest";
import { COMMAND_CONTEXT_SCOPE_REQUIREMENTS } from "./protocol-context.js";
import { CommandPayloadSchemas } from "./command-payload-schemas.js";
import { CommandResultSchemas, EventPayloadSchemas } from "./schemas.js";
import { EVENT_CONTEXT_REQUIREMENTS } from "./event-context.js";
import { Value } from "./typebox-schema.js";

const conversation = {
  id: "11111111-1111-4111-8111-111111111111", kind: "dm", visibility: "private", joined: true, memberCount: 2,
  memberUserIds: ["a", "b"], lastSeq: 2, lastReadSeq: 1, unreadCount: 1, createdAt: 1
};
const message = {
  id: "m1", conversationId: "c1", seq: 1, senderUserId: "u1", body: "😀".repeat(4_000),
  clientKey: "client-key-1", createdAt: 1
};

describe("Team Chat protocol schemas", () => {
  it("binds every command and event to the app scope", () => {
    for (const type of ["teamChat.connection.get", "teamChat.directory.get", "teamChat.messages.list", "teamChat.message.send",
      "teamChat.read.mark", "teamChat.channel.create", "teamChat.channel.join", "teamChat.dm.open"] as const) {
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
      teamId: "t", selfUserId: "u1", members: [{ userId: "u1", displayName: "Me", role: "viewer" }], conversations: [conversation]
    })).toBe(true);
    const pushed = EventPayloadSchemas["teamChat.pushed"];
    expect(Value.Check(pushed, { type: "message.created", message })).toBe(true);
    expect(Value.Check(pushed, { type: "read.changed", conversationId: "c1", lastReadSeq: 3 })).toBe(true);
    expect(Value.Check(pushed, { type: "typing", conversationId: "c1" })).toBe(false);
    const state = EventPayloadSchemas["teamChat.connectionChanged"];
    expect(Value.Check(state, { status: "live", generation: 1 })).toBe(true);
    expect(Value.Check(state, { status: "live", generation: 0 })).toBe(false);
    expect(Value.Check(state, { status: "unavailable", reason: "not-member" })).toBe(true);
    expect(Value.Check(state, { status: "unavailable", reason: "other" })).toBe(false);
  });
});
