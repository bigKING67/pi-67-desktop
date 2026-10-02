import { TEAM_CHAT_DEFAULT_POLICY, teamChatCodePointLength, type TeamChatConversation, type TeamChatDirectory, type TeamChatMessage } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  addPending,
  applyActivityDone,
  applyActivityRead,
  applyMessage,
  applyMessagePage,
  applyPush,
  applyReadCursor,
  applyInvocation,
  applyWorkCard,
  memberById,
  canSendTo,
  conversationTitle,
  directMessageWith,
  failPending,
  INITIAL_TEAM_CHAT_STATE,
  removePending,
  replaceDirectory,
  setThreadStatus,
  type TeamChatState
} from "./team-chat-model.js";

const channel = (patch: Partial<TeamChatConversation> = {}): TeamChatConversation => ({
  id: "c1", kind: "channel", visibility: "public", name: "研究", joined: true, memberCount: 2, memberUserIds: [],
  lastSeq: 2, lastReadSeq: 2, unreadCount: 0, mentionCount: 0, createdAt: 10, ...patch
});
const dm: TeamChatConversation = {
  id: "d1", kind: "dm", visibility: "private", joined: true, memberCount: 2, memberUserIds: ["me", "u2"],
  lastSeq: 0, lastReadSeq: 0, unreadCount: 0, mentionCount: 0, createdAt: 5
};
const directory: TeamChatDirectory = {
  teamId: "t", selfUserId: "me",
  members: [{ userId: "me", displayName: "我自己", role: "owner" }, { userId: "u2", displayName: "小王", role: "member" }],
  conversations: [channel(), dm],
  policy: TEAM_CHAT_DEFAULT_POLICY,
  agents: [],
  bots: []
};
const message = (seq: number, patch: Partial<TeamChatMessage> = {}): TeamChatMessage => ({
  id: `m${seq}`, conversationId: "c1", seq, senderUserId: "u2", body: `m${seq}`, clientKey: `key-000${seq}`, createdAt: 100 + seq, ...patch
});
const ready = (): TeamChatState => applyMessagePage(replaceDirectory(INITIAL_TEAM_CHAT_STATE, directory), "c1",
  { messages: [message(1), message(2)], hasMore: true }, "latest");

