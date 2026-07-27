import { describe, expect, it } from "vitest";
import { analyzeSecurityLiteral } from "./security-literal.js";

describe("analyzeSecurityLiteral", () => {
  it("leaves ordinary Chinese and shell text unchanged", () => {
    const raw = "printf '中文'\\nfirst";

    expect(analyzeSecurityLiteral(raw)).toEqual({
      raw,
      display: raw,
      suspicious: false,
      suspiciousCharacterCount: 0,
      categories: []
    });
  });

  it("makes bidi controls, isolates and deprecated controls explicit", () => {
    const raw = `safe\u202Etxt\u2066中文\u2069\u206A`;

    expect(analyzeSecurityLiteral(raw)).toEqual({
      raw,
      display: "safe\\u{202E}txt\\u{2066}中文\\u{2069}\\u{206A}",
      suspicious: true,
      suspiciousCharacterCount: 4,
      categories: ["bidi"]
    });
  });

  it("makes zero-width characters and BOM explicit", () => {
    const raw = `a\u200Bb\u200Cc\u200Dd\u2060e\uFEFFf`;

    expect(analyzeSecurityLiteral(raw)).toMatchObject({
      raw,
      display: "a\\u{200B}b\\u{200C}c\\u{200D}d\\u{2060}e\\u{FEFF}f",
      suspicious: true,
      suspiciousCharacterCount: 5,
      categories: ["zero-width"]
    });
  });

  it("escapes every C0 and C1 control, including CR, LF and tab", () => {
    const raw = `nul\0tab\tdel\u007Fc1\u0080lone\rend\r\nnext\n`;

    expect(analyzeSecurityLiteral(raw)).toMatchObject({
      raw,
      display: "nul\\x00tab\\x09del\\x7Fc1\\x80lone\\x0Dend\\x0D\\x0Anext\\x0A",
      suspicious: true,
      suspiciousCharacterCount: 8,
      categories: ["control"]
    });
  });

  it("classifies ANSI ESC and C1 CSI controls separately without interpreting the sequence", () => {
    const raw = `plain\u001B[31mred\u001B[0m\u009B32mgreen`;

    expect(analyzeSecurityLiteral(raw)).toMatchObject({
      raw,
      display: "plain\\x1B[31mred\\x1B[0m\\x9B32mgreen",
      suspicious: true,
      suspiciousCharacterCount: 3,
      categories: ["ansi"]
    });
  });

  it("escapes Unicode line and paragraph separators instead of rendering hidden line breaks", () => {
    const raw = `first\u0085second\u2028third\u2029fourth`;

    expect(analyzeSecurityLiteral(raw)).toMatchObject({
      raw,
      display: "first\\x85second\\u{2028}third\\u{2029}fourth",
      suspicious: true,
      suspiciousCharacterCount: 3,
      categories: ["line-separator"]
    });
  });

  it("escapes literal backslashes when a suspicious character is present to avoid display collisions", () => {
    const raw = String.raw`printf '\u{202E}'` + "\u202E";

    expect(analyzeSecurityLiteral(raw)).toMatchObject({
      raw,
      display: String.raw`printf '\\u{202E}'\u{202E}`,
      suspicious: true,
      suspiciousCharacterCount: 1,
      categories: ["bidi"]
    });
  });

  it("keeps HTML-looking input as inert text while exposing mixed suspicious categories", () => {
    const raw = `<script>alert(1)</script>\u200B\u001B\u2028\u202E`;
    const analysis = analyzeSecurityLiteral(raw);

    expect(analysis.raw).toBe(raw);
    expect(analysis.display).toBe("<script>alert(1)</script>\\u{200B}\\x1B\\u{2028}\\u{202E}");
    expect(analysis.categories).toEqual(["zero-width", "ansi", "line-separator", "bidi"]);
    expect(analysis.suspiciousCharacterCount).toBe(4);
  });
});
