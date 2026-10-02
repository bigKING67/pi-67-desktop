import { describe, expect, it } from "vitest";
import { teamChatActivityIsUnread, teamChatActivityUnreadCount, type TeamChatActivityItem } from "./team-chat-activity.js";
import type { TeamChatConversation } from "./team-chat.js";

const conversation = (lastReadSeq: number): TeamChatConversation => ({
  id: "c1", kind: "channel", visibility: "public", name: "设计", joined: true, memberCount: 2, memberUserIds: [],
  lastSeq: 9, lastReadSeq, unreadCount: 0, mentionCount: 0, createdAt: 1
});
const item = (patch: Partial<TeamChatActivityItem>): TeamChatActivityItem => ({
  key: "m:00000000-0000-4000-8000-000000000001", kind: "mention", conversationId: "c1", actorUserId: "u2",
  messageSeq: 5, createdAt: 1, unread: true, ...patch
});

describe("team chat activity", () => {
  it("clears message items once the conversation cursor passes them", () => {
    expect(teamChatActivityIsUnread(item({}), conversation(4))).toBe(true);
    expect(teamChatActivityIsUnread(item({}), conversation(5))).toBe(false);
    expect(teamChatActivityIsUnread(item({ kind: "dm" }), undefined)).toBe(true);
  });

  it("keeps card and failure items unread until handled or marked read", () => {
    expect(teamChatActivityIsUnread(item({ kind: "card_review" }), conversation(9))).toBe(true);
    expect(teamChatActivityIsUnread(item({ kind: "agent_failed" }), conversation(9))).toBe(true);
    expect(teamChatActivityIsUnread(item({ kind: "card_review", doneAt: 2 }), conversation(0))).toBe(false);
    expect(teamChatActivityIsUnread(item({ unread: false }), conversation(0))).toBe(false);
  });

  it("counts unread items against the reader's cursors", () => {
    const items = [item({}), item({ key: "e:00000000-0000-4000-8000-000000000002", kind: "card_assigned" })];
    expect(teamChatActivityUnreadCount(items, [conversation(5)])).toBe(1);
    expect(teamChatActivityUnreadCount(items, [conversation(0)])).toBe(2);
  });
});
