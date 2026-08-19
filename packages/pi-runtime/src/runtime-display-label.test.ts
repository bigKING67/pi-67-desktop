import { describe, expect, it } from "vitest";
import { isLikelyMojibake, runtimeDisplayLabel } from "./runtime-display-label.js";

describe("runtime display labels", () => {
  it("preserves valid UTF-8 labels", () => {
    expect(runtimeDisplayLabel(
      "\u6676\u6CF0\u79D1\u5B66\u65D7\u8230\u6A21\u578B (Pi local tools)",
      "xtalpi-science-flagship"
    )).toBe("\u6676\u6CF0\u79D1\u5B66\u65D7\u8230\u6A21\u578B (Pi local tools)");
    expect(runtimeDisplayLabel("GPT-5.5 (\u672C\u5730 Codex)", "gpt-5.5")).toBe("GPT-5.5 (\u672C\u5730 Codex)");
  });

  it("falls back to a stable identity label for replacement and mojibake text", () => {
    expect(runtimeDisplayLabel("GPT-5.5 (\u93C8\u53E3\u8FE2 Codex \u8DEF \u907D\u6C1F\u93E1?)", "gpt-5.5"))
      .toBe("GPT 5.5");
    expect(runtimeDisplayLabel("\uFFFD\uFFFD science", "xtalpi-science-flagship"))
      .toBe("XtalPi Science Flagship");
  });

  it("does not classify ordinary Chinese product names as corrupted", () => {
    expect(isLikelyMojibake("\u6DF1\u5EA6\u6C42\u7D22\u672C\u5730\u5DE5\u5177")).toBe(false);
  });
});
