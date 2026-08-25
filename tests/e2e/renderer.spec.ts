import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  emitMockAgentEvent,
  installMockDesktopBridge,
  recordedCommandDetails,
  recordedCommands,
  waitForMockWorkspaceReady
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("opens a trusted Pi workspace through the MessagePort contract", async ({ page }, testInfo) => {
  await page.goto("/");
  await attachMockAgent(page);
  await expect(page.getByRole("heading", { name: "开始一个 Pi 对话" })).toBeVisible();
  await expect(page.getByText("选择一个工作区，继续已有对话或开始新对话。")).toBeVisible();
  await expect(page.getByText("复用现有 Pi 配置和会话")).toBeVisible();
  await expect(page.getByText("数据保存在本机")).toBeVisible();
  await expect(page.getByText(/Pi SDK|Agent Host|内部服务器|agent runtime/u)).toHaveCount(0);
  await expect(page.locator(".brand-lockup")).toHaveCSS("padding-left", "0px");
  expect((await page.locator(".brand-lockup").boundingBox())?.x).toBeGreaterThanOrEqual(78);
  await page.screenshot({ path: testInfo.outputPath("welcome-before.png"), animations: "disabled" });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.getByRole("button", { name: "pi-demo 工作区菜单" })).toBeVisible();
  await expect(page.getByTestId("title-brand-mark")).toHaveCount(0);
  await expect(page.getByText("工作区尚未信任")).toHaveCount(0);
  await expect(page.locator('[data-repository-status="non-git"]')).toContainText("非 Git 目录");
  await expect(page.getByRole("button", { name: /创建 Worktree|删除 Worktree|强制删除/u })).toHaveCount(0);
  await expect(page.getByLabel("Pi conversation")).toBeVisible();
  await expect(page.getByLabel("给 Pi 发送消息")).toBeVisible();
  await expect(page.getByRole("list", { name: "工作区与对话" })).toBeVisible();
  const navigationBrand = page.getByTestId("navigation-brand");
  await expect(navigationBrand).toHaveAccessibleName("Pi-67 对话工作台");
  await expect(navigationBrand.getByText("Pi-67", { exact: true })).toBeVisible();
  await expect(navigationBrand.locator("small")).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "已打开的任务" })).toHaveCount(0);
  await expect(page.locator(".title-actions").getByRole("button", { name: /外观：/u })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开更多菜单" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "帮助与设置" })).toBeVisible();
  await expect(page.locator(".title-actions button").last()).toHaveAttribute("data-testid", "inspector-toggle");
  const conversationBottom = await page.getByLabel("Pi conversation").evaluate((element) => element.getBoundingClientRect().bottom);
  const composerBottom = await page.getByTestId("composer-region").evaluate((element) => element.getBoundingClientRect().bottom);
  expect(Math.abs(conversationBottom - composerBottom)).toBeLessThanOrEqual(1);

  await page.screenshot({ path: testInfo.outputPath("workspace-after.png"), animations: "disabled" });
});

test("gives the first on-demand Pi runtime connection one initialization owner", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择工作区" }).click();

  await expect(page.getByRole("button", { name: "pi-demo 工作区菜单" })).toBeVisible();
  await expect(page.getByText("工作区尚未信任")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "开始一个新对话" })).toBeVisible();
  await expect(page.getByRole("button", { name: "在 pi-demo 新建对话" })).toBeDisabled();

  await attachMockAgent(page);

  await expect.poll(async () => (await recordedCommands(page)).filter((command) => (
    command === "workspace.register"
  )).length).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await recordedCommands(page)).filter((command) => (
    command === "workspace.open"
  ))).toHaveLength(1);
  await expect(page.getByRole("button", { name: "在 pi-demo 新建对话" })).toBeEnabled();
  await expect(page.getByLabel("Pi conversation")).toBeVisible();
});

test("treats a native-picker workspace as trusted without a second confirmation", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect.poll(() => recordedCommandDetails(page)).toContainEqual(expect.objectContaining({
    type: "workspace.open",
    payload: expect.objectContaining({ trust: "trusted" })
  }));
  expect(await recordedCommands(page)).not.toContain("workspace.setTrust");
  await expect(page.getByText("工作区尚未信任")).toHaveCount(0);
});

