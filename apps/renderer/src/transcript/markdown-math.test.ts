import { describe, expect, it } from "vitest";
import { normalizeMarkdownMath } from "./markdown-math.js";

describe("normalizeMarkdownMath", () => {
  it("normalizes common Pi model delimiters without treating prices as equations", () => {
    const result = normalizeMarkdownMath([
      "Inline $E=mc^2$ and \\(x+y\\).",
      "",
      "\\[a^2+b^2=c^2\\]",
      "",
      "价格从 $10 到 $20。"
    ].join("\n"));

    expect(result.hasMath).toBe(true);
    expect(result.source).toContain("Inline $$E=mc^2$$ and $$x+y$$.");
    expect(result.source).toContain("$$\na^2+b^2=c^2\n$$");
    expect(result.source).toContain("价格从 $10 到 $20。");
  });

  it("keeps math-like text inside inline and fenced code unchanged", () => {
    const source = [
      "`$E=mc^2$`",
      "",
      "```markdown",
      "\\[not-math\\]",
      "$x$",
      "```"
    ].join("\n");

    expect(normalizeMarkdownMath(source)).toEqual({ source, hasMath: false });
  });

  it("preserves escaped delimiters and recognizes fenced math", () => {
    const source = ["\\\\(literal\\\\)", "", "```math", "x^2", "```"].join("\n");
    const result = normalizeMarkdownMath(source);

    expect(result.source).toBe(source);
    expect(result.hasMath).toBe(true);
  });

  it("keeps incomplete streaming display delimiters on the ordinary text path", () => {
    expect(normalizeMarkdownMath("Before\n\n$$\nx^2")).toEqual({
      source: "Before\n\n$$\nx^2",
      hasMath: false
    });
    expect(normalizeMarkdownMath("Before\n\n\\[\nx^2")).toEqual({
      source: "Before\n\n$$\nx^2",
      hasMath: false
    });
  });
});
