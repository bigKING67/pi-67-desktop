import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecallRow } from "./MemoryInspectorPanel.js";

describe("Memory Inspector recall feedback", () => {
  it("keeps all five feedback choices beside the recalled item and exposes the settled choice", () => {
    const markup = renderToStaticMarkup(createElement(RecallRow, {
      item: {
        id: "opaque-id",
        title: "团队经验候选 1",
        summary: "",
        source: "shared-experience",
        scope: "team",
        score: 0.87,
        createdAt: 1,
        reason: "enterprise-experience · 8 个候选 · 返回 1 项",
        feedback: "helpful"
      }
    }));
    expect(markup).toContain("评价召回");
    expect(markup).toContain("有用");
    expect(markup).toContain("无关");
    expect(markup).toContain("过期");
    expect(markup).toContain("错范围");
    expect(markup).toContain("错误");
    expect(markup).toContain("data-selected=\"true\"");
  });
});
