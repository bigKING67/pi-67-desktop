import { TEAM_CHAT_DEFAULT_POLICY, type TeamChatConversation, type TeamChatDirectory, type TeamChatMessage } from "@pi67/domain";
import type { AgentEvent, EventEnvelope } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionSubscriber } from "../connection/agent-connection-controller-contract.js";
import { createTeamChatController, teamChatErrorMessage, type TeamChatPort } from "./team-chat-controller.js";

const conversation: TeamChatConversation = {
  id: "c1", kind: "channel", visibility: "public", name: "研究", joined: true, memberCount: 2, memberUserIds: [],
  lastSeq: 2, lastReadSeq: 1, unreadCount: 1, mentionCount: 0, createdAt: 1
};
const directory: TeamChatDirectory = {
  teamId: "t", selfUserId: "me", members: [{ userId: "me", displayName: "Me", role: "owner" }], conversations: [conversation],
  policy: TEAM_CHAT_DEFAULT_POLICY,
  agents: [],
  bots: []
};
const message = (seq: number, patch: Partial<TeamChatMessage> = {}): TeamChatMessage => ({
  id: `m${seq}`, conversationId: "c1", seq, senderUserId: "u2", body: `m${seq}`, clientKey: `client-${seq}`, createdAt: seq, ...patch
});
const appEnvelope = { context: { scope: "app" } } as EventEnvelope;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(handlers: Partial<Record<string, (payload: never) => unknown>>) {
  let subscriber: ConnectionSubscriber = {};
  const calls: Array<{ type: string; payload: unknown }> = [];
  const port: TeamChatPort = {
    request: vi.fn(async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      const handler = handlers[type];
      if (!handler) throw new Error(`unexpected ${type}`);
      return await handler(payload as never);
    }) as unknown as TeamChatPort["request"],
    subscribe: (next) => { subscriber = next; return () => { subscriber = {}; }; },
    newClientKey: () => "client-key-new"
  };
  const controller = createTeamChatController(port);
  const emit = (event: AgentEvent) => subscriber.onEvent?.(event, appEnvelope);
  return { controller, calls, emit, connect: () => subscriber.onConnected?.({} as never), subscriber: () => subscriber };
}

