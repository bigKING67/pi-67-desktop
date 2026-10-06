import type { TeamChatMessage } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  formatTeamChatBytes,
  formatTeamChatTime,
  teamChatInvocationText,
  teamChatMentionCandidates,
  teamChatMentionQuery,
  teamChatMentionSegments,
  teamChatRemainingCharacters,
  teamChatTimeline
} from "./team-chat-presentation.js";

const at = (day: number, hour: number, minute: number) => new Date(2026, 9, day, hour, minute).getTime();
const message = (id: string, sender: string, createdAt: number): TeamChatMessage => ({
  id, conversationId: "c1", seq: Number(id.slice(1)), senderUserId: sender, body: id, clientKey: `key-${id}-0000`, createdAt
});

describe("team chat presentation", () => {
  it("groups by day and sender, and appends pending sends as the reader", () => {
    const now = at(3, 12, 0);
    const entries = teamChatTimeline([
      message("m1", "u2", at(1, 9, 0)),
      message("m2", "u2", at(2, 9, 0)),
      message("m3", "u2", at(2, 9, 3)),
      message("m4", "u2", at(2, 9, 30)),
      message("m5", "me", at(3, 11, 0))
    ], [{ clientKey: "p1-000000", conversationId: "c1", body: "hi", createdAt: at(3, 11, 1), status: "failed", error: "x" }], "me", now);
    expect(entries.map((entry) => `${entry.dayLabel ? `${entry.dayLabel}|` : ""}${entry.key}:${entry.showHeader}`)).toEqual([
      "10月1日|m1:true", "昨天|m2:true", "m3:false", "m4:true", "今天|m5:true", "pending-p1-000000:false"
    ]);
    expect(entries.at(-1)).toMatchObject({ senderUserId: "me", pending: { status: "failed", error: "x" } });
    expect(teamChatTimeline([message("m1", "u2", new Date(2025, 0, 2).getTime())], [], "me", now)[0])
      .toMatchObject({ dayLabel: "2025年1月2日" });
  });

  it("formats file sizes as people read them", () => {
    expect([12, 1_500, 840 * 1024, 3.44 * 1024 * 1024, 25 * 1024 * 1024].map(formatTeamChatBytes))
      .toEqual(["12 B", "1 KB", "840 KB", "3.4 MB", "25 MB"]);
  });

  it("formats times and reveals the remaining budget only near the limit", () => {
    expect(formatTeamChatTime(at(1, 9, 5))).toBe("09:05");
    expect(teamChatRemainingCharacters("a".repeat(100), 4_000)).toBeUndefined();
    expect(teamChatRemainingCharacters("😀".repeat(3_700), 4_000)).toBe(300);
    expect(teamChatRemainingCharacters("a".repeat(4_010), 4_000)).toBe(-10);
  });

  it("finds the @query before the caret but not inside emails", () => {
    expect(teamChatMentionQuery("你好 @李", 5)).toEqual({ start: 3, query: "李" });
    expect(teamChatMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(teamChatMentionQuery("你好@李", 4)).toEqual({ start: 2, query: "李" });
    expect(teamChatMentionQuery("me@example.com", 14)).toBeUndefined();
    expect(teamChatMentionQuery("@李 雷", 4)).toBeUndefined();
  });

  it("ranks prefix matches first and caps candidates", () => {
    const members = [{ userId: "a", displayName: "王小李" }, { userId: "b", displayName: "李雷" }, { userId: "c", displayName: "韩梅梅" }];
    expect(teamChatMentionCandidates("李", members).map((item) => item.userId)).toEqual(["b", "a"]);
    expect(teamChatMentionCandidates("", Array.from({ length: 12 }, (_, index) => ({ userId: `${index}`, displayName: `u${index}` })))).toHaveLength(8);
  });

  it("splits bodies into mention runs, preferring the longest name", () => {
    const mentioned = [{ userId: "a", displayName: "李" }, { userId: "b", displayName: "李雷" }];
    expect(teamChatMentionSegments("请 @李雷 和 @李 看@王", mentioned)).toEqual([
      { text: "请 " }, { text: "@李雷", userId: "b" }, { text: " 和 " }, { text: "@李", userId: "a" }, { text: " 看@王" }
    ]);
    expect(teamChatTimeline([{ ...message("m1", "u2", at(1, 9, 0)), mentionUserIds: ["me"] }], [], "me", at(1, 10, 0))[0])
      .toMatchObject({ mentionUserIds: ["me"] });
  });

  it("describes Agent request states and hides them once the reply arrives", () => {
    expect(teamChatInvocationText({ status: "queued" }, "研究助手", true)).toBe("研究助手 已收到，排队中");
    expect(teamChatInvocationText({ status: "queued" }, "研究助手", false)).toContain("离线");
    expect(teamChatInvocationText({ status: "running" }, "研究助手", true)).toBe("研究助手 正在回复…");
    expect(teamChatInvocationText({ status: "replied" }, "研究助手", true)).toBeUndefined();
    expect(teamChatInvocationText({ status: "rejected", reason: "daily_limit" }, "研究助手", true)).toBe("研究助手 没有处理：今日次数已用完");
    expect(teamChatInvocationText({ status: "failed", reason: "model_unavailable" }, "研究助手", true)).toContain("模型不可用");
    expect(teamChatInvocationText({ status: "expired" }, "研究助手", false)).toContain("10 分钟");
  });
});
