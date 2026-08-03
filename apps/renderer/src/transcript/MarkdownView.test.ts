import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownMathDocument } from "./MarkdownMathDocument.js";
import { MarkdownView } from "./MarkdownView.js";
import { normalizeMarkdownMath } from "./markdown-math.js";

const DOCUMENT_MARKDOWN = `
#### 执行清单

- 第一层
  - 第二层
- [x] 已完成

| 要素 | 问题 | 示例 |
| --- | --- | --- |
| 人群 | 给谁看 | 通勤用户 |

---
`;

describe("MarkdownView", () => {
  it("keeps GFM tables semantic inside a keyboard-scrollable viewport", () => {
    const html = renderMarkdown(DOCUMENT_MARKDOWN, "settled");

    expect(html).toContain("data-markdown-table-scroll=\"true\"");
    expect(html).toContain("aria-label=\"表格，可横向滚动\"");
    expect(html).toContain("tabindex=\"0\"");
    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<th>要素</th>");
    expect(html).toContain("<tbody>");
    expect(html).toContain("<td>通勤用户</td>");
    expect(html).toContain("<h4>执行清单</h4>");
    expect(html).toContain("type=\"checkbox\"");
    expect(html).toContain("<hr/>");
  });

  it("uses the same document structure while streaming and after settlement", () => {
    const settled = renderMarkdown(DOCUMENT_MARKDOWN, "settled");
    const streaming = renderMarkdown(DOCUMENT_MARKDOWN, "streaming");

    expect(streaming.replace("data-markdown-mode=\"streaming\"", "data-markdown-mode=\"settled\""))
      .toBe(settled);
  });

  it("does not execute or mount raw HTML", () => {
    const html = renderMarkdown("<script>window.injected = true</script>\n\n安全正文", "settled");

    expect(html).not.toContain("<script>");
    expect(html).toContain("安全正文");
  });

  it("renders normalized inline and display formulae as accessible KaTeX MathML", () => {
    const normalized = normalizeMarkdownMath([
      "Inline $E=mc^2$ and \\(x+y\\).",
      "",
      "$$a^2+b^2=c^2$$",
      "",
      "\\[\\int_0^1 x^2 dx\\]"
    ].join("\n"));
    const html = renderToStaticMarkup(createElement(MarkdownMathDocument, {
      children: normalized.source,
      components: {}
    }));

    expect(html).toContain("class=\"katex\"");
    expect(html).toContain("<math");
    expect(html).toContain("data-math-display=\"true\"");
    expect(html).toContain("aria-label=\"公式，可横向滚动\"");
    expect(html).toContain("tabindex=\"0\"");
  });

  it("blocks every Markdown image source instead of mounting a network image", () => {
    const html = renderMarkdown([
      "![远程图](https://images.example.test/a.png)",
      "![工作区图](./assets/a.png)",
      "![内嵌图](data:image/png;base64,AAAA)"
    ].join("\n\n"), "settled");

    expect(html).not.toContain("<img");
    expect(html).toContain("打开图片链接");
    expect(html).toContain("工作区图片路径：assets/a.png");
    expect(html).toContain("内嵌图片未加载");
  });

  it("enables only validated Workspace-relative links when a handler exists", () => {
    const html = renderToStaticMarkup(createElement(MarkdownView, {
      children: "[source](./src/main.ts) [escape](../outside.ts) [active](javascript:alert(1))",
      mode: "settled",
      onOpenWorkspacePath: async () => undefined
    }));

    expect(html).toContain("data-markdown-link=\"workspace\"");
    expect(html).toContain("href=\"./src/main.ts\"");
    expect(html).not.toContain("href=\"../outside.ts\"");
    expect(html).not.toContain("href=\"javascript:alert(1)\"");
  });
});

function renderMarkdown(children: string, mode: "settled" | "streaming"): string {
  return renderToStaticMarkup(createElement(MarkdownView, { children, mode }));
}
