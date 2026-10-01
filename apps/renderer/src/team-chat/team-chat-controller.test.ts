import type { TeamChatConversation, TeamChatDirectory, TeamChatMessage } from "@pi67/domain";
import type { AgentEvent, EventEnvelope } from "@pi67/protocol";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionSubscriber } from "../connection/agent-connection-controller-contract.js";
import { createTeamChatController, teamChatErrorMessage, type TeamChatPort } from "./team-chat-controller.js";

const conversation: TeamChatConversation = {
  id: "c1", kind: "channel", visibility: "public", name: "研究", joined: true, memberCount: 2, memberUserIds: [],
  lastSeq: 2, lastReadSeq: 1, unreadCount: 1, createdAt: 1
};
const directory: TeamChatDirectory = {
  teamId: "t", selfUserId: "me", members: [{ userId: "me", displayName: "Me", role: "owner" }], conversations: [conversation]
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
    const { controller, calls, emit, connect } = harness({
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
});
