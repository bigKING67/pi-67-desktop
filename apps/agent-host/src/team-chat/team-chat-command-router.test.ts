import type { TeamChatChannelAction } from "@pi67/domain";
import type { AgentCommand } from "@pi67/protocol";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostEventChannel } from "../host-event-channel.js";
import { isTeamChatCommand, TeamChatCommandRouter, type TeamChatCommandType } from "./team-chat-command-router.js";
import { parseConversation, parseMessage } from "./team-chat-gateway.js";

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

function setup(routes: Record<string, (init: RequestInit) => Response>, live?: { frames: string[] }) {
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
    events: events as unknown as HostEventChannel,
    storageRoot: mkdtempSync(join(tmpdir(), "pi67-chat-router-")),
    agentTurns: { ready: () => true, run: async () => "unused" },
    ...(live === undefined ? {} : {
      credentials: { snapshot: () => ({ credential }), signal: new AbortController().signal } as never,
      realtime: { openSocket: () => {
        const socket = { onmessage: null as ((event: { data: unknown }) => void) | null, onclose: null, onerror: null, close: () => undefined };
        setTimeout(() => { for (const data of live.frames) socket.onmessage?.({ data }); }, 0);
        return socket;
      } }
    })
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
      "GET /chat/conversations": () => json({ conversations: [conversation] }),
      "GET /chat/policy": () => json({ channelCreation: "admins", viewersCanPost: false, retentionDays: null, revision: 2 })
    });
    await expect(run("teamChat.directory.get", {})).resolves.toEqual({
      teamId: "team-1",
      selfUserId: "me",
      members: [{ userId: "me", displayName: "Me", role: "owner" }],
      conversations: [parseConversation(conversation)],
      policy: { channelCreation: "admins", viewersCanPost: false, agentCreation: "members", revision: 2 },
      agents: [],
      bots: []
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

  it("creates Work Cards and applies lifecycle actions with strict parsing", async () => {
    const card = {
      id: "w1", conversationId: "c1", createdBy: "me", assigneeUserId: "u2", claimedBy: null, title: "修复登录",
      goal: "回跳", acceptance: "", summary: "", refs: [{ kind: "branch", label: "fix/login" }], status: "todo", revision: 1,
      createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z"
    };
    const { router, run, calls } = setup({
      "POST /chat/conversations/c1/work-cards": () => json({ ...message, body: "修复登录", workCard: card }, 201),
      "POST /chat/work-cards/w1/actions": () => json({ ...card, status: "in_progress", claimedBy: "u2", revision: 2 }),
      "POST /chat/work-cards/bad/actions": () => json({ ...card, refs: [{ kind: "link", label: "x", url: "http://insecure" }] })
    });
    const input = { conversationId: "c1", clientKey: "card-key-01", title: " 修复登录 ", goal: "回跳", acceptance: "", summary: "",
      refs: [{ kind: "branch" as const, label: "fix/login" }], assigneeUserId: "u2" };
    await expect(run("teamChat.workCard.create", input)).resolves.toMatchObject({
      workCard: { id: "w1", status: "todo", assigneeUserId: "u2", refs: [{ kind: "branch", label: "fix/login" }] }
    });
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({ title: "修复登录", clientKey: "card-key-01" });
    await expect(run("teamChat.workCard.act", { cardId: "w1", action: "claim", expectedRevision: 1 }))
      .resolves.toMatchObject({ status: "in_progress", claimedBy: "u2", revision: 2 });
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ action: "claim", expectedRevision: 1 });
    await expect(run("teamChat.workCard.act", { cardId: "bad", action: "claim", expectedRevision: 1 }))
      .rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(run("teamChat.workCard.create", { ...input, title: "  " })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(run("teamChat.workCard.create", { ...input, summary: "字".repeat(8_001) })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(calls).toHaveLength(3);
    router.shutdown();
  });

  it("reads channel rosters and maps governance actions onto the service routes", async () => {
    const ok = () => new Response(null, { status: 204 });
    const { router, run, calls } = setup({
      "GET /chat/conversations/c1/members": () => json({ ownerUserId: "me", members: [{ userId: "me", joinedAt: "2026-10-01T00:00:00Z" }] }),
      "PATCH /chat/conversations/c1": ok,
      "POST /chat/conversations/c1/archive": ok,
      "POST /chat/conversations/c1/unarchive": ok,
      "POST /chat/conversations/c1/members": () => json(conversation),
      "DELETE /chat/conversations/c1/members/u2": ok,
      "PUT /chat/conversations/c1/owner": ok,
      "POST /chat/conversations/c1/leave": ok,
      "POST /chat/conversations/c1/messages": () => json({ ...message, mentionUserIds: ["u2"] }, 201),
      "GET /chat/policy": () => json({ error: { code: "not_found" } }, 404),
      "GET /members": () => json({ members: [] }),
      "GET /chat/conversations": () => json({ conversations: [{ ...conversation, mentionCount: 3, ownerUserId: "u2" }] })
    });
    await expect(run("teamChat.channel.members", { conversationId: "c1" }))
      .resolves.toEqual({ ownerUserId: "me", members: [{ userId: "me", joinedAt: Date.parse("2026-10-01T00:00:00Z") }] });
    const actions: TeamChatChannelAction[] = [
      { type: "rename", name: " 新名字 " }, { type: "archive" }, { type: "unarchive" }, { type: "addMembers", userIds: ["u2"] },
      { type: "removeMember", userId: "u2" }, { type: "transferOwner", userId: "u2" }, { type: "leave" }
    ];
    for (const action of actions) {
      await expect(run("teamChat.channel.manage", { conversationId: "c1", action })).resolves.toEqual({});
    }
    await expect(run("teamChat.channel.manage", { conversationId: "c1", action: { type: "rename", name: "  " } }))
      .rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(run("teamChat.message.send", { conversationId: "c1", clientKey: "client-key-2", body: "@李雷", mentionUserIds: ["u2"] }))
      .resolves.toMatchObject({ mentionUserIds: ["u2"] });
    const directory = await run("teamChat.directory.get", {});
    expect(directory.policy).toEqual({ channelCreation: "members", viewersCanPost: true, agentCreation: "members", revision: 0 });
    expect(directory.conversations[0]).toMatchObject({ mentionCount: 3, ownerUserId: "u2" });
    const bodies = calls.filter((call) => call.init.body !== undefined).map((call) => JSON.parse(call.init.body as string));
    expect(bodies).toEqual([
      { name: "新名字" }, { userIds: ["u2"] }, { userId: "u2" },
      { clientKey: "client-key-2", body: "@李雷", mentionUserIds: ["u2"] }
    ]);
    router.shutdown();
  });

  it("manages Agents, binds one to this Desktop and names it in the realtime ticket", async () => {
    const agent = { userId: "agent-1", name: "研究助手", description: "", ownerUserId: "me", modelLabel: "", dailyLimit: 50,
      status: "active", disabledByAdmin: false, online: false, createdAt: "2026-10-01T00:00:00Z" };
    const ok = () => new Response(null, { status: 204 });
    const { router, run, calls, events } = setup({
      "GET /chat/agents": () => json({ agents: [agent, { ...agent, userId: "agent-2", ownerUserId: "u2" }] }),
      "POST /chat/agents": () => json(agent, 201),
      "PATCH /chat/agents/agent-1": () => json(agent),
      "POST /chat/agents/agent-1/disable": () => json({ ...agent, status: "disabled" }),
      "DELETE /chat/agents/agent-1": ok,
      "GET /members": () => json({ members: [] }),
      "GET /chat/conversations": () => json({ conversations: [] }),
      "GET /chat/policy": () => json({ channelCreation: "members", viewersCanPost: true, retentionDays: null, agentCreation: "admins", revision: 1 })
    });
    await expect(run("teamChat.agent.create", { name: " 研究助手 ", description: "宏观" })).resolves.toMatchObject({ userId: "agent-1", createdAt: Date.parse(agent.createdAt) });
    await expect(run("teamChat.agent.create", { name: "  ", description: "" })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    const directory = await run("teamChat.directory.get", {});
    expect(directory.agents.map((item) => item.userId)).toEqual(["agent-1", "agent-2"]);
    expect(directory.policy.agentCreation).toBe("admins");
    const binding = { agentUserId: "agent-1", workspaceId: "w1", projectId: "p1", model: { provider: "anthropic", id: "claude" }, enabled: true };
    await expect(run("teamChat.agent.host.bind", { binding: { ...binding, agentUserId: "agent-2" } })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(run("teamChat.agent.host.bind", { binding })).resolves.toEqual({ bindings: [binding], activity: [] });
    expect(events.sendFor).toHaveBeenCalledWith({ type: "teamChat.agentHostChanged", payload: { bindings: [binding], activity: [] } }, expect.anything());
    await expect(run("teamChat.agent.host.get", {})).resolves.toEqual({ bindings: [binding], activity: [] });
    await expect(run("teamChat.agent.setDisabled", { agentUserId: "agent-1", disabled: true })).resolves.toMatchObject({ status: "disabled" });
    await expect(run("teamChat.agent.remove", { agentUserId: "agent-1" })).resolves.toEqual({});
    await expect(run("teamChat.agent.host.get", {})).resolves.toEqual({ bindings: [], activity: [] });
    const bodies = calls.filter((call) => call.init.body !== undefined).map((call) => JSON.parse(call.init.body as string));
    expect(bodies).toEqual([{ name: "研究助手", description: "宏观" }, { modelLabel: "anthropic · claude" }]);
    router.shutdown();
  });

  it("hosts bound Agents on the realtime ticket and hands agent.invoked to the runner, not the renderer", async () => {
    const agent = { userId: "agent-1", name: "研究助手", description: "", ownerUserId: "me", modelLabel: "", dailyLimit: 50,
      status: "active", disabledByAdmin: false, online: false, createdAt: "2026-10-01T00:00:00Z" };
    const claimed = vi.fn(() => json({ error: { code: "chat_agent_invocation_unavailable" } }, 409));
    const { router, run, calls, events } = setup({
      "GET /chat/agents": () => json({ agents: [agent] }),
      "PATCH /chat/agents/agent-1": () => json(agent),
      "POST /chat/realtime-tickets": () => json({ ticket: "t", expiresAt: "2026-10-01T00:01:00Z" }, 201),
      "GET /chat/agent-invocations": () => json({ invocations: [] }),
      "POST /chat/agent-invocations/i1/claim": claimed
    }, { frames: [JSON.stringify({ type: "ready" }), JSON.stringify({ type: "agent.invoked", invocationId: "i1", agentUserId: "agent-1", conversationId: "c1" })] });
    await run("teamChat.agent.host.bind", { binding: { agentUserId: "agent-1", workspaceId: "w1", projectId: "p1",
      model: { provider: "anthropic", id: "claude" }, enabled: true } });
    await vi.waitFor(() => expect(claimed).toHaveBeenCalled());
    const ticket = calls.find((call) => call.url.endsWith("/chat/realtime-tickets") && call.init.body !== undefined);
    expect(JSON.parse(ticket!.init.body as string)).toEqual({ hostAgentIds: ["agent-1"] });
    expect(events.sendFor.mock.calls.some(([event]) => (event as { type: string }).type === "teamChat.pushed")).toBe(false);
    router.shutdown();
  });

  it("manages a channel's webhooks and returns the secret URL only from create and rotate", async () => {
    const webhook = { botUserId: "bot-1", conversationId: "c1", channelName: "构建通知", name: "CI", createdBy: "me",
      createdAt: "2026-10-02T00:00:00Z", rotatedAt: null, lastUsedAt: null };
    const secret = { webhook, url: "https://newmoney.example.test/v1/hooks/chat/bot-1/s3cret" };
    const { router, run, calls } = setup({
      "GET /chat/conversations/c1/webhooks": () => json({ webhooks: [webhook] }),
      "POST /chat/conversations/c1/webhooks": () => json(secret, 201),
      "POST /chat/conversations/c1/webhooks/bot-1/rotate": () => json(secret),
      "DELETE /chat/conversations/c1/webhooks/bot-1": () => new Response(null, { status: 204 }),
      "GET /chat/bots": () => json({ bots: [{ userId: "bot-1", name: "CI", conversationId: "c1" }] }),
      "GET /members": () => json({ members: [] }),
      "GET /chat/conversations": () => json({ conversations: [] }),
      "GET /chat/policy": () => json({ channelCreation: "members", viewersCanPost: true, retentionDays: null, revision: 0 }),
      "GET /chat/agents": () => json({ agents: [] })
    });
    await expect(run("teamChat.webhook.list", { conversationId: "c1" })).resolves.toMatchObject({ webhooks: [{ name: "CI" }] });
    await expect(run("teamChat.webhook.create", { conversationId: "c1", name: " CI " })).resolves.toMatchObject({ url: secret.url });
    await expect(run("teamChat.webhook.create", { conversationId: "c1", name: " " })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    await expect(run("teamChat.webhook.rotate", { conversationId: "c1", botUserId: "bot-1" })).resolves.toMatchObject({ url: secret.url });
    await expect(run("teamChat.webhook.remove", { conversationId: "c1", botUserId: "bot-1" })).resolves.toEqual({});
    expect((await run("teamChat.directory.get", {})).bots).toEqual([{ userId: "bot-1", name: "CI", conversationId: "c1" }]);
    const bodies = calls.filter((call) => call.init.body !== undefined).map((call) => JSON.parse(call.init.body as string));
    expect(bodies).toEqual([{ name: "CI" }]);
    router.shutdown();
  });

  it("reads activity, records handled and read state, and mutes conversations", async () => {
    const key = "m:0b5c2f4e-8a1d-4c3e-9f6a-2d7e1b0c9a8f";
    const item = { key, kind: "mention", conversationId: "c1", actorUserId: "u2", messageSeq: 3, preview: "看一下",
      cardId: null, createdAt: "2026-10-02T00:00:00Z", unread: true };
    const { router, run, calls } = setup({
      "GET /chat/activity": () => json({ items: [item] }),
      "POST /chat/activity/done": () => new Response(null, { status: 204 }),
      "POST /chat/activity/read": () => json({ readAt: "2026-10-02T00:00:01Z" }),
      "PUT /chat/conversations/c1/mute": (init) => json(JSON.parse(init.body as string))
    });
    await expect(run("teamChat.activity.list", {})).resolves.toEqual({ items: [{
      key, kind: "mention", conversationId: "c1", actorUserId: "u2", messageSeq: 3, preview: "看一下",
      createdAt: Date.parse("2026-10-02T00:00:00Z"), unread: true
    }] });
    await expect(run("teamChat.activity.setDone", { keys: [key], done: true })).resolves.toEqual({});
    await expect(run("teamChat.activity.markAllRead", {})).resolves.toEqual({});
    await expect(run("teamChat.conversation.mute", { conversationId: "c1", muted: true })).resolves.toEqual({ muted: true });
    const bodies = calls.filter((call) => call.init.body !== undefined).map((call) => JSON.parse(call.init.body as string));
    expect(bodies).toEqual([{ keys: [key], done: true }, { muted: true }]);
    expect(parseConversation({ ...conversation, muted: true }).muted).toBe(true);
    expect(parseConversation({ ...conversation, muted: false }).muted).toBeUndefined();
    expect(() => parseConversation({ ...conversation, muted: "yes" })).toThrow();
    router.shutdown();
  });

  it("rejects malformed activity", async () => {
    const { router, run } = setup({
      "GET /chat/activity": () => json({ items: [{ key: "m:1", kind: "mention", conversationId: "c1", actorUserId: "u2",
        createdAt: "2026-10-02T00:00:00Z", unread: true }] })
    });
    await expect(run("teamChat.activity.list", {})).rejects.toBeDefined();
    router.shutdown();
  });

  it("searches messages with filters and a cursor, and validates the query", async () => {
    const cursor = "1759380000123456_0b5c2f4e-8a1d-4c3e-9f6a-2d7e1b0c9a8f";
    const hit = { messageId: "m1", conversationId: "c1", seq: 3, senderUserId: "u2", createdAt: "2026-10-02T00:00:00Z",
      field: "summary", snippet: "…已定位到 redirect 参数丢失", cardTitle: "修复登录跳转" };
    const { router, run, calls } = setup({
      [`GET /chat/search?q=%E5%8F%A3%E5%BE%84&conversationId=c1&senderUserId=u2&cursor=${cursor}`]:
        () => json({ results: [hit], nextCursor: cursor }),
      "GET /chat/search?q=redirect": () => json({ results: [{ ...hit, field: "body" }] })
    });
    await expect(run("teamChat.search", { query: " 口径 ", conversationId: "c1", senderUserId: "u2", cursor })).resolves.toEqual({
      results: [{ ...hit, createdAt: Date.parse(hit.createdAt) }], nextCursor: cursor
    });
    await expect(run("teamChat.search", { query: "redirect" })).rejects.toBeDefined();
    await expect(run("teamChat.search", { query: "   " })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(calls).toHaveLength(2);
    router.shutdown();
  });

  it("edits and recalls messages and parses placeholders", async () => {
    const { router, run, calls } = setup({
      "PATCH /chat/conversations/c1/messages/m1": () => json({ ...message, body: "改后", editedAt: "2026-10-02T00:00:02Z" }),
      "DELETE /chat/conversations/c1/messages/m1": () => json({ ...message, body: "", recalledAt: "2026-10-02T00:00:03Z", recalledBy: "me" })
    });
    await expect(run("teamChat.message.edit", { conversationId: "c1", messageId: "m1", body: "改后", mentionUserIds: [] }))
      .resolves.toMatchObject({ body: "改后", editedAt: Date.parse("2026-10-02T00:00:02Z") });
    await expect(run("teamChat.message.recall", { conversationId: "c1", messageId: "m1" }))
      .resolves.toMatchObject({ body: "", recalledAt: Date.parse("2026-10-02T00:00:03Z"), recalledBy: "me" });
    await expect(run("teamChat.message.edit", { conversationId: "c1", messageId: "m1", body: "  " })).rejects.toMatchObject({ code: "INVALID_PAYLOAD" });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ body: "改后" });
    expect(() => parseMessage({ ...message, body: "" })).toThrow();
    expect(() => parseMessage({ ...message, body: "x", recalledAt: "2026-10-02T00:00:03Z" })).toThrow();
    router.shutdown();
  });
});

