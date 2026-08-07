import { expect, test, type Page } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  installMockDesktopBridge,
  recordedCommandDetails,
  setMockAgentResponseFailure
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("shows complete timestamps and calm message actions without model chrome or overflow", async ({ page }, testInfo) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 680, height: 800 });
  const createdAt = Date.UTC(2026, 6, 30, 7, 42, 18);
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "user-history-actions",
    role: "user",
    createdAt,
    parts: [{ type: "text", text: "你是谁？" }]
  }, {
    id: "assistant-history-actions",
    role: "assistant",
    createdAt: createdAt + 60_000,
    model: "claude-opus-4-6",
    parts: [
      { type: "thinking", text: "This must not be copied." },
      { type: "text", text: "我是运行在 Pi 中的助手。" }
    ]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.getByLabel("Pi conversation")).toBeVisible();

  const userMessage = page.locator('[data-message-id="user-history-actions"]');
  const assistantMessage = page.locator('[data-message-id="assistant-history-actions"]');
  const completeDateTime = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/u;
  await expect(userMessage.locator("time")).toHaveText(completeDateTime);
  await expect(assistantMessage.locator("time")).toHaveText(completeDateTime);
  await expect(userMessage.getByRole("button", { name: "复制消息" })).toBeVisible();
  await expect(userMessage.getByRole("button", { name: "编辑消息" })).toBeVisible();
  await expect(assistantMessage.getByRole("button", { name: "复制回答" })).toBeVisible();
  const continueButton = assistantMessage.getByRole("button", { name: "在新任务中继续" });
  await continueButton.focus();
  await expect(continueButton).toBeFocused();
  const continueTooltip = page.getByRole("tooltip", {
    name: "保留当前任务，并在新任务中带着此前上下文继续"
  });
  await expect(continueTooltip).toBeVisible();
  const continueTooltipBox = await continueTooltip.boundingBox();
  const assistantContentBox = await assistantMessage.getByTestId("message-content").boundingBox();
  const assistantFooterBox = await assistantMessage.locator('[data-message-footer="assistant"]').boundingBox();
  if (!continueTooltipBox || !assistantContentBox || !assistantFooterBox) {
    throw new Error("Assistant message action geometry was unavailable");
  }
  expect(continueTooltipBox.x).toBeGreaterThanOrEqual(0);
  expect(continueTooltipBox.y).toBeGreaterThanOrEqual(assistantFooterBox.y + assistantFooterBox.height);
  expect(rectanglesOverlap(continueTooltipBox, assistantContentBox)).toBe(false);
  const editButton = userMessage.getByRole("button", { name: "编辑消息" });
  await editButton.focus();
  const editTooltip = page.getByRole("tooltip", {
    name: "在原位置修改，发送后重新生成后续回答"
  });
  await expect(editTooltip).toBeVisible();
  const editTooltipBox = await editTooltip.boundingBox();
  const userContentBox = await userMessage.getByTestId("message-content").boundingBox();
  const userFooterBox = await userMessage.locator('[data-message-footer="user"]').boundingBox();
  if (!editTooltipBox || !userContentBox || !userFooterBox) {
    throw new Error("User message action geometry was unavailable");
  }
  expect(editTooltipBox.x + editTooltipBox.width).toBeLessThanOrEqual(680);
  expect(editTooltipBox.y).toBeGreaterThanOrEqual(userFooterBox.y + userFooterBox.height);
  expect(rectanglesOverlap(editTooltipBox, userContentBox)).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath("message-tooltip-below.png"),
    animations: "disabled"
  });
  await expect(page.getByText("claude-opus-4-6", { exact: true })).toHaveCount(0);
  expect((await userMessage.getByTestId("message-content").boundingBox())?.width)
    .toBeLessThan(140);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.screenshot({
    path: testInfo.outputPath("message-actions-narrow.png"),
    animations: "disabled"
  });

  await assistantMessage.getByRole("button", { name: "复制回答" }).click();
  await expect(assistantMessage.getByRole("button", { name: "已复制" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("我是运行在 Pi 中的助手。");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => "",
        writeText: async () => { throw new Error("clipboard blocked"); }
      }
    });
  });
  await userMessage.getByRole("button", { name: "复制消息" }).click();
  await expect(page.locator("[data-notification-id]").filter({ hasText: "复制失败，请重试" }))
    .toContainText("clipboard blocked");

  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
});

