import { describe, expect, it } from "vitest";
import {
  conversationTitleCandidate,
  semanticConversationTitleCandidate
} from "./conversation-title.js";

describe("conversation title candidate", () => {
  it.each(["继续", "继续吧", "好的", "按你的建议来", "commit 一下", "push", "/plan", "/new", "/model"])(
    "rejects a non-topical follow-up: %s",
    (value) => expect(conversationTitleCandidate(value)).toBeUndefined()
  );

  it("keeps short but meaningful questions", () => {
    expect(conversationTitleCandidate("你是谁")).toBe("你是谁");
  });

  it("sanitizes controls, bounds graphemes, and labels image-only turns", () => {
    const title = conversationTitleCandidate(`第一行\n\u202e第二行 ${"会".repeat(80)}`);
    expect(title).toMatch(/^第一行 第二行/u);
    expect(title).not.toContain("\u202e");
    expect(title?.endsWith("…")).toBe(true);
    expect(conversationTitleCandidate("", true)).toBe("图片消息");
  });

  it("normalizes semantic model output without keeping labels or wrapping quotes", () => {
    expect(semanticConversationTitleCandidate("标题：\"Session 搜索性能优化。\""))
      .toBe("Session 搜索性能优化");
    expect(semanticConversationTitleCandidate("继续吧")).toBeUndefined();
    expect(Array.from(semanticConversationTitleCandidate("标".repeat(80)) ?? "")).toHaveLength(40);
  });
});
