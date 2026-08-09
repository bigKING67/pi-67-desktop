import { describe, expect, it } from "vitest";
import { sessionCompatibilityBannerCopy } from "./SessionCompatibilityBanner.js";

describe("SessionCompatibilityBanner", () => {
  it("renders a bounded future-format warning while keeping known messages available", () => {
    const copy = sessionCompatibilityBannerCopy({
      status: "future-format",
      currentSupportedVersion: 3,
      sessionFormatVersion: 4,
      unknownEntryCount: 2,
      unrenderableMessageCount: 1,
      mutationSafe: false
    });

    expect(copy?.title).toBe("此对话使用了较新的 Pi 会话格式");
    expect(copy?.detail).toContain("已知消息仍可查看");
    expect(copy?.detail).toContain("2 条未知事件");
    expect(copy?.detail).toContain("1 条消息无法完整显示");
    expect(JSON.stringify(copy)).not.toContain("raw");
  });

  it("stays absent for a fully compatible Session", () => {
    expect(sessionCompatibilityBannerCopy({
      status: "compatible",
      currentSupportedVersion: 3,
      sessionFormatVersion: 3,
      unknownEntryCount: 0,
      unrenderableMessageCount: 0,
      mutationSafe: true
    })).toBeUndefined();
  });
});
