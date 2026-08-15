import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  emitMockAgentEvent,
  installMockDesktopBridge,
  replaceMockSessionProjection,
  setMockAgentResponseDelay,
  setMockAgentResponseFailure,
  setMockConversationMessages
} from "./pi67-renderer-fixture.js";
import {
  scenarioCommands,
  scenarioCommandTypes
} from "./pi67-renderer-scenario-commands.js";
import { composerToolbarGeometry } from "./renderer-composer-geometry.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("switches ASK/AUTO directly and confirms current-Task YOLO in the upward Composer menu", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  const addAttachment = page.getByRole("button", { name: "添加附件" });
  const modeButton = page.getByRole("button", { name: "工具执行模式：AUTO" });
  await expect(modeButton).toBeVisible();
  const [addBox, modeBox] = await Promise.all([addAttachment.boundingBox(), modeButton.boundingBox()]);
  expect(addBox).not.toBeNull();
  expect(modeBox).not.toBeNull();
  expect(modeBox?.x).toBeGreaterThan(addBox?.x ?? 0);

  await modeButton.click();
  const menu = page.getByRole("dialog", { name: "工具执行模式" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("radio", { name: /ASK/u })).toBeVisible();
  await expect(menu.getByRole("radio", { name: /AUTO/u })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("radio", { name: /YOLO/u })).toBeVisible();
  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual(modeBox?.y ?? 0);

  await menu.getByRole("radio", { name: /ASK/u }).click();
  await expect(page.getByRole("button", { name: "工具执行模式：ASK" })).toBeVisible();
  await expect.poll(async () => (await scenarioCommands(page)).at(-1)).toMatchObject({
    type: "task.toolMode.set",
    payload: { mode: "ask" }
  });

  await clearRecordedCommands(page);
  await page.getByRole("button", { name: "工具执行模式：ASK" }).click();
  await page.getByRole("radio", { name: /YOLO/u }).click();
  await expect(page.getByText("为当前任务开启 YOLO？", { exact: true })).toBeVisible();
  expect(await scenarioCommandTypes(page)).toEqual([]);
  await page.getByRole("button", { name: "开启 YOLO" }).click();

  await expect(page.getByRole("button", { name: "工具执行模式：YOLO" })).toBeVisible();
  await expect.poll(async () => (await scenarioCommands(page)).at(-1)).toMatchObject({
    type: "task.toolMode.set",
    payload: { mode: "yolo" }
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(await page.evaluate(() => document.documentElement.clientWidth));
});

test("shows the accepted user message without waiting for the first Pi token", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await attachMockAgent(page, [], {}, { terminalDelayMs: 90_000 });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  const composer = page.getByLabel("给 Pi 发送消息");
  const idleGeometry = await composerToolbarGeometry(page);
  await composer.fill("执行一个耗时九十秒的任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();

  await expect(composer).toHaveValue("");
  await expect.poll(() => scenarioCommandTypes(page)).toEqual(["prompt.submit"]);
  const pendingMessage = page.getByRole("article", { name: "用户消息", exact: true });
  await expect(pendingMessage).toHaveCount(1);
  await expect(pendingMessage).toContainText("执行一个耗时九十秒的任务");
  await expect(pendingMessage).toHaveAttribute("data-delivery-status", "accepted");
  await expect(pendingMessage.getByRole("button", { name: "复制消息" })).toBeVisible();
  await expect(pendingMessage.getByRole("button", { name: "编辑消息" })).toHaveCount(0);
  await expect(page.getByText("从一个具体任务开始", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Pi 正在回复", exact: true })).toHaveCount(0);
  const activity = page.locator("[data-turn-activity]");
  await expect(activity).toContainText(/正在准备|正在处理/u);
  const composerRegion = page.getByTestId("composer-region");
  await expect(composerRegion.getByRole("button", { name: "停止" })).toBeVisible();
  await expect(composerRegion.getByRole("button", { name: "发送", exact: true })).toHaveCount(0);
  await expect(composerRegion.getByRole("group", { name: "任务交互模式" })).toHaveCount(0);
  const streamMode = composerRegion.getByRole("button", { name: /运行中消息处理方式/u });
  await expect(streamMode).toContainText("完成后执行");
  await composer.fill("补充一条完成后执行的要求");
  await expect(composerRegion.getByRole("button", { name: "发送", exact: true })).toBeVisible();
  const activeGeometry = await composerToolbarGeometry(page);
  expect(activeGeometry.toolbarRows).toBe(1);
  expect(activeGeometry.toolbarScrollWidth).toBeLessThanOrEqual(activeGeometry.toolbarClientWidth);
  expect(activeGeometry.toolsScrollWidth).toBeLessThanOrEqual(activeGeometry.toolsClientWidth);
  expect(activeGeometry.actionsScrollWidth).toBeLessThanOrEqual(activeGeometry.actionsClientWidth);
  expect(activeGeometry.streamModeTopmost).toBe("control");
  expect(activeGeometry.sendTopmost).toBe("control");
  expect(activeGeometry.stopTopmost).toBe("control");
  expect(activeGeometry.stopRight).toBeGreaterThan(activeGeometry.sendRight);
  expect(activeGeometry.toolbarHeight).toBeLessThanOrEqual(idleGeometry.toolbarHeight + 2);
  await streamMode.click();
  const deliveryMenu = page.getByRole("menu", { name: "运行中消息处理方式" });
  await expect(deliveryMenu.getByRole("menuitemradio", { name: /立即纠偏/u })).toBeVisible();
  await expect(deliveryMenu.getByRole("menuitemradio", { name: /完成后执行/u })).toBeVisible();
  await page.keyboard.press("Escape");
  const geometry = await page.evaluate(() => {
    const user = document.querySelector<HTMLElement>('[data-message-id="pending-user:operation-1"]');
    const turnActivity = document.querySelector<HTMLElement>("[data-turn-activity]");
    const composer = document.querySelector<HTMLElement>('[data-testid="composer-region"]');
    if (!user || !turnActivity || !composer) return undefined;
    return {
      userBottom: user.getBoundingClientRect().bottom,
      activityTop: turnActivity.getBoundingClientRect().top,
      activityBottom: turnActivity.getBoundingClientRect().bottom,
      composerTop: composer.getBoundingClientRect().top
    };
  });
  expect(geometry).toBeDefined();
  expect(geometry!.activityTop).toBeGreaterThanOrEqual(geometry!.userBottom);
  expect(geometry!.composerTop).toBeGreaterThanOrEqual(geometry!.activityBottom);
  await expect(page.getByText(/acknowledgement timed out/u)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(await page.evaluate(() => document.documentElement.clientWidth));
  const [command] = await scenarioCommands(page);
  expect(command?.payload).toMatchObject({
    submissionId: expect.stringMatching(UUID_PATTERN),
    delivery: "new-turn",
    text: "执行一个耗时九十秒的任务"
  });
  await page.screenshot({
    path: "artifacts/visual-review/composer-active-stable.png",
    animations: "disabled"
  });
});

test("reconciles the accepted bubble with the authoritative Pi user entry without duplication", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [], {}, { terminalDelayMs: 90_000 });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  const composer = page.getByLabel("给 Pi 发送消息");
  await composer.fill("你是谁");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const userMessage = page.getByRole("article", { name: "用户消息", exact: true });
  await expect(userMessage).toHaveCount(1);
  await expect(userMessage).toHaveAttribute("data-message-id", "pending-user:operation-1");

  await setMockConversationMessages(page, [{
    id: "authoritative-user-1",
    role: "user",
    parts: [{ type: "text", text: "你是谁" }]
  }]);
  await emitMockAgentEvent(page, {
    type: "conversation.changed",
    payload: { sessionId: "session-test", reason: "user-appended" }
  }, { operationId: "operation-1" });

  await expect.poll(() => scenarioCommandTypes(page)).toEqual(["prompt.submit", "message.page"]);
  await expect(userMessage).toHaveCount(1);
  await expect(userMessage).toHaveAttribute("data-message-id", "authoritative-user-1");
  await expect(userMessage).not.toHaveAttribute("data-delivery-status", "accepted");
  await expect(userMessage).toContainText("你是谁");
  await expect(composer).toHaveAttribute("placeholder", /补充要求/u);
});

test("keeps an accepted Prompt visible when its Operation fails before projection", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [], {}, { terminalDelayMs: 90_000 });
  await page.getByRole("button", { name: "选择工作区" }).click();

  const composer = page.getByLabel("给 Pi 发送消息");
  await composer.fill("保留这条失败的消息");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const userMessage = page.getByRole("article", { name: "用户消息", exact: true });
  await expect(userMessage).toHaveAttribute("data-delivery-status", "accepted");

  await emitMockAgentEvent(page, {
    type: "operation.failed",
    payload: {
      operationId: "operation-1",
      failedAt: Date.now(),
      error: { code: "INTERNAL", message: "Pi runtime stopped", recoverable: true }
    }
  }, { operationId: "operation-1" });

  await expect(composer).toHaveValue("");
  await expect(userMessage).toHaveAttribute("data-delivery-status", "failed");
  await expect(userMessage.getByRole("alert")).toHaveText("发送失败：Pi runtime stopped");
  await expect(page.getByText("从一个具体任务开始", { exact: true })).toHaveCount(0);

  await replaceMockSessionProjection(page, "session-b", []);
  await expect(userMessage).toHaveCount(0);
  await expect(page.getByText("从一个具体任务开始", { exact: true })).toBeVisible();
});