test("keeps a stable breathing zone between the Transcript and Composer", async ({ page }, testInfo) => {
  const createdAt = Date.UTC(2026, 6, 30, 7, 42, 18);
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "user-composer-spacing",
    role: "user",
    createdAt,
    parts: [{ type: "text", text: "请给出一份完整的实施说明。" }]
  }, {
    id: "assistant-composer-spacing",
    role: "assistant",
    createdAt: createdAt + 60_000,
    parts: [{
      type: "text",
      text: Array.from(
        { length: 14 },
        (_, index) => `第 ${index + 1} 段：说明目标、约束、实施步骤和验收方式。`
      ).join("\n\n")
    }]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const assistantMessage = page.locator('[data-message-id="assistant-composer-spacing"]');
  await assistantMessage.locator('[data-message-footer="assistant"]').scrollIntoViewIfNeeded();
  await expect(assistantMessage).toBeVisible();
  await expectComposerBoundaryGap(page, 30, 34);
  await page.screenshot({
    path: testInfo.outputPath("transcript-composer-spacing.png"),
    animations: "disabled"
  });

  await page.setViewportSize({ width: 1200, height: 700 });
  await assistantMessage.locator('[data-message-footer="assistant"]').scrollIntoViewIfNeeded();
  await expectComposerBoundaryGap(page, 22, 26);
});

async function expectComposerBoundaryGap(
  page: Page,
  minimum: number,
  maximum: number
): Promise<void> {
  const geometry = await page.evaluate(() => {
    const transcript = document.querySelector<HTMLElement>('[data-transcript-region="true"]');
    const composer = document.querySelector<HTMLElement>('[data-testid="composer-shell"]');
    if (!transcript || !composer) return undefined;
    const transcriptBox = transcript.getBoundingClientRect();
    const composerBox = composer.getBoundingClientRect();
    return {
      gap: composerBox.top - transcriptBox.bottom,
      composerBottom: composerBox.bottom,
      viewportHeight: window.innerHeight
    };
  });
  expect(geometry).toBeDefined();
  expect(geometry!.gap).toBeGreaterThanOrEqual(minimum);
  expect(geometry!.gap).toBeLessThanOrEqual(maximum);
  expect(geometry!.composerBottom).toBeLessThanOrEqual(geometry!.viewportHeight);
}

function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number }
): boolean {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

test("edits a historical user message in place and forks only when the modification is sent", async ({ page }) => {
  const createdAt = Date.UTC(2026, 6, 30, 7, 42, 18);
  await page.setViewportSize({ width: 680, height: 800 });
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "user-edit-source",
    role: "user",
    createdAt,
    parts: [{ type: "text", text: "把这个问题改得更具体" }]
  }, {
    id: "assistant-edit-source",
    role: "assistant",
    createdAt: createdAt + 60_000,
    parts: [{ type: "text", text: "原回答" }]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.getByLabel("Pi conversation")).toBeVisible();
  const sourceTaskId = (await recordedCommandDetails(page))
    .find((command) => command.type === "workspace.open")?.context?.taskId;
  expect(sourceTaskId).toEqual(expect.any(String));
  await clearRecordedCommands(page);

  const sourceMessage = page.locator('[data-message-id="user-edit-source"]');
  await sourceMessage.getByRole("button", { name: "编辑消息" }).click();
  const editor = sourceMessage.getByLabel("编辑用户消息");
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("把这个问题改得更具体");
  await expect(page.getByLabel("给 Pi 发送消息")).toHaveValue("");
  expect((await recordedCommandDetails(page)).some((command) => command.type === "session.fork"))
    .toBe(false);

  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  expect((await recordedCommandDetails(page)).some((command) => command.type === "session.fork"))
    .toBe(false);

  await sourceMessage.getByRole("button", { name: "编辑消息" }).click();
  const retryEditor = sourceMessage.getByLabel("编辑用户消息");
  await retryEditor.fill("请用三句话解释这个问题");
  await retryEditor.press("Control+Enter");

  await expect.poll(async () => (
    (await recordedCommandDetails(page))
      .filter((command) => command.type === "session.fork" || command.type === "prompt.submit")
      .map((command) => command.type)
  )).toEqual(["session.fork", "prompt.submit"]);
  const commands = await recordedCommandDetails(page);
  const fork = commands.find((command) => command.type === "session.fork");
  const prompt = commands.find((command) => command.type === "prompt.submit");
  expect(fork).toMatchObject({
    payload: { entryId: "user-edit-source", position: "before" },
    context: { scope: "task", taskId: sourceTaskId, taskGeneration: 1 }
  });
  expect(prompt).toMatchObject({
    payload: { text: "请用三句话解释这个问题", delivery: "new-turn" },
    context: { scope: "task", taskId: sourceTaskId, taskGeneration: 1 }
  });
  await expect(page.locator('[data-testid="message-card"][aria-label="用户消息"]')
    .filter({ hasText: "请用三句话解释这个问题" })).toBeVisible();
  await expect(page.getByLabel("给 Pi 发送消息")).toHaveValue("");
  await expect(page.getByTestId("conversation-row")).toHaveCount(1);
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
});

