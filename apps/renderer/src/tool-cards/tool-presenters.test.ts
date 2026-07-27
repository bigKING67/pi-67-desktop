import type { ToolCallPart } from "@pi67/domain";
import { describe, expect, it } from "vitest";
import {
  createToolCopyText,
  getToolDisplayName,
  presentToolCall,
  selectToolPresenter,
  TOOL_STATUS_LABELS
} from "./tool-presenters.js";

function tool(overrides: Partial<ToolCallPart> = {}): ToolCallPart {
  return {
    type: "tool-call",
    id: "tool-1",
    name: "unknown",
    status: "completed",
    ...overrides
  };
}

describe("tool presenter registry", () => {
  it("selects namespaced command tools without treating similarly named tools as bash", () => {
    expect(selectToolPresenter(tool({ name: "functions.exec_command" })).id).toBe("bash");
    expect(selectToolPresenter(tool({ name: "bash" })).id).toBe("bash");
    expect(selectToolPresenter(tool({ name: "bashful-reader" })).id).toBe("generic");
  });

  it("prefers verified Extension Adapter metadata over tool-name heuristics", () => {
    const adapted = tool({
      name: "bash",
      adapter: {
        adapterId: "verified-reader",
        package: "@verified/reader",
        presentation: "read",
        label: "读取制品"
      }
    });

    expect(selectToolPresenter(adapted).id).toBe("extension-adapter");
    expect(presentToolCall(adapted)).toMatchObject({
      presenterId: "extension-adapter",
      kind: "read",
      title: "读取制品",
      details: [
        { label: "Extension", value: "@verified/reader" },
        { label: "Adapter", value: "verified-reader" }
      ]
    });
  });

  it("projects command and cwd only when the summary contains them", () => {
    const presentation = presentToolCall(tool({
      name: "bash",
      status: "running",
      summary: JSON.stringify({ command: "pnpm test", cwd: "D:/code/pi-67-desktop" })
    }));

    expect(presentation.compact).toBe("pnpm test");
    expect(presentation.details).toEqual([
      { label: "命令", value: "pnpm test" },
      { label: "工作目录", value: "D:/code/pi-67-desktop" }
    ]);
    expect(presentation.limitations).not.toContain("当前投影未记录工作目录。");
    expect(presentation.limitations.join(" ")).toContain("未记录执行耗时");
  });

  it("keeps unavailable command metadata explicit instead of inventing values", () => {
    const presentation = presentToolCall(tool({ name: "shell", summary: "pnpm test" }));

    expect(presentation.compact).toBe("pnpm test");
    expect(presentation.details).toEqual([]);
    expect(presentation.limitations).toContain("当前投影未记录工作目录。");
    expect(JSON.stringify(presentation)).not.toContain("0ms");
  });

  it("projects read, search, and edit summaries through dedicated presenters", () => {
    const search = presentToolCall(tool({
      name: "mcp__workspace__grep",
      summary: JSON.stringify({ pattern: "operationId", path: "apps/renderer/src" })
    }));
    const edit = presentToolCall(tool({
      name: "edit_file",
      summary: JSON.stringify({ path: "src/client.ts", patch: "bounded patch summary" })
    }));

    expect(search.presenterId).toBe("read-search");
    expect(search.title).toBe("搜索内容");
    expect(search.compact).toBe("operationId · apps/renderer/src");
    expect(edit.presenterId).toBe("edit-write");
    expect(edit.compact).toBe("src/client.ts");
    expect(edit.limitations.join(" ")).toContain("Diff");
  });

  it("bounds displayed and copied text and strips control characters", () => {
    const presentation = presentToolCall(tool({ name: "extension-tool", summary: `line\u0000${"x".repeat(10_000)}` }));
    const copied = createToolCopyText(tool({ name: "extension-tool", summary: "ignored" }), presentation);

    expect(presentation.summary?.length).toBeLessThanOrEqual(3_200);
    expect(presentation.summary).not.toContain("\u0000");
    expect(presentation.summary?.endsWith("…")).toBe(true);
    expect(copied.length).toBeLessThanOrEqual(4_000);
  });

  it("uses visible failure semantics and a generic fallback for unknown tools", () => {
    const value = tool({ name: "extension.custom", status: "failed" });
    const presentation = presentToolCall(value);

    expect(presentation.presenterId).toBe("generic");
    expect(presentation.compact).toBe("当前投影未提供工具摘要");
    expect(TOOL_STATUS_LABELS[value.status]).toBe("执行失败");
    expect(createToolCopyText(value, presentation)).toContain("状态: 执行失败");
  });

  it("bounds untrusted tool names before rendering or copying them", () => {
    const name = `extension.${"x".repeat(10_000)}`;
    const value = tool({ name });
    const presentation = presentToolCall(value);

    expect(getToolDisplayName(name).length).toBeLessThanOrEqual(120);
    expect(presentation.title.length).toBeLessThanOrEqual(120);
    expect(createToolCopyText(value, presentation)).not.toContain("x".repeat(121));
  });
});
