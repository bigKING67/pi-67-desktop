import type { SessionMessageView } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  hasProcessGroupAfterLatestUser,
  projectTranscriptRows
} from "./transcript-rows.js";

describe("projectTranscriptRows", () => {
  it("renders a Plan proposal as its own Timeline row instead of a system message", () => {
    const rows = projectTranscriptRows([
      message("user-1", "user", [{ type: "text", text: "先做计划" }]),
      message("plan-entry-1", "system", [{
        type: "plan-proposal",
        plan: {
          entryId: "plan-entry-1",
          planId: "plan-1",
          sourceOperationId: "operation-1",
          markdown: "# 实施计划",
          createdAt: 2,
          status: "implemented"
        }
      }]),
      message("assistant-1", "assistant", [{ type: "text", text: "开始执行。" }])
    ]);

    expect(rows).toEqual([
      expect.objectContaining({ kind: "message", key: "user-1" }),
      {
        kind: "plan-proposal",
        key: "plan-entry-1",
        plan: expect.objectContaining({ planId: "plan-1", status: "implemented" })
      },
      expect.objectContaining({ kind: "message", key: "assistant-1" })
    ]);
  });

  it("collapses a Tool chain into one terminal process row", () => {
    const rows = projectTranscriptRows([
      message("user-1", "user", [{ type: "text", text: "查天气" }]),
      message("assistant-tool", "assistant", [{
        type: "tool-call",
        id: "search-1",
        name: "web_search",
        status: "completed"
      }]),
      { ...message("search-1", "tool", [{ type: "text", text: "raw result" }]), toolName: "web_search" },
      message("assistant-final", "assistant", [{ type: "text", text: "最终回答" }])
    ]);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.kind)).toEqual([
      "message",
      "process-group",
      "message"
    ]);
    expect(rows[1]).toMatchObject({
      kind: "process-group",
      key: "assistant-tool:group",
      stepCount: 1,
      toolCount: 1,
      failedToolCount: 0,
      failed: false,
      hasFinalAnswer: true,
      items: [{
        kind: "tool",
        key: "search-1",
        call: { id: "search-1", name: "web_search" },
        result: { id: "search-1", role: "tool" }
      }]
    });
    expect(hasProcessGroupAfterLatestUser(rows)).toBe(true);
  });

  it("keeps an empty Assistant failure visible as a result instead of process noise", () => {
    const rows = projectTranscriptRows([
      message("user-1", "user", [{ type: "text", text: "你是谁" }]),
      {
        ...message("assistant-empty", "assistant", []),
        error: "模型未返回内容"
      }
    ]);

    expect(rows).toEqual([
      expect.objectContaining({ kind: "message", key: "user-1" }),
      expect.objectContaining({ kind: "message", key: "assistant-empty" })
    ]);
    expect(hasProcessGroupAfterLatestUser(rows)).toBe(false);
  });

  it("marks a process group failed when its correlated Tool Call failed", () => {
    const rows = projectTranscriptRows([
      message("assistant-tool", "assistant", [{
        type: "tool-call",
        id: "search-1",
        name: "web_search",
        status: "failed"
      }]),
      {
        ...message("search-1", "tool", [{ type: "text", text: "provider unavailable" }]),
        toolName: "web_search",
        error: "Tool execution failed."
      }
    ]);

    expect(rows.at(-1)).toMatchObject({
      kind: "process-group",
      failed: true,
      failedToolCount: 1,
      stepCount: 1,
      toolCount: 1
    });
  });

  it("separates visible reasoning from the final Assistant answer", () => {
    const rows = projectTranscriptRows([
      message("user-1", "user", [{ type: "text", text: "分析问题" }]),
      message("assistant-final", "assistant", [
        { type: "thinking", text: "先核对实际源码。" },
        { type: "text", text: "最终结论" }
      ])
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({
      kind: "process-group",
      key: "assistant-final:process:group",
      stepCount: 1,
      items: [{
        kind: "reasoning",
        key: "assistant-final:process:reasoning:0",
        text: "先核对实际源码。"
      }],
      hasFinalAnswer: true
    });
    expect(rows[2]).toMatchObject({
      kind: "message",
      key: "assistant-final",
      message: {
        id: "assistant-final",
        parts: [{ type: "text", text: "最终结论" }]
      }
    });
  });

  it("keeps reasoning order while pairing each Tool Call with its Tool Result", () => {
    const rows = projectTranscriptRows([
      message("user-1", "user", [{ type: "text", text: "检查实现" }]),
      message("assistant-process", "assistant", [
        { type: "thinking", text: "先读取入口。" },
        {
          type: "tool-call",
          id: "read-1",
          name: "read",
          status: "completed",
          summary: "{\"path\":\"src/index.ts\"}"
        }
      ]),
      { ...message("read-1", "tool", [{ type: "text", text: "export const ready = true;" }]), toolName: "read" },
      message("assistant-final", "assistant", [
        { type: "thinking", text: "入口已经确认。" },
        { type: "text", text: "最终结论" }
      ])
    ]);

    expect(rows[1]).toMatchObject({
      kind: "process-group",
      stepCount: 3,
      toolCount: 1,
      failedToolCount: 0,
      items: [
        { kind: "reasoning", text: "先读取入口。" },
        {
          kind: "tool",
          call: { id: "read-1", name: "read" },
          result: { id: "read-1", toolName: "read" }
        },
        { kind: "reasoning", text: "入口已经确认。" }
      ]
    });
  });

  it("keeps an unmatched Tool Result as an inspectable compatibility step", () => {
    const rows = projectTranscriptRows([
      {
        ...message("orphan-result", "tool", [{ type: "text", text: "legacy result" }]),
        toolName: "legacy_tool"
      }
    ]);

    expect(rows).toEqual([expect.objectContaining({
      kind: "process-group",
      stepCount: 1,
      toolCount: 1,
      failedToolCount: 0,
      hasFinalAnswer: false,
      items: [expect.objectContaining({
        kind: "orphan-tool-result",
        result: expect.objectContaining({ id: "orphan-result" })
      })]
    })]);
  });

  it("keeps narration as an ordered process step instead of merging it into reasoning", () => {
    const rows = projectTranscriptRows([
      message("assistant-process", "assistant", [
        { type: "thinking", text: "先搜索资料。" },
        { type: "text", text: "已经找到线索，正在获取内容。" },
        {
          type: "tool-call",
          id: "search-content",
          name: "get_search_content",
          status: "completed"
        }
      ])
    ]);

    expect(rows[0]).toMatchObject({
      kind: "process-group",
      stepCount: 3,
      toolCount: 1,
      failedToolCount: 0,
      items: [
        { kind: "reasoning", text: "先搜索资料。" },
        { kind: "narration", content: "已经找到线索，正在获取内容。" },
        { kind: "tool", call: { id: "search-content" } }
      ]
    });
  });
});

function message(
  id: string,
  role: SessionMessageView["role"],
  parts: SessionMessageView["parts"]
): SessionMessageView {
  return { id, role, parts };
}