describe("team chat model", () => {
  it("sorts the directory by activity and drops threads and selection for vanished conversations", () => {
    const stale = { ...INITIAL_TEAM_CHAT_STATE, selectedConversationId: "gone",
      threads: { gone: { messages: [], hasMore: false, status: "ready" as const, loadingOlder: false } } };
    const next = replaceDirectory(stale, { ...directory, conversations: [dm, channel({ lastMessageAt: 50 })] });
    expect(next.directory?.conversations.map((item) => item.id)).toEqual(["c1", "d1"]);
    expect(next.threads).toEqual({});
    expect(next.selectedConversationId).toBeUndefined();
    expect(next.directoryStatus).toBe("ready");
  });

  it("merges pages by position and settles matching pending sends", () => {
    let state = addPending(ready(), { clientKey: "key-0003", conversationId: "c1", body: "m3", createdAt: 1, status: "sending" });
    state = applyMessagePage(state, "c1", { messages: [message(3)] }, "newer");
    expect(state.threads.c1).toMatchObject({ hasMore: true, status: "ready" });
    expect(state.threads.c1?.messages.map((item) => item.seq)).toEqual([1, 2, 3]);
    expect(state.pending).toEqual([]);
    state = applyMessagePage(state, "c1", { messages: [message(0, { id: "m0" })], hasMore: false }, "older");
    expect(state.threads.c1?.messages[0]?.seq).toBe(0);
    expect(state.threads.c1?.hasMore).toBe(false);
    expect(applyMessagePage(state, "c1", { messages: [message(9)], hasMore: true }, "latest").threads.c1?.messages)
      .toEqual([message(9)]);
  });

  it("counts unread for others, clears it for self, and ignores replays", () => {
    let state = applyMessage(ready(), message(3, { createdAt: 500 }));
    let conversation = state.directory!.conversations.find((item) => item.id === "c1")!;
    expect(conversation).toMatchObject({ lastSeq: 3, unreadCount: 1, lastPreview: "m3", lastMessageAt: 500 });
    expect(state.threads.c1?.messages).toHaveLength(3);
    state = applyMessage(state, message(3, { createdAt: 500 }));
    expect(state.directory!.conversations.find((item) => item.id === "c1")!.unreadCount).toBe(1);
    state = addPending(state, { clientKey: "mine-0004", conversationId: "c1", body: "hi", createdAt: 1, status: "sending" });
    state = applyMessage(state, message(4, { senderUserId: "me", clientKey: "mine-0004", body: "x".repeat(200) }));
    conversation = state.directory!.conversations.find((item) => item.id === "c1")!;
    expect(conversation).toMatchObject({ lastSeq: 4, lastReadSeq: 4, unreadCount: 0 });
    expect(teamChatCodePointLength(conversation.lastPreview!)).toBe(140);
    expect(state.pending).toEqual([]);
  });

  it("caps unread at the service limit and leaves unloaded threads alone", () => {
    const busy = replaceDirectory(INITIAL_TEAM_CHAT_STATE, { ...directory, conversations: [channel({ unreadCount: 100 })] });
    const next = applyMessage(busy, message(3));
    expect(next.directory!.conversations[0]!.unreadCount).toBe(100);
    expect(next.threads).toEqual({});
    expect(applyMessage(INITIAL_TEAM_CHAT_STATE, message(1))).toEqual(INITIAL_TEAM_CHAT_STATE);
  });

  it("advances read cursors monotonically", () => {
    let state = applyMessage(ready(), message(3));
    state = applyMessage(state, message(4));
    const partial = applyReadCursor(state, "c1", 3);
    expect(partial.directory!.conversations.find((item) => item.id === "c1")).toMatchObject({ lastReadSeq: 3, unreadCount: 2 });
    const full = applyReadCursor(partial, "c1", 4);
    expect(full.directory!.conversations.find((item) => item.id === "c1")).toMatchObject({ lastReadSeq: 4, unreadCount: 0 });
    expect(applyReadCursor(full, "c1", 1)).toBe(full);
    expect(applyReadCursor(full, "missing", 9)).toBe(full);
  });

  it("asks for a directory refresh for changed or unknown conversations", () => {
    const state = ready();
    expect(applyPush(state, { type: "conversation.changed", conversationId: "c1" })).toEqual({ state, refreshDirectory: true });
    expect(applyPush(state, { type: "message.created", message: message(1, { conversationId: "new" }) }).refreshDirectory).toBe(true);
    expect(applyPush(state, { type: "message.created", message: message(3) }).refreshDirectory).toBe(false);
    expect(applyPush(state, { type: "read.changed", conversationId: "c1", lastReadSeq: 2 }))
      .toEqual({ state, refreshDirectory: false });
    expect(applyPush(state, { type: "policy.changed" })).toEqual({ state, refreshDirectory: true });
  });

  it("counts mentions of the reader apart from unread and clears both when read", () => {
    let state = ready();
    state = applyMessage(state, message(3, { mentionUserIds: ["me"] }));
    state = applyMessage(state, message(4, { mentionUserIds: ["u9"] }));
    state = applyMessage(state, message(4, { mentionUserIds: ["me"] }));
    expect(state.directory?.conversations.find((item) => item.id === "c1")).toMatchObject({ unreadCount: 2, mentionCount: 1 });
    state = applyReadCursor(state, "c1", 4);
    expect(state.directory?.conversations.find((item) => item.id === "c1")).toMatchObject({ unreadCount: 0, mentionCount: 0 });
    state = applyMessage(state, message(5, { mentionUserIds: ["me"] }));
    state = applyMessage(state, message(6, { senderUserId: "me" }));
    expect(state.directory?.conversations.find((item) => item.id === "c1")).toMatchObject({ mentionCount: 0 });
  });

  it("tracks pending failures and removal", () => {
    let state = addPending(INITIAL_TEAM_CHAT_STATE, { clientKey: "k1-xxxxx", conversationId: "c1", body: "a", createdAt: 1, status: "sending" });
    state = failPending(state, "k1-xxxxx", "失败");
    expect(state.pending[0]).toMatchObject({ status: "failed", error: "失败" });
    expect(removePending(state, "k1-xxxxx").pending).toEqual([]);
    expect(setThreadStatus(INITIAL_TEAM_CHAT_STATE, "c1", { status: "error" }).threads.c1).toMatchObject({ status: "error", messages: [] });
  });

  it("titles conversations and decides whether sending is possible", () => {
    expect(conversationTitle(directory, channel(), "?")).toBe("研究");
    expect(conversationTitle(directory, dm, "?")).toBe("小王");
    expect(conversationTitle(directory, { ...dm, memberUserIds: ["me", "gone"] }, "已离开")).toBe("已离开");
    expect(directMessageWith(directory, "u2")?.id).toBe("d1");
    expect(directMessageWith(directory, "nobody")).toBeUndefined();
    expect(canSendTo(directory, channel())).toBe(true);
    expect(canSendTo(directory, channel({ joined: false }))).toBe(false);
    expect(canSendTo(directory, dm)).toBe(true);
    expect(canSendTo(directory, { ...dm, memberCount: 1, memberUserIds: ["me"] })).toBe(false);
  });

  it("replaces carried Work Cards by revision and ignores stale or unknown updates", () => {
    const card = { id: "w1", conversationId: "c1", createdBy: "me", title: "t", goal: "", acceptance: "", summary: "", refs: [],
      status: "todo" as const, revision: 2, createdAt: 0, updatedAt: 0 };
    const state = applyMessagePage(replaceDirectory(INITIAL_TEAM_CHAT_STATE, directory), "c1",
      { messages: [message(1, { workCard: card }), message(2)], hasMore: false }, "latest");
    const next = applyWorkCard(state, { ...card, status: "in_progress", revision: 3 });
    expect(next.threads.c1?.messages[0]?.workCard).toMatchObject({ status: "in_progress", revision: 3 });
    expect(applyWorkCard(next, { ...card, status: "done", revision: 2 })).toBe(next);
    expect(applyWorkCard(next, { ...card, id: "other", revision: 9 })).toBe(next);
    expect(applyWorkCard(next, { ...card, conversationId: "unloaded", revision: 9 })).toBe(next);
    expect(applyPush(next, { type: "work_card.changed", card: { ...card, status: "done", revision: 4 } }))
      .toMatchObject({ refreshDirectory: false, state: { threads: { c1: { messages: [{ workCard: { status: "done" } }, {}] } } } });
  });

  it("names Agent members and tracks request states on the asking message", () => {
    const agent = { userId: "a1", name: "研究助手", description: "", ownerUserId: "me", modelLabel: "", dailyLimit: 50,
      status: "active" as const, disabledByAdmin: false, online: true, createdAt: 1 };
    let state = ready();
    state = replaceDirectory(state, { ...directory, agents: [agent] });
    state = applyMessagePage(state, "c1", { messages: [message(1), message(2)], hasMore: false }, "latest");
    expect(memberById(state.directory, "a1")).toMatchObject({ displayName: "研究助手", agent });
    expect(memberById(state.directory, "u2")).toMatchObject({ displayName: "小王" });
    const withBot = replaceDirectory(state, { ...directory, agents: [agent], bots: [{ userId: "b1", name: "CI", conversationId: "c1" }] });
    expect(memberById(withBot.directory, "b1")).toEqual({ userId: "b1", displayName: "CI", bot: true });
    expect(applyPush(state, { type: "agents.changed" }).refreshDirectory).toBe(true);
    const queued = { id: "i1", agentUserId: "a1", status: "queued" as const };
    state = applyInvocation(state, "c1", "m2", queued);
    state = applyInvocation(state, "c1", "m2", { ...queued, status: "replied" });
    expect(state.threads.c1?.messages[1]?.agentInvocations).toEqual([{ ...queued, status: "replied" }]);
    expect(applyInvocation(state, "c1", "missing", queued)).toBe(state);
    const pushed = applyPush(state, { type: "agent_invocation.changed", conversationId: "c1", messageId: "m1", invocation: queued });
    expect(pushed.state.threads.c1?.messages[0]?.agentInvocations).toEqual([queued]);
  });

  it("re-reads activity on push and applies handled and read state locally", () => {
    expect(applyPush(INITIAL_TEAM_CHAT_STATE, { type: "activity.changed" })).toMatchObject({ refreshDirectory: false, refreshActivity: true });
    const entry = { key: "m:00000000-0000-4000-8000-000000000001", kind: "dm" as const, conversationId: "c1", actorUserId: "u2", createdAt: 1, unread: true };
    const state: TeamChatState = { ...INITIAL_TEAM_CHAT_STATE, activity: [entry] };
    const done = applyActivityDone(state, [entry.key], true, 7);
    expect(done.activity?.[0]).toMatchObject({ unread: false, doneAt: 7 });
    expect(applyActivityDone(done, [entry.key], false, 8).activity?.[0]).not.toHaveProperty("doneAt");
    expect(applyActivityRead(state).activity?.[0]?.unread).toBe(false);
    expect(applyActivityRead(INITIAL_TEAM_CHAT_STATE)).toBe(INITIAL_TEAM_CHAT_STATE);
  });

  it("opens a window at older history that skips live messages until it catches up", () => {
    const base = replaceDirectory(INITIAL_TEAM_CHAT_STATE, {
      teamId: "t", selfUserId: "me", members: [], policy: { channelCreation: "members", viewersCanPost: true, agentCreation: "members", revision: 0 },
      agents: [], bots: [], conversations: [channel({ lastSeq: 900 })]
    });
    const message = (seq: number): TeamChatMessage => ({ id: `m${seq}`, conversationId: "c1", seq, senderUserId: "u2", body: "x", clientKey: `k-${seq}`, createdAt: seq });
    const windowed = applyMessagePage(base, "c1", { messages: [message(100), message(101)], hasMore: true }, "window");
    expect(windowed.threads.c1).toMatchObject({ hasMore: true, hasNewer: true });
    const live = applyMessage(windowed, message(901));
    expect(live.threads.c1?.messages.map((item) => item.seq)).toEqual([100, 101]);
    const caughtUp = applyMessagePage(live, "c1", { messages: [message(102)], hasMore: false }, "newer");
    expect(caughtUp.threads.c1?.hasNewer).toBeUndefined();
    expect(applyMessagePage(caughtUp, "c1", { messages: [message(99)], hasMore: true }, "older").threads.c1?.hasNewer).toBeUndefined();
  });
});

