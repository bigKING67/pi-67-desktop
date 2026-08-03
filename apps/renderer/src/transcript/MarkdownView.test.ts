import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownView } from "./MarkdownView.js";

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
});

function renderMarkdown(children: string, mode: "settled" | "streaming"): string {
  return renderToStaticMarkup(createElement(MarkdownView, { children, mode }));
}
