import { describe, expect, it } from "vitest";
import { formatNotificationDateTime, formatRelativeTime } from "./date-time.js";
import { appLocale, messages, type MessageCatalog } from "./message-catalog.js";

describe("Renderer message catalog", () => {
  it("exposes one typed locale authority for static and parameterized copy", () => {
    const catalog: MessageCatalog = messages;

    expect(appLocale).toBe("zh-CN");
    expect(catalog.navigation.rowLabel("会话", "运行中", 3)).toBe("会话，运行中，3 条消息");
    expect(catalog.composer.removeAttachment("image.png")).toBe("移除附件：image.png");
    expect(catalog.approval.suspiciousDescription(2)).toContain("2 个可疑字符");
    expect(catalog.extensionCatalog.countSummary(1, 2)).toBe("1 命令 · 2 工具");
    expect(catalog.operation.completed).toBe("任务已完成");
  });

  it("centralizes relative and notification date formatting", () => {
    const now = new Date("2026-07-26T10:00:00+08:00").getTime();

    expect(formatRelativeTime(now - 30_000, now)).toBe("刚刚");
    expect(formatRelativeTime(now - 15 * 60_000, now)).toBe("15 分钟前");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3 小时前");
    expect(formatRelativeTime(Number.NaN, now)).toBe("时间未知");
    expect(formatNotificationDateTime(now)).toMatch(/7.*26.*10.*00/u);
  });
});
