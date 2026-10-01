import type { AgentCommand } from "@pi67/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostEventChannel } from "../host-event-channel.js";
import { isTeamChatCommand, TeamChatCommandRouter, type TeamChatCommandType } from "./team-chat-command-router.js";
import { parseConversation } from "./team-chat-gateway.js";

const endpoint = "https://newmoney.example.test";
const teamBase = `${endpoint}/v1/agent/teams/team-1`;
const credential = { endpoint, accessToken: "access", accountId: "team-1", userId: "me", expiresAt: 9e12 };
const conversation = {
  id: "c1", kind: "channel", visibility: "public", name: "研究", joined: true, memberCount: 2, memberUserIds: [],
  lastSeq: 3, lastReadSeq: 1, unreadCount: 2, lastMessageAt: "2026-10-01T00:00:00Z", lastSenderUserId: "u2",
  lastPreview: "hi", createdAt: "2026-09-30T00:00:00Z"
};
const message = {
  id: "m1", conversationId: "c1", seq: 4, senderUserId: "me", body: "你好", clientKey: "client-key-1",
  createdAt: "2026-10-01T00:00:01Z"
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function setup(routes: Record<string, (init: RequestInit) => Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const key = `${init.method} ${url.replace(teamBase, "")}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected ${key}`);
    return route(init);
  }));
  const events = { sendFor: vi.fn() };
  const router = new TeamChatCommandRouter({
    session: async () => ({ endpoint, credential }),
    events: events as unknown as HostEventChannel
  });
  const run = <T extends TeamChatCommandType>(type: T, payload: AgentCommand<T>["payload"]) =>
    router.dispatch({ type, payload } as AgentCommand<T>);
  return { router, calls, events, run };
}

describe("TeamChatCommandRouter", () => {
  it("recognizes exactly the Team Chat commands", () => {
    expect(isTeamChatCommand("teamChat.message.send")).toBe(true);
    expect(isTeamChatCommand("enterprise.team.list")).toBe(false);
  });

  it("reports signed-out connection state without credentials or network", async () => {
    const { router, run, calls } = setup({});
    await expect(run("teamChat.connection.get", {})).resolves.toEqual({ status: "signed-out" });
    expect(calls).toEqual([]);
    router.shutdown();
  });

  it("assembles the directory from teammates and conversations with the device identity", async () => {
    const { router, run, calls } = setup({
      "GET /members": () => json({ members: [{ userId: "me", email: "me@example.com", displayName: "Me", role: "owner", joinedAt: "x" }] }),
      "GET /chat/conversations": () => json({ conversations: [conversation] })
    });
    await expect(run("teamChat.directory.get", {})).resolves.toEqual({
      teamId: "team-1",
      selfUserId: "me",
      members: [{ userId: "me", displayName: "Me", role: "owner" }],
      conversations: [parseConversation(conversation)]
    });
    expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe("Bearer access");
    router.shutdown();
  });

  it("pages history, sends, marks read, and manages conversations", async () => {
    const { router, run, calls } = setup({
      "GET /chat/conversations/c1/messages?before=5&limit=20": () => json({ messages: [message], hasMore: true }),
      "POST /chat/conversations/c1/messages": () => json(message, 201),
      "PUT /chat/conversations/c1/read": () => json({ lastReadSeq: 4 }),
      "POST /chat/channels": () => json(conversation, 201),
      "POST /chat/conversations/c1/join": () => json(conversation),
      "POST /chat/direct-messages": () => json({ ...conversation, kind: "dm", visibility: "private", name: null, memberUserIds: ["me", "u2"] })
    });
    await expect(run("teamChat.messages.list", { conversationId: "c1", before: 5, limit: 20 }))
      .resolves.toMatchObject({ hasMore: true, messages: [{ seq: 4 }] });
    await expect(run("teamChat.message.send", { conversationId: "c1", clientKey: "client-key-1", body: "你好" }))
      .resolves.toMatchObject({ id: "m1", createdAt: Date.parse(message.createdAt) });
    await expect(run("teamChat.read.mark", { conversationId: "c1", lastReadSeq: 4 })).resolves.toEqual({ lastReadSeq: 4 });
    await expect(run("teamChat.channel.create", { name: "  研究 ", visibility: "public", memberUserIds: ["u2"] }))
      .resolves.toMatchObject({ name: "研究" });
    await expect(run("teamChat.channel.join", { conversationId: "c1" })).resolves.toMatchObject({ joined: true });
    await expect(run("teamChat.dm.open", { userId: "u2" })).resolves.toMatchObject({ kind: "dm", memberUserIds: ["me", "u2"] });
    const bodies = calls.filter((call) => call.init.body !== undefined).map((call) => JSON.parse(call.init.body as string));
    expect(bodies).toEqual([
      { clientKey: "client-key-1", body: "你好" },
      { lastReadSeq: 4 },
      { name: "研究", visibility: "public", memberUserIds: ["u2"] },
      { userId: "u2" }
    ]);
    router.shutdown();
  });

  it("rejects invalid input before any request", async () => {
    const { router, run, calls } = setup({});
    for (const attempt of [
      run("teamChat.message.send", { conversationId: "c1", clientKey: "client-key-1", body: "  " }),
      run("teamChat.message.send", { conversationId: "c1", clientKey: "client-key-1", body: "😀".repeat(4_001) }),
      run("teamChat.message.send", { conversationId: "c1", clientKey: "client-key-1", body: "a\0b" }),
      run("teamChat.channel.create", { name: "a\u0007b", visibility: "public", memberUserIds: [] }),
      run("teamChat.channel.create", { name: "名".repeat(81), visibility: "public", memberUserIds: [] }),
      run("teamChat.messages.list", { conversationId: "c1", before: 3, after: 1 }),
      run("teamChat.dm.open", { userId: "me" })
    ]) {
      await expect(attempt).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    }
    expect(calls).toEqual([]);
    router.shutdown();
  });

  it("surfaces specific service errors and keeps the generic mapping otherwise", async () => {
    const { router, run } = setup({
      "POST /chat/channels": () => json({ error: { code: "chat_channel_name_taken", message: "taken" } }, 409),
      "POST /chat/conversations/c1/join": () => json({ error: { code: "something_else", message: "no" } }, 403),
      "POST /chat/direct-messages": () => new Response("x".repeat(20_000), { status: 400 })
    });
    await expect(run("teamChat.channel.create", { name: "研究", visibility: "public", memberUserIds: [] }))
      .rejects.toMatchObject({ code: "INVALID_PAYLOAD", details: { serviceError: "chat_channel_name_taken", status: 409 } });
    await expect(run("teamChat.channel.join", { conversationId: "c1" }))
      .rejects.toMatchObject({ code: "RUNTIME_NOT_READY", details: undefined });
    await expect(run("teamChat.dm.open", { userId: "u2" })).rejects.toMatchObject({ code: "RUNTIME_NOT_READY" });
    router.shutdown();
  });

  it("rejects malformed service responses", async () => {
    const { router, run } = setup({
      "GET /chat/conversations/c1/messages": () => json({ messages: [{ ...message, seq: 0 }], hasMore: false }),
      "POST /chat/conversations/c1/join": () => json({ ...conversation, name: null }),
      "POST /chat/direct-messages": () => json({ ...conversation, kind: "group" })
    });
    await expect(run("teamChat.messages.list", { conversationId: "c1" })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(run("teamChat.channel.join", { conversationId: "c1" })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(run("teamChat.dm.open", { userId: "u2" })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    router.shutdown();
  });
});