test("fills the composer from a starter prompt without sending it", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  await page.getByRole("button", { name: "检查当前 Git 改动并找出风险" }).click();
  const composer = page.getByLabel("给 Pi 发送消息");
  await expect(composer).toHaveValue("检查当前 Git 改动并找出风险");
  await expect(composer).toBeFocused();
  expect((await recordedCommands(page)).filter((command) => command === "prompt.submit")).toEqual([]);
});

test("opens Markdown external links through the desktop bridge with link semantics", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "external-link-message",
    role: "assistant",
    parts: [{ type: "text", text: "查看 [Pi 文档](https://example.com/pi-docs)。" }]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const link = page.getByRole("link", { name: "Pi 文档" });
  await expect(link).toHaveAttribute("href", "https://example.com/pi-docs");
  await link.click();
  expect(await page.evaluate(() => (
    window as unknown as { __pi67UpdateTest: { openedUrls: string[] } }
  ).__pi67UpdateTest.openedUrls)).toEqual(["https://example.com/pi-docs"]);
});

test("renders verified declarative Extension Tool Adapter metadata without executable UI", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "adapted-tool-message",
    role: "assistant",
    parts: [{
      type: "tool-call",
      id: "adapted-call",
      name: "bash",
      status: "completed",
      summary: "artifact.json",
      adapter: {
        adapterId: "verified-reader",
        package: "@verified/reader",
        presentation: "read",
        label: "读取制品"
      }
    }]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const process = page.getByTestId("transcript-process-group");
  await expect(process).toBeVisible();
  await expect(process).toHaveAttribute("open", "");
  const card = page.locator('[data-presenter="extension-adapter"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("读取制品");
  await expect(card).toContainText("artifact.json");
  await card.locator(":scope > summary").click();
  await expect(card).toContainText("@verified/reader");
  await expect(card).toContainText("不会加载 Extension 提供的 HTML、脚本或组件");
});

test("imports an external Pi session instead of opening the source file in place", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.getByRole("button", { name: "pi-demo 工作区菜单" })).toBeVisible();
  await expect.poll(async () => (await recordedCommands(page)).includes("session.catalog.query")).toBe(true);
  await clearRecordedCommands(page);

  await page.getByRole("button", { name: "pi-demo 工作区菜单" }).click();
  await page.getByRole("menuitem", { name: "导入 Pi Session" }).click();
  await expect.poll(async () => (await recordedCommands(page)).includes("session.import")).toBe(true);
  await expect(page.locator("[data-turn-activity]")).toHaveCount(0);
  await expect(page.locator("[data-notification-id]").filter({ hasText: "任务已完成" })).toBeVisible();
  const importCommand = (await recordedCommandDetails(page)).find((command) => command.type === "session.import");
  expect(importCommand?.payload).toMatchObject({
    submissionId: expect.stringMatching(/^session-import-/u),
    path: "/Users/test/.pi/agent/sessions/demo.jsonl"
  });

  await page.evaluate(() => {
    const testWindow = window as unknown as {
      pi67: { system: { selectSessionFile(): Promise<string | undefined> } };
    };
    testWindow.pi67.system.selectSessionFile = async () => undefined;
  });
  await clearRecordedCommands(page);
  await page.getByRole("button", { name: "pi-demo 工作区菜单" }).click();
  await page.getByRole("menuitem", { name: "导入 Pi Session" }).click();
  await page.waitForTimeout(50);
  expect(await recordedCommands(page)).not.toContain("session.import");
});

