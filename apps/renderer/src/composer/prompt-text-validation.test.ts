import { describe, expect, it } from "vitest";
import { MAX_PROMPT_TEXT_CHARS } from "@pi67/protocol";
import { promptTextValidationMessage } from "./prompt-text-validation.js";

describe("prompt text validation", () => {
  it("accepts the shared Prompt limit", () => {
    expect(promptTextValidationMessage("x".repeat(MAX_PROMPT_TEXT_CHARS))).toBeUndefined();
  });

  it("reports the exact excess without modifying the draft", () => {
    const draft = "x".repeat(MAX_PROMPT_TEXT_CHARS + 2);
    expect(promptTextValidationMessage(draft)).toBe(
      "消息超出 120,000 字符上限（多出 2 个字符）。请缩短或拆分后再发送。"
    );
    expect(draft).toHaveLength(MAX_PROMPT_TEXT_CHARS + 2);
  });

  it("counts Unicode code points consistently with the Protocol schema", () => {
    expect(promptTextValidationMessage("😀".repeat(MAX_PROMPT_TEXT_CHARS))).toBeUndefined();
    expect(promptTextValidationMessage("😀".repeat(MAX_PROMPT_TEXT_CHARS + 1)))
      .toContain("多出 1 个字符");
  });
});