test("keeps IME candidate confirmation separate from prompt submission", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  const composer = page.getByLabel("给 Pi 发送消息");
  await composer.fill("微软拼音候选确认后再发送");
  const compositionResult = await composer.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "微软拼音" }));
    const enter = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      isComposing: true,
      key: "Enter"
    });
    const dispatched = element.dispatchEvent(enter);
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "微软拼音" }));
    return { defaultPrevented: enter.defaultPrevented, dispatched };
  });
  expect(compositionResult).toEqual({ defaultPrevented: false, dispatched: true });
  await expect(composer).toHaveValue("微软拼音候选确认后再发送");
  expect(await scenarioCommandTypes(page)).toEqual([]);

  const legacyImeResult = await composer.evaluate((element) => {
    const enter = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter"
    });
    Object.defineProperty(enter, "keyCode", { configurable: true, value: 229 });
    const dispatched = element.dispatchEvent(enter);
    return { defaultPrevented: enter.defaultPrevented, dispatched };
  });
  expect(legacyImeResult).toEqual({ defaultPrevented: false, dispatched: true });
  await expect(composer).toHaveValue("微软拼音候选确认后再发送");
  expect(await scenarioCommandTypes(page)).toEqual([]);

  await composer.press("Enter");
  await expect.poll(() => scenarioCommandTypes(page)).toEqual(["prompt.submit"]);
  await expect(composer).toHaveValue("");
  const [command] = await scenarioCommands(page);
  expect(command?.payload).toMatchObject({ submissionId: expect.stringMatching(UUID_PATTERN) });
});

