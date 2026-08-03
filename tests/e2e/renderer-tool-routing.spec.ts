import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  emitMockAgentEvent,
  installMockDesktopBridge
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("shows a Claude-style Bash alias as failed and keeps the exact-tool recovery once", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [
    {
      id: "assistant-bash-call",
      role: "assistant",
      parts: [{
        type: "tool-call",
        id: "bash-call-1",
        name: "Bash",
        status: "failed"
      }]
    },
    {
      id: "bash-call-1",
      role: "tool",
      toolName: "Bash",
      error: "Tool execution failed.",
      parts: [{
        type: "text",
        text: "工具名称不匹配：当前 Pi 会话没有注册 \"Bash\"。当前会话中对应的精确工具名是 \"bash\"；请按照它的 Pi 参数结构重试。网页检索（包括天气等时效信息）请直接调用 \"web_search\"。这只表示刚才使用了错误的工具名，不表示所有工具不可用。"
      }]
    }
  ]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const process = page.getByTestId("transcript-process-group");
  await expect(process).toBeVisible();
  await expect(process).toHaveAttribute("open", "");
  const toolCard = page.locator('[data-tool-status="failed"]');
  await expect(toolCard).toBeVisible();
  await expect(toolCard).toHaveAttribute("open", "");
  await expect(toolCard).toContainText("Bash");
  await expect(toolCard).toContainText("执行失败");
  await expect(toolCard.locator("pre").last()).toBeVisible();
  await expect(toolCard).toContainText("当前 Pi 会话没有注册 \"Bash\"");
  await expect(toolCard).toContainText("精确工具名是 \"bash\"");
  await expect(toolCard).toContainText("请直接调用 \"web_search\"");
  await expect(page.getByText("Tool execution failed.", { exact: true })).toHaveCount(0);
});

test("collapses a recovered Tool failure after a final answer", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [
    {
      id: "user-recovered-tool",
      role: "user",
      parts: [{ type: "text", text: "查找资料后回答" }]
    },
    {
      id: "assistant-recovered-tool-call",
      role: "assistant",
      parts: [{
        type: "tool-call",
        id: "recovered-tool-call",
        name: "get_search_content",
        status: "failed"
      }]
    },
    {
      id: "recovered-tool-call",
      role: "tool",
      toolName: "get_search_content",
      error: "Stored result was unavailable.",
      parts: [{ type: "text", text: "结果引用已过期。" }]
    },
    {
      id: "assistant-recovered-final",
      role: "assistant",
      parts: [{ type: "text", text: "已通过其他只读来源完成回答。" }]
    }
  ]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const process = page.getByTestId("transcript-process-group");
  await expect(process).toBeVisible();
  await expect(process.locator(":scope > summary")).toContainText("执行过程有失败 · 1 次工具调用 · 1 次失败");
  await expect(process).not.toHaveAttribute("open", "");
  await expect(page.getByText("已通过其他只读来源完成回答。", { exact: true })).toBeVisible();
  await expect(page.getByText("结果引用已过期。", { exact: true })).not.toBeVisible();

  await process.locator(":scope > summary").click();
  await expect(page.getByText("结果引用已过期。", { exact: true })).toBeVisible();
});

test("does not render an empty reasoning disclosure when the provider exposes only a signature", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "assistant-empty-reasoning",
    role: "assistant",
    parts: [
      { type: "thinking", text: "" },
      { type: "text", text: "最终回答" }
    ]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  await expect(page.getByText("最终回答", { exact: true })).toBeVisible();
  await expect(page.getByText("推理过程", { exact: true })).toHaveCount(0);
});

test("keeps visible final-answer reasoning in the collapsible execution process", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "assistant-reasoned-answer",
    role: "assistant",
    parts: [
      { type: "thinking", text: "先检查实际源码，再形成结论。" },
      { type: "text", text: "最终回答" }
    ]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const process = page.getByTestId("transcript-process-group");
  await expect(process).toBeVisible();
  await expect(process).not.toHaveAttribute("open", "");
  await expect(page.getByText("最终回答", { exact: true })).toBeVisible();
  await expect(page.getByText("先检查实际源码，再形成结论。", { exact: true })).not.toBeVisible();

  await process.locator(":scope > summary").click();
  await expect(page.getByText("先检查实际源码，再形成结论。", { exact: true })).toBeVisible();
});