test("continues from an Assistant answer in a new independent Workbench Task", async ({ page }) => {
  const createdAt = Date.UTC(2026, 6, 30, 7, 42, 18);
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "user-continue-source",
    role: "user",
    createdAt,
    parts: [{ type: "text", text: "请给出一个方案" }]
  }, {
    id: "assistant-continue-source",
    role: "assistant",
    createdAt: createdAt + 60_000,
    parts: [{ type: "text", text: "这是可以带到新任务的回答。" }]
  }], {}, { isolateTaskSnapshots: true });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.getByLabel("Pi conversation")).toBeVisible();
  const sourceTaskCommand = (await recordedCommandDetails(page))
    .find((command) => command.type === "workspace.open");
  const sourceTaskId = sourceTaskCommand?.context?.taskId;
  const sourceSessionId = sourceTaskCommand?.context?.sessionId ?? "session-test";
  const sourceSessionFileIdentity = "session-file-fixture-demo";
  const sourceSessionGeneration = sourceTaskCommand?.context?.sessionGeneration ?? 1;
  expect(sourceTaskId).toEqual(expect.any(String));
  const sourceRow = page.getByTestId("conversation-row").first();
  const sourceConversationId = await sourceRow.getAttribute("data-conversation-id");
  expect(sourceConversationId).toBeTruthy();
  await clearRecordedCommands(page);

  await page.locator('[data-message-id="assistant-continue-source"]')
    .getByRole("button", { name: "在新任务中继续" })
    .click();

  await expect(page.getByTestId("conversation-row")).toHaveCount(2);
  await expect(page.getByTestId("conversation-row").filter({ hasText: "接续：" }))
    .toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-message-id="assistant-continue-source"]')).toBeVisible();
  await expect(page.getByLabel("给 Pi 发送消息")).toHaveValue("");

  const commands = await recordedCommandDetails(page);
  const fork = commands.find((command) => command.type === "session.forkFromTask");
  expect(fork).toBeDefined();
  expect(fork?.payload).toMatchObject({
    sourceTaskId,
    sourceTaskGeneration: 1,
    sourceSessionId,
    sourceSessionFileIdentity,
    sourceSessionGeneration,
    entryId: "assistant-continue-source"
  });
  expect(fork?.context).toMatchObject({
    scope: "task",
    taskGeneration: 1
  });
  expect(fork?.context?.taskId).not.toBe(sourceTaskId);

  await page.locator(`[data-conversation-id=${JSON.stringify(sourceConversationId)}]`).click();
  await expect(page.locator('[data-message-id="user-continue-source"]')).toBeVisible();
  await expect(page.locator('[data-message-id="assistant-continue-source"]')).toBeVisible();
  await expect(page.getByTestId("conversation-row").filter({ hasText: "接续：" }))
    .not.toHaveAttribute("aria-current", "page");
});

test("removes a provisional continuation Task when the Host fork fails", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "assistant-continue-failure",
    role: "assistant",
    createdAt: Date.UTC(2026, 6, 30, 7, 42, 18),
    parts: [{ type: "text", text: "来源任务不能被覆盖。" }]
  }], {}, { isolateTaskSnapshots: true });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.getByLabel("Pi conversation")).toBeVisible();
  await setMockAgentResponseFailure(page, "session.forkFromTask", {
    code: "STALE_SESSION_GENERATION",
    message: "source changed",
    recoverable: true
  });

  await page.locator('[data-message-id="assistant-continue-failure"]')
    .getByRole("button", { name: "在新任务中继续" })
    .click();

  await expect(page.getByTestId("conversation-row")).toHaveCount(1);
  await expect(page.getByTestId("conversation-row").first()).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-message-id="assistant-continue-failure"]')).toBeVisible();
  await expect(page.locator("[data-notification-id]").filter({ hasText: "无法创建接续任务" }))
    .toContainText("source changed");
  await expect.poll(async () => (
    (await recordedCommandDetails(page)).some((command) => command.type === "task.close")
  )).toBe(true);
});
