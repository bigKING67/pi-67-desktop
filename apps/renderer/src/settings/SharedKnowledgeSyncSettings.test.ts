import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SharedKnowledgeSyncSettings } from "./SharedKnowledgeSyncSettings.js";

vi.mock("../context-memory/context-memory-controller.js", () => ({ syncEnterpriseKnowledge: vi.fn(), buildEnterpriseKnowledgeIndex: vi.fn() }));
it("offers separate team/project actions with honest local-only copy", () => {
  const html = renderToStaticMarkup(createElement(SharedKnowledgeSyncSettings, { teamId: "team", projectId: "project" }));
  expect(html).toContain("同步团队内容"); expect(html).toContain("同步当前项目");
  expect(html).toContain("不上传私人记忆");
  expect(html).toContain("构建团队索引"); expect(html).toContain("构建当前项目索引");
  expect(html).toContain("可能产生模型费用"); expect(html).toContain("独立团队运行包");
  expect(html).not.toContain("disabled");
  expect(html).not.toContain("取消同步");
});
it("disables the project action without an explicitly bound project", () => {
  const html = renderToStaticMarkup(createElement(SharedKnowledgeSyncSettings, { teamId: "team" }));
  expect(html).toMatch(/<button[^>]*disabled[^>]*>同步当前项目<\/button>/u);
  expect(html).not.toMatch(/<button[^>]*disabled[^>]*>同步团队内容<\/button>/u);
  expect(html).toMatch(/<button[^>]*disabled[^>]*>构建当前项目索引<\/button>/u);
  expect(html).not.toMatch(/<button[^>]*disabled[^>]*>构建团队索引<\/button>/u);
});