test("discovers prompt templates and skills from the slash catalog with keyboard selection", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const composer = page.getByLabel("给 Pi 发送消息");
  await composer.fill("/pl");
  const picker = page.getByTestId("composer-slash-picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("option", { name: /\/plan/u })).toBeVisible();
  await expect(picker.getByRole("option", { name: /\/skill:design-craft/u })).toHaveCount(0);
  await composer.press("Enter");
  await expect(composer).toHaveValue("/plan ");

  await composer.fill("/skill:d");
  await expect(picker.getByRole("option", { name: /\/skill:design-craft/u })).toBeVisible();
  await composer.press("Tab");
  await expect(composer).toHaveValue("/skill:design-craft ");
});

test("adds pasted and dropped attachments without duplicating attachment state", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const composer = page.getByLabel("给 Pi 发送消息");
  await dispatchClipboardImage(composer, "pasted.png");
  await expect(page.getByRole("img", { name: "pasted.png" })).toHaveAttribute("src", /^blob:/u);

  await dispatchClipboardImage(composer, "pasted.png");
  await expect(page.getByRole("img", { name: "pasted.png" })).toHaveCount(1);
  await expect(page.getByRole("alert").filter({ hasText: "pasted.png 已经添加。" })).toBeVisible();
  await page.getByRole("button", { name: "移除附件：pasted.png" }).click();

  const composerShell = page.getByTestId("composer-shell");
  await composerShell.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([1, 2, 3, 4])], "dropped.webp", {
      lastModified: 2,
      type: "image/webp"
    }));
    element.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.getByRole("status").filter({ hasText: "释放以添加附件" })).toBeVisible();
  await composerShell.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([1, 2, 3, 4])], "dropped.webp", {
      lastModified: 2,
      type: "image/webp"
    }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.getByRole("status").filter({ hasText: "释放以添加附件" })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "dropped.webp" })).toHaveAttribute("src", /^blob:/u);
});

test("stages an ordinary file as an opaque ref and keeps its card in the pending user turn", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [], {}, { terminalDelayMs: 90_000 });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  await page.getByLabel("选择附件").setInputFiles({
    name: "requirements.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7", "utf8")
  });
  const composer = page.getByLabel("给 Pi 发送消息");
  const draftAttachment = page.locator('[data-attachment-kind="document"]');
  await expect(draftAttachment).toContainText("requirements.pdf");
  await expect(draftAttachment).toContainText("文档 · 8 B");
  await expect(draftAttachment.getByRole("img")).toHaveCount(0);
  await composer.fill("检查这份需求文档");
  await page.getByRole("button", { name: "发送", exact: true }).click();

  await expect(composer).toHaveValue("");
  await expect(page.getByLabel("待发送附件")).toHaveCount(0);
  const pending = page.getByRole("article", { name: "用户消息", exact: true });
  await expect(pending).toContainText("检查这份需求文档");
  await expect(pending.locator('[data-attachment-kind="document"]')).toContainText("requirements.pdf");
  const [command] = await scenarioCommands(page);
  expect(command?.payload).toMatchObject({
    text: "检查这份需求文档",
    attachments: [{ id: "fixture_attachment_1" }]
  });
  expect(JSON.stringify(command?.payload)).not.toContain("%PDF");
});

