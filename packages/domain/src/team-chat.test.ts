import { describe, expect, it } from "vitest";
import {
  mergeTeamChatMessages,
  teamChatCodePointLength,
  teamChatCodePointPrefix,
  teamChatHasControlCharacter,
  teamChatDirectPeer,
  teamChatHasTailGap,
  teamChatUnreadTotal,
  teamChatWorkCardActions,
  teamChatWorkCardBrief,
  type TeamChatConversation,
  type TeamChatWorkCard,
  type TeamChatMessage
} from "./team-chat.js";

const message = (seq: number, body = `m${seq}`): TeamChatMessage => ({
  id: `id-${seq}`,
  conversationId: "c1",
  seq,
  senderUserId: "u1",
  body,
  clientKey: `client-key-${seq}`,
  createdAt: seq
});

const conversation = (patch: Partial<TeamChatConversation>): TeamChatConversation => ({
  id: "c1",
  kind: "channel",
  visibility: "public",
  name: "研究",
  joined: true,
  memberCount: 2,
  memberUserIds: [],
  lastSeq: 0,
  lastReadSeq: 0,
  unreadCount: 0,
  mentionCount: 0,
  createdAt: 0,
  ...patch
});

describe("team chat policy", () => {
  it("merges pages and pushes into one ascending copy per seq", () => {
    const merged = mergeTeamChatMessages([message(3), message(1)], [message(2), message(3, "replayed")]);
    expect(merged.map((item) => [item.seq, item.body])).toEqual([[1, "m1"], [2, "m2"], [3, "replayed"]]);
    expect(mergeTeamChatMessages([message(1)], [])).toEqual([message(1)]);
  });

  it("detects a tail gap against the conversation head", () => {
    expect(teamChatHasTailGap([], 0)).toBe(false);
    expect(teamChatHasTailGap([], 1)).toBe(true);
    expect(teamChatHasTailGap([message(1), message(2)], 2)).toBe(false);
    expect(teamChatHasTailGap([message(1)], 3)).toBe(true);
  });

  it("resolves the direct-message peer only for direct messages", () => {
    expect(teamChatDirectPeer(conversation({ kind: "dm", memberUserIds: ["me", "you"] }), "me")).toBe("you");
    expect(teamChatDirectPeer(conversation({ kind: "dm", memberUserIds: ["me"] }), "me")).toBeUndefined();
    expect(teamChatDirectPeer(conversation({ memberUserIds: ["me", "you"] }), "me")).toBeUndefined();
  });

  it("counts unread only in joined conversations", () => {
    expect(teamChatUnreadTotal([
      conversation({ unreadCount: 3 }),
      conversation({ id: "c2", unreadCount: 99, joined: false }),
      conversation({ id: "c3", unreadCount: 2 })
    ])).toBe(5);
    expect(teamChatUnreadTotal([
      conversation({ unreadCount: 3 }),
      conversation({ id: "c2", unreadCount: 9, mentionCount: 1, muted: true })
    ])).toBe(4);
  });

  it("counts and truncates by code point without splitting pairs", () => {
    expect(teamChatCodePointLength("a😀名")).toBe(3);
    expect(teamChatCodePointLength("")).toBe(0);
    expect(teamChatCodePointPrefix("a😀名", 2)).toBe("a😀");
    expect(teamChatCodePointPrefix("ab", 5)).toBe("ab");
    expect(teamChatHasControlCharacter("研究\u0007")).toBe(true);
    expect(teamChatHasControlCharacter("a\u007fb")).toBe(true);
    expect(teamChatHasControlCharacter("研究 2026")).toBe(false);
  });

  it("offers only the Work Card actions the service accepts", () => {
    const card = (patch: Partial<TeamChatWorkCard>): TeamChatWorkCard => ({
      id: "w1", conversationId: "c1", createdBy: "boss", title: "t", goal: "", acceptance: "", summary: "", refs: [],
      status: "todo", revision: 1, createdAt: 0, updatedAt: 0, ...patch
    });
    expect(teamChatWorkCardActions(card({}), "dev")).toEqual(["claim"]);
    expect(teamChatWorkCardActions(card({ assigneeUserId: "other" }), "dev")).toEqual([]);
    expect(teamChatWorkCardActions(card({}), "boss")).toEqual(["claim", "close"]);
    expect(teamChatWorkCardActions(card({ status: "in_progress", claimedBy: "dev" }), "dev")).toEqual(["submit_for_review"]);
    expect(teamChatWorkCardActions(card({ status: "in_progress", claimedBy: "dev" }), "boss")).toEqual(["close"]);
    expect(teamChatWorkCardActions(card({ status: "in_review", claimedBy: "dev" }), "dev")).toEqual([]);
    expect(teamChatWorkCardActions(card({ status: "in_review", claimedBy: "dev" }), "boss")).toEqual(["accept", "request_changes", "close"]);
    expect(teamChatWorkCardActions(card({ status: "done" }), "boss")).toEqual(["reopen"]);
    expect(teamChatWorkCardActions(card({ status: "closed" }), "dev")).toEqual([]);
  });

  it("builds a Work brief from reviewed card fields only", () => {
    expect(teamChatWorkCardBrief({ title: "修复登录", goal: " 回跳 ", acceptance: "", summary: "已定位",
      refs: [{ kind: "branch", label: "fix/login" }, { kind: "pull_request", label: "#4", url: "https://example.test/4" }] }))
      .toBe("任务：修复登录\n\n目标：\n回跳\n\n交接摘要：\n已定位\n\n参考：\n- fix/login\n- #4 https://example.test/4");
    expect(teamChatWorkCardBrief({ title: "t", goal: "", acceptance: "", summary: "", refs: [] })).toBe("任务：t");
  });
});