test("serializes new-session transitions and keeps one terminal notification across Toast and history", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [], { "session.create": 1_000 }, {
    isolateTaskSnapshots: true,
    rotateSessionOnCreate: true
  });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  const createButton = page.getByRole("button", { name: "在 pi-demo 新建对话" });
  await createButton.click();
  await expect(page.getByTestId("new-session-intent")).toBeVisible();
  expect((await recordedCommands(page)).filter((command) => command === "session.create"))
    .toHaveLength(0);
  await page.getByRole("textbox", { name: "给 Pi 发送消息" }).fill("验证新会话事务");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(createButton).toBeDisabled();
  await expect(page.locator('[data-runtime-phase="starting"]')).toContainText("正在创建 Pi 新会话");
  await expect.poll(async () => (await recordedCommands(page)).filter((command) => (
    command === "session.create"
  ))).toHaveLength(1);
  await expect.poll(async () => (await recordedCommands(page)).filter((command) => (
    command === "prompt.submit"
  ))).toHaveLength(1);

  const operationId = "operation-1";
  const sessionId = "session-created-1";
  const sessionFileIdentity = "session-file-fixture-1";
  const sessionGeneration = 2;
  await emitMockAgentEvent(page, {
    type: "operation.started",
    payload: {
      operation: {
        operationId,
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId,
        sessionFileIdentity,
        sessionGeneration,
        startedAt: Date.now()
      }
    }
  }, { operationId, sessionId, sessionFileIdentity, sessionGeneration });
  const failure = {
    type: "operation.failed",
    payload: {
      operationId,
      failedAt: Date.now(),
      error: { code: "INTERNAL", message: "重复错误", recoverable: true }
    }
  };
  await emitMockAgentEvent(page, failure, { operationId, sessionId, sessionFileIdentity, sessionGeneration });
  await emitMockAgentEvent(page, failure, { operationId, sessionId, sessionFileIdentity, sessionGeneration });
  const toast = page.locator("[data-notification-id]").filter({ hasText: "任务失败" });
  await expect(toast).toHaveCount(1);
  const closeToast = toast.getByRole("button", { name: "关闭通知：任务失败" });
  await closeToast.focus();
  await expect(toast).toBeVisible();
  await closeToast.click();
  await expect(toast).toHaveCount(0);

  const notificationTrigger = page.locator('button[aria-describedby="notification-center-tooltip"]');
  await expect(notificationTrigger).toHaveAccessibleName("打开通知中心，1 条未读");
  await notificationTrigger.click();
  const center = page.getByRole("dialog", { name: "通知中心" });
  await expect(center).toBeVisible();
  await expect(center.getByRole("listitem").filter({ hasText: "任务失败" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "打开通知中心" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(notificationTrigger).toBeFocused();
});

test("projects operation activities and sends an operation-scoped abort", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);
  await clearRecordedCommands(page);
  const operationId = "operation-status-test";

  await emitMockAgentEvent(page, {
    type: "operation.started",
    payload: {
      operation: {
        operationId,
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-test",
        sessionFileIdentity: "session-file-fixture-demo",
        sessionGeneration: 1,
        startedAt: Date.now()
      }
    }
  }, { operationId });
  await emitMockAgentEvent(page, {
    type: "operation.activityChanged",
    payload: { operationId, activity: { kind: "thinking" } }
  }, { operationId });
  const initialTimeline = page.locator("[data-turn-activity]").filter({ hasText: "正在分析问题" });
  await expect(initialTimeline).toBeVisible();
  await expect(initialTimeline).toHaveAttribute("open", "");
  await expect(initialTimeline.locator("li").getByText("正在分析问题", { exact: true })).toBeVisible();

  await emitMockAgentEvent(page, {
    type: "operation.activityChanged",
    payload: { operationId, activity: { kind: "responding" } }
  }, { operationId });
  await expect(page.locator("[data-turn-activity]").filter({ hasText: "正在组织回复" })).toBeVisible();

  await emitMockAgentEvent(page, {
    type: "operation.activityChanged",
    payload: {
      operationId,
      activity: {
        kind: "tool",
        toolCallId: "tool-1",
        toolName: "bash",
        toolKind: "shell",
        status: "running",
        authorization: { mode: "auto", reason: "workspace-command" }
      }
    }
  }, { operationId });
  const shellStep = page.locator("[data-turn-activity]").filter({ hasText: "正在调用 bash" });
  await expect(shellStep).toBeVisible();
  await expect(shellStep).toContainText("分析问题");
  await expect(shellStep).toContainText("组织回复");
  await expect(shellStep).toContainText("AUTO · 工作区命令");
  await expect(page.getByRole("heading", { name: "需要单次授权" })).toHaveCount(0);

  await emitMockAgentEvent(page, {
    type: "operation.activityChanged",
    payload: { operationId, activity: { kind: "approval", requestId: "approval-1" } }
  }, { operationId });
  const operationStatus = page.locator("[data-turn-activity]").filter({ hasText: "需要你的确认" });
  await expect(operationStatus).toBeVisible();
  await expect(operationStatus.getByRole("button", { name: "停止" })).toHaveCount(0);
  await page.getByTestId("composer-region").getByRole("button", { name: "停止" }).click();
  await expect.poll(async () => (await recordedCommands(page)).filter((command) => (
    command === "operation.abort"
  ))).toEqual(["operation.abort"]);
  expect((await recordedCommandDetails(page)).find((command) => command.type === "operation.abort")?.payload)
    .toEqual({ operationId });

  await emitMockAgentEvent(page, {
    type: "operation.activityChanged",
    payload: { operationId, activity: { kind: "compaction" } }
  }, { operationId });
  await expect(page.locator("[data-turn-activity]").filter({ hasText: "正在压缩上下文" })).toBeVisible();
  await emitMockAgentEvent(page, {
    type: "operation.activityChanged",
    payload: { operationId, activity: null }
  }, { operationId });
  await expect(page.locator("[data-turn-activity]").filter({ hasText: "正在继续处理" })).toBeVisible();
  await emitMockAgentEvent(page, {
    type: "operation.failed",
    payload: {
      operationId,
      failedAt: Date.now(),
      error: { code: "INTERNAL", message: "测试失败", recoverable: true }
    }
  }, { operationId });
  const failedTimeline = page.locator("[data-turn-activity]").filter({ hasText: "执行失败" });
  await expect(failedTimeline).toBeVisible();
  await expect(failedTimeline).toHaveAttribute("open", "");
  await expect(failedTimeline).toContainText("测试失败");

  const completedOperationId = "operation-completed-timeline";
  const completedStartedAt = Date.now() - 3_000;
  await emitMockAgentEvent(page, {
    type: "operation.started",
    payload: {
      operation: {
        operationId: completedOperationId,
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-test",
        sessionFileIdentity: "session-file-fixture-demo",
        sessionGeneration: 1,
        startedAt: completedStartedAt
      }
    }
  }, { operationId: completedOperationId });
  await emitMockAgentEvent(page, {
    type: "operation.activityChanged",
    payload: { operationId: completedOperationId, activity: { kind: "thinking" } }
  }, { operationId: completedOperationId });
  await expect(page.locator("[data-turn-activity]").filter({ hasText: "正在分析问题" })).toBeVisible();
  await emitMockAgentEvent(page, {
    type: "operation.activityChanged",
    payload: {
      operationId: completedOperationId,
      activity: {
        kind: "tool",
        toolCallId: "completed-tool",
        toolName: "read",
        toolKind: "read",
        status: "running"
      }
    }
  }, { operationId: completedOperationId });
  await expect(page.locator("[data-turn-activity]").filter({ hasText: "正在调用 read" })).toBeVisible();
  await emitMockAgentEvent(page, {
    type: "operation.activityChanged",
    payload: {
      operationId: completedOperationId,
      activity: {
        kind: "tool",
        toolCallId: "completed-tool",
        toolName: "read",
        toolKind: "read",
        status: "completed"
      }
    }
  }, { operationId: completedOperationId });
  await expect(page.locator("[data-turn-activity]").filter({ hasText: "调用 read" }))
    .toContainText("已完成");
  await emitMockAgentEvent(page, {
    type: "operation.completed",
    payload: { operationId: completedOperationId, completedAt: completedStartedAt + 3_000 }
  }, { operationId: completedOperationId });
  const completedTimeline = page.locator(
    "[data-turn-activity][data-operation-lifecycle='completed']"
  );
  await expect(completedTimeline).toContainText("执行未完整收口 · 1 次工具调用 · 3 秒");
  await expect(completedTimeline).toHaveAttribute("open", "");
  await expect(completedTimeline).toContainText("分析问题");
  await expect(completedTimeline).toContainText("读取文件");
  const completedTool = completedTimeline.locator('details[data-presenter="read-search"]');
  await expect(completedTool.locator(":scope > summary")).not.toContainText("read");
  await completedTool.locator(":scope > summary").click();
  await expect(completedTool.getByText("read", { exact: true })).toBeVisible();
  await expect(completedTimeline).toContainText("已完成");

  const importOperationId = "operation-import-status-test";
  await emitMockAgentEvent(page, {
    type: "operation.started",
    payload: {
      operation: {
        operationId: importOperationId,
        kind: "session-import",
        lifecycle: "running",
        cancellable: false,
        sessionId: "session-test",
        sessionFileIdentity: "session-file-fixture-demo",
        sessionGeneration: 1,
        startedAt: Date.now()
      }
    }
  }, { operationId: importOperationId });
  const importStatus = page.locator("[data-turn-activity]").filter({ hasText: "正在导入 Pi 会话" });
  await expect(importStatus).toBeVisible();
  await expect(importStatus.getByRole("button", { name: "停止" })).toHaveCount(0);
  await expect(page.getByTestId("composer-region").getByRole("button", { name: "停止" })).toHaveCount(0);
});