test("preserves text and object URL attachments when prompt submission is rejected", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await setMockAgentResponseFailure(page, "prompt.submit", {
    code: "RUNTIME_NOT_READY",
    message: "Pi 运行服务正在恢复",
    recoverable: true
  });
  await clearRecordedCommands(page);

  await page.getByLabel("选择附件").setInputFiles({
    name: "draft.png",
    mimeType: "image/png",
    buffer: Buffer.from("89504e470d0a1a0a", "hex")
  });
  const composer = page.getByLabel("给 Pi 发送消息");
  await composer.fill("不要丢失这份草稿");
  const preview = page.getByRole("img", { name: "draft.png" });
  await expect(preview).toHaveAttribute("src", /^blob:/u);
  await page.getByRole("button", { name: "发送", exact: true }).click();

  await expect(composer).toHaveValue("不要丢失这份草稿");
  await expect(preview).toHaveAttribute("src", /^blob:/u);
  await expect(page.getByText("消息未发送。草稿和附件已保留。")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Pi 未能接收消息" })).toHaveCount(1);
  await expect.poll(() => scenarioCommandTypes(page)).toEqual(["prompt.submit"]);
  const [command] = await scenarioCommands(page);
  expect(command?.payload).toMatchObject({
    submissionId: expect.stringMatching(UUID_PATTERN),
    text: "不要丢失这份草稿",
    attachments: [{ id: "fixture_attachment_1" }]
  });

  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => scenarioCommandTypes(page)).toEqual(["prompt.submit", "prompt.submit"]);
  const [firstAttempt, retryAttempt] = await scenarioCommands(page);
  const firstSubmissionId = (firstAttempt?.payload as { submissionId?: string } | undefined)?.submissionId;
  const retrySubmissionId = (retryAttempt?.payload as { submissionId?: string } | undefined)?.submissionId;
  expect(firstSubmissionId).toBeTruthy();
  expect(retrySubmissionId).toBe(firstSubmissionId);

  await composer.fill("草稿修改后应创建新的提交身份");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => scenarioCommandTypes(page)).toEqual([
    "prompt.submit",
    "prompt.submit",
    "prompt.submit"
  ]);
  const thirdAttempt = (await scenarioCommands(page))[2];
  const thirdSubmissionId = (thirdAttempt?.payload as { submissionId?: string } | undefined)?.submissionId;
  expect(thirdSubmissionId).not.toBe(firstSubmissionId);
});

test("keeps the draft and rotates submission identity when the Session changes before prompt acknowledgement", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [], { "prompt.submit": 250 }, { autoStartOperation: false });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  await page.getByLabel("选择附件").setInputFiles({
    name: "session-bound.png",
    mimeType: "image/png",
    buffer: Buffer.from("89504e470d0a1a0a", "hex")
  });
  const composer = page.getByLabel("给 Pi 发送消息");
  const preview = page.getByRole("img", { name: "session-bound.png" });
  await composer.fill("这份草稿只能由发送时的会话确认");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => scenarioCommandTypes(page)).toEqual(["prompt.submit"]);
  const [firstPrompt] = await scenarioCommands(page);
  const firstSubmissionId = (firstPrompt?.payload as { submissionId?: string } | undefined)?.submissionId;

  await replaceMockSessionProjection(page, "session-b", []);
  await expect(page.getByText("消息未发送。草稿和附件已保留。")).toBeVisible();
  await expect(composer).toHaveValue("这份草稿只能由发送时的会话确认");
  await expect(preview).toHaveAttribute("src", /^blob:/u);
  await expect(page.locator("[data-turn-activity]")).toHaveCount(0);

  await setMockAgentResponseDelay(page, "prompt.submit", 0);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => scenarioCommandTypes(page)).toEqual(["prompt.submit", "prompt.submit"]);
  const promptCommands = await scenarioCommands(page);
  const retrySubmissionId = (promptCommands[1]?.payload as { submissionId?: string } | undefined)?.submissionId;
  expect(firstSubmissionId).toBeTruthy();
  expect(retrySubmissionId).toBeTruthy();
  expect(retrySubmissionId).not.toBe(firstSubmissionId);
  await expect(composer).toHaveValue("");
  const acceptedMessage = page.getByRole("article", { name: "用户消息", exact: true });
  await expect(acceptedMessage).toContainText("这份草稿只能由发送时的会话确认");
  await expect(acceptedMessage.getByRole("img", { name: "session-bound.png" }))
    .toHaveAttribute("src", /^blob:/u);
  await expect(page.getByLabel("待发送附件")).toHaveCount(0);
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function dispatchClipboardImage(
  composer: import("@playwright/test").Locator,
  name: string
): Promise<void> {
  await composer.evaluate((element, fileName) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([1, 2, 3, 4])], fileName, {
      lastModified: 1,
      type: "image/png"
    }));
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer
    }));
  }, name);
}