test("shows an empty model response as a recoverable error instead of unsupported content", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "assistant-empty",
    role: "assistant",
    model: "claude-sonnet-4-5",
    parts: [],
    error: "模型未返回内容，请重试；若持续出现，请切换模型或检查模型服务配置。"
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  await expect(page.getByText("模型未返回内容，请重试；若持续出现，请切换模型或检查模型服务配置。", { exact: true })).toBeVisible();
  await expect(page.getByText("Unsupported message content", { exact: true })).toHaveCount(0);
});

test("keeps the settled process collapsed and renders Tool output as a bounded log surface", async ({ page }) => {
  const rawResult = `天气预报：杭州\n${"0123456789".repeat(120)}`;
  await page.goto("/");
  await attachMockAgent(page, [
    {
      id: "user-weather",
      role: "user",
      parts: [{ type: "text", text: "杭州天气" }]
    },
    {
      id: "assistant-search",
      role: "assistant",
      parts: [{
        type: "tool-call",
        id: "search-weather",
        name: "web_search",
        status: "completed",
        summary: "{\"query\":\"杭州天气\"}"
      }]
    },
    {
      id: "search-weather",
      role: "tool",
      toolName: "web_search",
      parts: [{ type: "text", text: rawResult }]
    },
    {
      id: "assistant-weather",
      role: "assistant",
      parts: [{ type: "text", text: "杭州今天有雷阵雨。" }]
    }
  ]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const process = page.getByTestId("transcript-process-group");
  await expect(process).toBeVisible();
  await expect(process).toContainText("执行过程");
  await expect(page.getByText("杭州今天有雷阵雨。", { exact: true })).toBeVisible();
  await expect(page.getByText(rawResult, { exact: true })).not.toBeVisible();

  await process.locator(":scope > summary").click();
  const tool = page.locator('[data-tool-status="completed"]');
  await expect(tool).toBeVisible();
  await expect(tool.locator(":scope > summary")).toContainText("搜索内容");
  await expect(tool.locator(":scope > summary")).toContainText("杭州天气");
  await expect(tool.locator(":scope > summary")).not.toContainText("web_search");
  await expect(tool.locator(":scope > summary")).not.toContainText("{\"query\"");
  await expect(tool).not.toHaveAttribute("open", "");
  await expect(page.getByText(rawResult, { exact: true })).not.toBeVisible();
  await tool.locator(":scope > summary").click();
  await expect(tool).toHaveAttribute("open", "");
  await expect(tool.getByText("精确工具", { exact: true })).toBeVisible();
  await expect(tool.getByText("web_search", { exact: true })).toBeVisible();
  const log = tool.locator("pre").last();
  await expect(log).toBeVisible();
  await expect(log).toHaveCSS("font-family", /monospace|Mono/u);
  await expect(tool.getByRole("button", { name: "展开全部" })).toBeVisible();
});

test("expands the current execution process and collapses it when the operation settles", async ({ page }) => {
  const operationId = "operation-process-auto-collapse";
  await page.goto("/");
  await attachMockAgent(page, [
    {
      id: "user-current-process",
      role: "user",
      parts: [{ type: "text", text: "检查当前实现" }]
    },
    {
      id: "assistant-current-process",
      role: "assistant",
      parts: [
        { type: "thinking", text: "正在定位调用链。" },
        { type: "text", text: "已经找到入口，正在读取文件。" },
        {
          type: "tool-call",
          id: "read-current-process",
          name: "read",
          status: "completed",
          summary: "{\"path\":\"src/index.ts\"}"
        }
      ]
    },
    {
      id: "read-current-process",
      role: "tool",
      toolName: "read",
      parts: [{ type: "text", text: "export const ready = true;" }]
    },
    {
      id: "assistant-current-result",
      role: "assistant",
      parts: [{ type: "text", text: "入口已经确认。" }]
    }
  ]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const process = page.getByTestId("transcript-process-group");
  await expect(process).not.toHaveAttribute("open", "");

  await emitMockAgentEvent(page, {
    type: "operation.started",
    payload: {
      operation: {
        operationId,
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-test",
        sessionGeneration: 1,
        startedAt: Date.now()
      }
    }
  }, { operationId });

  await expect(process).toHaveAttribute("open", "");
  await expect(process).toContainText("正在继续处理");
  await expect(page.getByText("正在定位调用链。", { exact: true })).toBeVisible();
  await expect(process.getByText("进度", { exact: true })).toBeVisible();
  await expect(page.getByText("已经找到入口，正在读取文件。", { exact: true })).toBeVisible();
  await expect(page.getByText("入口已经确认。", { exact: true })).toBeVisible();
  const currentTool = page.locator('[data-tool-status="completed"]');
  await expect(currentTool).toBeVisible();
  await expect(page.getByText("export const ready = true;", { exact: true })).not.toBeVisible();
  await currentTool.locator(":scope > summary").click();
  await expect(page.getByText("export const ready = true;", { exact: true })).toBeVisible();

  await emitMockAgentEvent(page, {
    type: "operation.completed",
    payload: { operationId, completedAt: Date.now() }
  }, { operationId });

  await expect(process).not.toHaveAttribute("open", "");
  await expect(process.locator(":scope > summary")).toContainText("执行过程 · 1 次工具调用");
  await expect(page.getByText("export const ready = true;", { exact: true })).not.toBeVisible();
});

test("shows Runtime-authored AUTO reasons while running and preserves them after collapse", async ({ page }) => {
  const operationId = "operation-auto-reasons";
  await page.setViewportSize({ width: 720, height: 760 });
  await page.goto("/");
  await attachMockAgent(page, [
    {
      id: "user-auto-reasons",
      role: "user",
      parts: [{ type: "text", text: "检查配置、源码和写入路径" }]
    },
    {
      id: "assistant-auto-reasons",
      role: "assistant",
      parts: [
        { type: "thinking", text: "先读取配置，再执行 Workspace 内写入。" },
        { type: "text", text: "检查完成。" }
      ]
    }
  ]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const process = page.getByTestId("transcript-process-group");
  await expect(process).not.toHaveAttribute("open", "");
  await emitMockAgentEvent(page, {
    type: "operation.started",
    payload: {
      operation: {
        operationId,
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-test",
        sessionGeneration: 1,
        startedAt: Date.now()
      }
    }
  }, { operationId });

  const activities = [
    {
      toolCallId: "configured-tool",
      toolName: "subagent",
      toolKind: "subagent",
      authorization: { mode: "auto", reason: "configured-source" }
    },
    {
      toolCallId: "read-tool",
      toolName: "read",
      toolKind: "read",
      authorization: { mode: "auto", reason: "read-only" }
    },
    {
      toolCallId: "write-tool",
      toolName: "edit",
      toolKind: "edit",
      authorization: { mode: "auto", reason: "workspace-write" }
    }
  ] as const;
  for (const activity of activities) {
    await emitMockAgentEvent(page, {
      type: "operation.activityChanged",
      payload: {
        operationId,
        activity: { kind: "tool", status: "running", ...activity }
      }
    }, { operationId });
  }

  const autoReasons = process.locator('[data-tool-authorization="auto"]');
  await expect(process).toHaveAttribute("open", "");
  await expect(autoReasons).toHaveCount(3);
  await expect(process.getByText("AUTO · 已配置来源", { exact: true })).toBeVisible();
  await expect(process.getByText("AUTO · 只读", { exact: true })).toBeVisible();
  await expect(process.getByText("AUTO · Workspace 内写入", { exact: true })).toBeVisible();

  await emitMockAgentEvent(page, {
    type: "operation.activityChanged",
    payload: { operationId, activity: { kind: "approval", requestId: "dangerous-operation" } }
  }, { operationId });
  await expect(process.getByText("等待你确认后继续执行。", { exact: true })).toBeVisible();
  await expect(autoReasons).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);

  await emitMockAgentEvent(page, {
    type: "operation.completed",
    payload: { operationId, completedAt: Date.now() }
  }, { operationId });
  await expect(process).not.toHaveAttribute("open", "");
  await process.locator(":scope > summary").click();
  await expect(autoReasons).toHaveCount(3);
  await expect(process.getByText("AUTO · Workspace 内写入", { exact: true })).toBeVisible();
});
