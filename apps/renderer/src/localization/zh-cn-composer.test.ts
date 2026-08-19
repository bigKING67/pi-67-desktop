import { describe, expect, it } from "vitest";
import { zhCNComposerMessages } from "./zh-cn-composer.js";

describe("Chinese composer capability copy", () => {
  it("attributes thinking levels to the selected model's Pi SDK declaration", () => {
    expect(zhCNComposerMessages.thinkingAvailabilityHint(
      "DeepSeek V4 Flash",
      ["off", "high", "max"]
    )).toBe("Pi SDK 为 DeepSeek V4 Flash 声明：off、high、max；未列出的等级不会发送。");
  });
});
