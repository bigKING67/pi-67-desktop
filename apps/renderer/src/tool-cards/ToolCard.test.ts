import type { ToolCallPart } from "@pi67/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolCard } from "./ToolCard.js";

describe("ToolCard", () => {
  it("shows nested identity and the persisted-summary boundary", () => {
    const html = renderToStaticMarkup(createElement(ToolCard, { tool: tool({ status: "failed", execution: {
      toolCallId: "root/1", parentToolCallId: "root", toolName: "bash", toolKind: "shell",
      status: "failed", projectionSource: "durable", resultState: "present"
    } }) }));
    expect(html).toContain('data-parent-tool-call-id="root"');
    expect(html).toContain("子调用");
    expect(html).toContain("上级调用");
    expect(html).toContain("独立工具输出未保留在会话中");
  });

  it("opens incomplete nested records without claiming the script failed", () => {
    const html = renderToStaticMarkup(createElement(ToolCard, { tool: tool({ name: "codemode", execution: {
      toolCallId: "root", toolName: "codemode", toolKind: "generic", status: "completed",
      projectionSource: "durable", resultState: "present", nestedRecord: { complete: false }
    } }) }));
    expect(html).toContain('data-nested-incomplete="true"');
    expect(html).toContain('data-tool-status="completed"');
    expect(html).toContain("子调用记录不完整");
    expect(html).toContain('open=""');
  });
  it("shows projected command lifecycle metadata and the real failure", () => {
    const html = renderToStaticMarkup(createElement(ToolCard, { tool: tool({
      status: "failed",
      execution: {
        toolCallId: "tool-1",
        toolName: "bash",
        toolKind: "shell",
        status: "failed",
        projectionSource: "durable",
        resultState: "present",
        command: { text: "pnpm test", truncated: false },
        cwd: "D:/code/pi-67-desktop",
        progress: { text: "1 test failed", truncated: false },
        durationMs: 1_250,
        failure: {
          detailState: "available",
          source: "pi-result",
          message: { text: "AssertionError: expected true", truncated: false }
        }
      }
    }) }));

    expect(html).toContain('data-tool-status="failed"');
    expect(html).toContain("pnpm test");
    expect(html).toContain("D:/code/pi-67-desktop");
    expect(html).toContain("1.3 s");
    expect(html).toContain("1 test failed");
    expect(html).toContain("AssertionError: expected true");
    expect(html).not.toContain("当前投影未记录工作目录");
    expect(html).not.toContain("当前投影未记录执行耗时或实时输出");
  });

  it("uses an explicit integrity message when no Tool Result can be reconciled", () => {
    const html = renderToStaticMarkup(createElement(ToolCard, {
      tool: tool({ status: "unreconciled" })
    }));

    expect(html).toContain("该步骤未找到可核对的 Tool Result，结果未能确认。");
    expect(html).not.toContain("工具报告执行失败，但当前投影没有失败详情。");
  });

  it("uses the exact missing-error fallback only when failure detail is absent", () => {
    const html = renderToStaticMarkup(createElement(ToolCard, { tool: tool({ status: "failed" }) }));

    expect(html).toContain("该步骤失败，但 Pi 结果中没有可显示的错误详情。");
  });
});

function tool(overrides: Partial<ToolCallPart> = {}): ToolCallPart {
  return {
    type: "tool-call",
    id: "tool-1",
    name: "bash",
    status: "completed",
    ...overrides
  };
}