describe("team chat controller", () => {
  it("loads the directory on connect and reconciles once per live generation", async () => {
    const { controller, calls, emit, connect, subscriber } = harness({
      "teamChat.connection.get": () => ({ status: "live", generation: 1 }),
      "teamChat.directory.get": () => directory
    });
    controller.start();
    controller.start();
    connect();
    await flush();
    expect(controller.store.getState()).toMatchObject({ connection: { status: "live", generation: 1 }, directoryStatus: "ready" });
    emit({ type: "teamChat.connectionChanged", payload: { status: "live", generation: 1 } });
    emit({ type: "teamChat.connectionChanged", payload: { status: "reconnecting", retryAt: 5 } });
    await flush();
    expect(calls.filter((call) => call.type === "teamChat.directory.get")).toHaveLength(1);
    emit({ type: "teamChat.connectionChanged", payload: { status: "live", generation: 2 } });
    await flush();
    expect(calls.filter((call) => call.type === "teamChat.directory.get")).toHaveLength(2);
    // A restarted Agent Host starts its generations again at 1; that still reconciles.
    subscriber().onTeardown?.(new Error("host restarted"));
    emit({ type: "teamChat.connectionChanged", payload: { status: "live", generation: 1 } });
    await flush();
    expect(calls.filter((call) => call.type === "teamChat.directory.get")).toHaveLength(3);
    controller.stop();
  });

  it("selects a conversation, loads its latest page, and marks it read", async () => {
    const { controller, calls, connect } = harness({
      "teamChat.connection.get": () => ({ status: "connecting" }),
      "teamChat.directory.get": () => directory,
      "teamChat.messages.list": () => ({ messages: [message(1), message(2)], hasMore: false }),
      "teamChat.read.mark": () => ({ lastReadSeq: 2 })
    });
    controller.start();
    connect();
    await flush();
    await controller.selectConversation("c1");
    expect(controller.store.getState().threads.c1?.messages).toHaveLength(2);
    expect(calls.at(-1)).toEqual({ type: "teamChat.read.mark", payload: { conversationId: "c1", lastReadSeq: 2 } });
    expect(controller.store.getState().directory?.conversations[0]).toMatchObject({ lastReadSeq: 2, unreadCount: 0 });
    await controller.selectConversation(undefined);
    expect(controller.store.getState().selectedConversationId).toBeUndefined();
  });

  it("applies pushes, refreshes for unknown conversations, and catches up gaps", async () => {
    const { controller, calls, emit, connect } = harness({
      "teamChat.connection.get": () => ({ status: "connecting" }),
      "teamChat.directory.get": () => directory,
      "teamChat.messages.list": (payload: { after?: number }) => payload.after === undefined
        ? { messages: [message(1), message(2)], hasMore: false }
        : { messages: [message(3), message(4)], hasMore: false },
      "teamChat.read.mark": () => ({ lastReadSeq: 2 })
    });
    controller.start();
    connect();
    await flush();
    await controller.selectConversation("c1");
    emit({ type: "teamChat.pushed", payload: { type: "message.created", message: message(4) } });
    await flush();
    expect(calls).toContainEqual({ type: "teamChat.messages.list", payload: { conversationId: "c1", after: 2, limit: 100 } });
    expect(controller.store.getState().threads.c1?.messages.map((item) => item.seq)).toEqual([1, 2, 3, 4]);
    emit({ type: "teamChat.pushed", payload: { type: "message.created", message: message(1, { conversationId: "other" }) } });
    emit({ type: "teamChat.pushed", payload: { type: "read.changed", conversationId: "c1", lastReadSeq: 4 } });
    await flush();
    expect(calls.filter((call) => call.type === "teamChat.directory.get").length).toBeGreaterThanOrEqual(2);
  });

  it("sends optimistically, keeps failures retryable with the same key, and discards", async () => {
    let fail = true;
    const { controller, calls, connect } = harness({
      "teamChat.connection.get": () => ({ status: "connecting" }),
      "teamChat.directory.get": () => directory,
      "teamChat.message.send": (payload: { clientKey: string }) => {
        if (fail) throw Object.assign(new Error("x"), { details: { serviceError: "chat_membership_required" } });
        return message(3, { senderUserId: "me", clientKey: payload.clientKey });
      }
    });
    controller.start();
    connect();
    await flush();
    await controller.send("c1", "你好");
    expect(controller.store.getState().pending).toEqual([expect.objectContaining({
      clientKey: "client-key-new", status: "failed", error: "加入频道后才能发送消息。"
    })]);
    fail = false;
    await controller.retrySend("client-key-new");
    await controller.retrySend("missing");
    expect(calls.filter((call) => call.type === "teamChat.message.send").map((call) => call.payload))
      .toEqual([{ conversationId: "c1", clientKey: "client-key-new", body: "你好" }, { conversationId: "c1", clientKey: "client-key-new", body: "你好" }]);
    expect(controller.store.getState().pending).toEqual([]);
    expect(controller.store.getState().directory?.conversations[0]).toMatchObject({ lastSeq: 3, unreadCount: 0 });
    fail = true;
    await controller.send("c1", "again");
    controller.discardPending("client-key-new");
    expect(controller.store.getState().pending).toEqual([]);
  });

  it("clears every cache on sign-out and ignores late results", async () => {
    let release!: (value: TeamChatDirectory) => void;
    const { controller, emit, connect } = harness({
      "teamChat.connection.get": () => ({ status: "connecting" }),
      "teamChat.directory.get": () => new Promise<TeamChatDirectory>((resolve) => { release = resolve; })
    });
    controller.start();
    connect();
    await flush();
    emit({ type: "teamChat.connectionChanged", payload: { status: "signed-out" } });
    release(directory);
    await flush();
    expect(controller.store.getState()).toMatchObject({ connection: { status: "signed-out" }, directory: undefined });
  });

  it("opens existing or new direct messages, creates and joins channels", async () => {
    const created: TeamChatConversation = { ...conversation, id: "c2", name: "新频道", lastSeq: 0, lastReadSeq: 0, unreadCount: 0 };
    const directMessage: TeamChatConversation = { ...conversation, id: "d1", kind: "dm", visibility: "private",
      memberUserIds: ["me", "u3"], lastSeq: 0, lastReadSeq: 0, unreadCount: 0 };
    delete directMessage.name;
    const { controller, calls, connect } = harness({
      "teamChat.connection.get": () => ({ status: "connecting" }),
      "teamChat.directory.get": () => directory,
      "teamChat.channel.create": () => created,
      "teamChat.channel.join": () => ({ ...created, joined: true }),
      "teamChat.dm.open": () => directMessage,
      "teamChat.messages.list": () => ({ messages: [], hasMore: false })
    });
    controller.start();
    connect();
    await flush();
    await controller.createChannel({ name: "新频道", visibility: "public", memberUserIds: [] });
    expect(controller.store.getState().selectedConversationId).toBe("c2");
    await controller.openDirectMessage("u3");
    await controller.openDirectMessage("u3");
    expect(calls.filter((call) => call.type === "teamChat.dm.open")).toHaveLength(1);
    await controller.joinChannel("c2");
    expect(controller.store.getState().threads.c2?.status).toBe("ready");
  });

  it("pages older history once at a time and records failures", async () => {
    let older = 0;
    const { controller, connect } = harness({
      "teamChat.connection.get": () => ({ status: "connecting" }),
      "teamChat.directory.get": () => directory,
      "teamChat.messages.list": (payload: { before?: number }) => {
        if (payload.before === undefined) return { messages: [message(5)], hasMore: true };
        older += 1;
        if (older > 1) throw new Error("offline");
        return { messages: [message(4)], hasMore: true };
      },
      "teamChat.read.mark": () => ({ lastReadSeq: 2 })
    });
    controller.start();
    connect();
    await flush();
    await controller.selectConversation("c1");
    await Promise.all([controller.loadOlder("c1"), controller.loadOlder("c1")]);
    expect(older).toBe(1);
    await controller.loadOlder("c1");
    expect(controller.store.getState().threads.c1).toMatchObject({ loadingOlder: false, hasMore: true });
    expect(controller.store.getState().threads.c1?.messages.map((item) => item.seq)).toEqual([4, 5]);
  });

  it("keeps the last known state through teardown and activates only when unknown", async () => {
    const { controller, calls, subscriber } = harness({ "teamChat.connection.get": () => { throw new Error("down"); } });
    controller.start();
    controller.activate();
    await flush();
    expect(controller.store.getState().connection).toBeUndefined();
    subscriber().onTeardown?.(new Error("closed"));
    expect(calls).toHaveLength(1);
    expect(teamChatErrorMessage(new Error("x"))).toBe("操作没有完成，请稍后重试。");
    expect(teamChatErrorMessage({ details: { serviceError: "chat_channel_name_taken" } })).toBe("团队里已有同名频道。");
  });

  it("creates Work Cards, applies actions and reloads the thread on a stale revision", async () => {
    const card = { id: "w1", conversationId: "c1", createdBy: "me", title: "t", goal: "", acceptance: "", summary: "", refs: [],
      status: "todo" as const, revision: 1, createdAt: 0, updatedAt: 0 };
    let stale = false;
    const { controller, calls, connect } = harness({
      "teamChat.connection.get": () => ({ status: "connecting" }),
      "teamChat.directory.get": () => directory,
      "teamChat.messages.list": () => ({ messages: [message(1)], hasMore: false }),
      "teamChat.read.mark": () => ({ lastReadSeq: 2 }),
      "teamChat.dm.open": () => ({ ...conversation, id: "d9", kind: "dm", visibility: "private", memberUserIds: ["me", "u5"] }),
      "teamChat.workCard.create": () => message(3, { senderUserId: "me", body: "t", workCard: card }),
      "teamChat.workCard.act": () => {
        if (stale) throw Object.assign(new Error("stale"), { details: { serviceError: "work_card_revision_conflict" } });
        return { ...card, status: "in_progress", claimedBy: "me", revision: 2 };
      }
    });
    controller.start();
    connect();
    await flush();
    await controller.selectConversation("c1");
    await expect(controller.ensureDirectMessage("u5")).resolves.toBe("d9");
    expect(controller.store.getState().selectedConversationId).toBe("c1");
    await controller.createWorkCard("c1", { title: "t", goal: "", acceptance: "", summary: "", refs: [] });
    expect(calls.find((call) => call.type === "teamChat.workCard.create")?.payload).toMatchObject({ conversationId: "c1", clientKey: "client-key-new" });
    expect(controller.store.getState().threads.c1?.messages.at(-1)?.workCard?.status).toBe("todo");
    await controller.actOnWorkCard(card, "claim");
    expect(controller.store.getState().threads.c1?.messages.at(-1)?.workCard).toMatchObject({ status: "in_progress", revision: 2 });
    stale = true;
    const listsBefore = calls.filter((call) => call.type === "teamChat.messages.list").length;
    await expect(controller.actOnWorkCard(card, "claim")).rejects.toThrow("stale");
    expect(calls.filter((call) => call.type === "teamChat.messages.list").length).toBe(listsBefore + 1);
  });

  it("sends and retries mentions, reads rosters, and re-reads the directory after governance", async () => {
    let fail = true;
    const { controller, calls, connect } = harness({
      "teamChat.connection.get": () => ({ status: "connecting" }),
      "teamChat.directory.get": () => directory,
      "teamChat.channel.members": () => ({ ownerUserId: "me", members: [{ userId: "me", joinedAt: 1 }] }),
      "teamChat.channel.manage": () => ({}),
      "teamChat.message.send": (payload: { clientKey: string }) => {
        if (fail) throw new Error("offline");
        return message(3, { senderUserId: "me", clientKey: payload.clientKey, mentionUserIds: ["u2"] });
      }
    });
    controller.start();
    connect();
    await flush();
    await controller.send("c1", "@小王 看下", ["u2"]);
    fail = false;
    await controller.retrySend("client-key-new");
    expect(calls.filter((call) => call.type === "teamChat.message.send").map((call) => call.payload)).toEqual([
      { conversationId: "c1", clientKey: "client-key-new", body: "@小王 看下", mentionUserIds: ["u2"] },
      { conversationId: "c1", clientKey: "client-key-new", body: "@小王 看下", mentionUserIds: ["u2"] }
    ]);
    await expect(controller.channelRoster("c1")).resolves.toMatchObject({ ownerUserId: "me" });
    const before = calls.filter((call) => call.type === "teamChat.directory.get").length;
    await controller.manageChannel("c1", { type: "archive" });
    expect(calls.find((call) => call.type === "teamChat.channel.manage")?.payload).toEqual({ conversationId: "c1", action: { type: "archive" } });
    expect(calls.filter((call) => call.type === "teamChat.directory.get").length).toBe(before + 1);
  });

  it("manages Agents through the directory and tracks this Desktop's hosting", async () => {
    const host = { bindings: [{ agentUserId: "a1", workspaceId: "w1", projectId: "p1", model: { provider: "anthropic", id: "claude" }, enabled: true }], activity: [] };
    const { controller, calls, connect, emit } = harness({
      "teamChat.connection.get": () => ({ status: "connecting" }),
      "teamChat.directory.get": () => directory,
      "teamChat.agent.create": () => ({ userId: "a1" }),
      "teamChat.agent.update": () => ({}),
      "teamChat.agent.setDisabled": () => ({}),
      "teamChat.agent.remove": () => ({}),
      "teamChat.agent.host.get": () => ({ bindings: [], activity: [] }),
      "teamChat.agent.host.bind": () => host,
      "teamChat.agent.host.unbind": () => ({ bindings: [], activity: [] })
    });
    controller.start();
    connect();
    await flush();
    const reads = () => calls.filter((call) => call.type === "teamChat.directory.get").length;
    const before = reads();
    await expect(controller.createAgent({ name: "研究助手", description: "" })).resolves.toBe("a1");
    await controller.updateAgent({ agentUserId: "a1", dailyLimit: 10 });
    await controller.setAgentDisabled("a1", true);
    await controller.removeAgent("a1");
    expect(reads()).toBe(before + 4);
    await controller.loadAgentHost();
    expect(controller.store.getState().agentHost).toEqual({ bindings: [], activity: [] });
    await controller.hostAgent(host.bindings[0]!);
    expect(controller.store.getState().agentHost).toEqual(host);
    emit({ type: "teamChat.agentHostChanged", payload: { bindings: [], activity: [] } });
    expect(controller.store.getState().agentHost?.bindings).toEqual([]);
    await controller.stopHostingAgent("a1");
  });

  it("manages webhooks without keeping their secret URL in the store", async () => {
    const webhook = { botUserId: "b1", conversationId: "c1", channelName: "研究", name: "CI", createdBy: "me", createdAt: 1 };
    const { controller, calls, connect } = harness({
      "teamChat.connection.get": () => ({ status: "connecting" }),
      "teamChat.directory.get": () => directory,
      "teamChat.webhook.list": () => ({ webhooks: [webhook] }),
      "teamChat.webhook.create": () => ({ webhook, url: "https://nm.example/v1/hooks/chat/b1/secret" }),
      "teamChat.webhook.rotate": () => ({ webhook, url: "https://nm.example/v1/hooks/chat/b1/rotated" }),
      "teamChat.webhook.remove": () => ({})
    });
    controller.start();
    connect();
    await flush();
    await expect(controller.listWebhooks("c1")).resolves.toEqual([webhook]);
    await expect(controller.createWebhook("c1", "CI")).resolves.toMatchObject({ url: expect.stringContaining("/secret") });
    await expect(controller.rotateWebhook("c1", "b1")).resolves.toMatchObject({ url: expect.stringContaining("/rotated") });
    await controller.removeWebhook("c1", "b1");
    expect(JSON.stringify(controller.store.getState())).not.toContain("/v1/hooks/");
    expect(calls.map((call) => call.type).filter((type) => type.startsWith("teamChat.webhook"))).toEqual([
      "teamChat.webhook.list", "teamChat.webhook.create", "teamChat.webhook.rotate", "teamChat.webhook.remove"
    ]);
  });

  it("reads activity on connect and on push, records handled and read state, and mutes", async () => {
    const key = "m:00000000-0000-4000-8000-000000000001";
    const entry = { key, kind: "mention" as const, conversationId: "c1", actorUserId: "u2", messageSeq: 2, createdAt: 1, unread: true };
    let reads = 0;
    let failDone = false;
    const { controller, calls, connect, emit } = harness({
      "teamChat.connection.get": () => ({ status: "connecting" }),
      "teamChat.directory.get": () => directory,
      "teamChat.activity.list": () => { reads += 1; return { items: [entry] }; },
      "teamChat.activity.setDone": () => { if (failDone) throw new Error("offline"); return {}; },
      "teamChat.activity.markAllRead": () => ({}),
      "teamChat.conversation.mute": (payload: { muted: boolean }) => ({ muted: payload.muted })
    });
    controller.start();
    connect();
    await flush();
    expect(controller.store.getState()).toMatchObject({ activityStatus: "ready", activity: [entry] });
    emit({ type: "teamChat.pushed", payload: { type: "activity.changed" } });
    await flush();
    expect(reads).toBe(2);

    await controller.setActivityDone([key], true);
    expect(controller.store.getState().activity?.[0]).toMatchObject({ unread: false, doneAt: expect.any(Number) });
    failDone = true;
    await expect(controller.setActivityDone([key], false)).rejects.toThrow("offline");
    await flush();
    expect(reads).toBe(3);
    await controller.markAllActivityRead();
    expect(controller.store.getState().activity?.every((item) => !item.unread)).toBe(true);

    await controller.muteConversation("c1", true);
    expect(controller.store.getState().directory?.conversations[0]?.muted).toBe(true);
    await controller.muteConversation("c1", false);
    expect(controller.store.getState().directory?.conversations[0]).not.toHaveProperty("muted");
    expect(calls.filter((call) => call.type === "teamChat.conversation.mute").map((call) => call.payload))
      .toEqual([{ conversationId: "c1", muted: true }, { conversationId: "c1", muted: false }]);
  });

  it("opens the inbox and opens a message by paging back to it", async () => {
    const pages: Record<string, { messages: TeamChatMessage[]; hasMore: boolean }> = {
      latest: { messages: [message(5), message(6)], hasMore: true },
      5: { messages: [message(3), message(4)], hasMore: true },
      3: { messages: [message(1), message(2)], hasMore: false }
    };
    const { controller, connect } = harness({
      "teamChat.connection.get": () => ({ status: "connecting" }),
      "teamChat.directory.get": () => directory,
      "teamChat.activity.list": () => ({ items: [] }),
      "teamChat.messages.list": (payload: { before?: number }) => pages[payload.before === undefined ? "latest" : String(payload.before)],
      "teamChat.read.mark": () => ({ lastReadSeq: 6 })
    });
    controller.start();
    connect();
    await flush();
    controller.openActivity();
    expect(controller.store.getState().activityOpen).toBe(true);
    await controller.openMessage("c1", 2);
    const state = controller.store.getState();
    expect(state.activityOpen).toBe(false);
    expect(state.selectedConversationId).toBe("c1");
    expect(state.threads.c1?.messages.map((item) => item.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(state.focus).toMatchObject({ conversationId: "c1", seq: 2 });
    await controller.selectConversation("c1");
    expect(controller.store.getState().focus).toBeUndefined();
  });
});
