import type { SessionMessageView } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  latestUserMessagePreview,
  userMessagePreview
} from "./recent-user-message.js";

describe("recent user message preview", () => {
  it("uses the last user text rather than a later assistant response", () => {
    expect(latestUserMessagePreview([
      message("user", "先检查构建"),
      message("assistant", "已经完成"),
      message("user", "然后重新检查双栏设置"),
      message("assistant", "正在处理")
    ])).toBe("然后重新检查双栏设置");
  });

  it("collapses unsafe controls and bounds the in-memory label", () => {
    const preview = userMessagePreview(`  第一行\n\u202e第二行 ${"会".repeat(80)}  `);

    expect(preview).toMatch(/^第一行 第二行/u);
    expect(preview).not.toContain("\u202e");
    expect(preview?.endsWith("…")).toBe(true);
    expect(Array.from(preview ?? "")).toHaveLength(73);
  });

  it("gives an image-only user message a useful label", () => {
    expect(userMessagePreview("", true)).toBe("图片消息");
  });
});

function message(role: SessionMessageView["role"], text: string): SessionMessageView {
  return { id: `${role}-${text}`, role, parts: [{ type: "text", text }] };
}
