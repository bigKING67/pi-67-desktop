import { expect, test, type Page } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  installMockDesktopBridge,
  recordedCommandDetails,
  replaceMockSessionProjection,
  setMockAgentResponseDelay,
  setMockAgentResponseFailure
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("clears the composer on prompt acknowledgement without waiting for a long operation", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [], {}, { terminalDelayMs: 90_000 });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  const composer = page.getByLabel("给 Pi 发送消息");
  await composer.fill("执行一个耗时九十秒的任务");
  await page.getByRole("button", { name: "发送", exact: true }).click();

  await expect(composer).toHaveValue("");
  await expect.poll(() => scenarioCommandTypes(page)).toEqual(["prompt.submit"]);
  await expect(page.getByRole("status").filter({ hasText: /任务已接收|Pi 正在执行任务/u })).toBeVisible();
  await expect(page.getByText(/acknowledgement timed out/u)).toHaveCount(0);
  const [command] = await scenarioCommands(page);
  expect(command?.payload).toMatchObject({
    submissionId: expect.stringMatching(UUID_PATTERN),
    delivery: "new-turn",
    text: "执行一个耗时九十秒的任务"
  });
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

test("adds pasted and dropped images without duplicating attachment state", async ({ page }) => {
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
  await expect(page.getByRole("status").filter({ hasText: "释放以添加图片" })).toBeVisible();
  await composerShell.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([1, 2, 3, 4])], "dropped.webp", {
      lastModified: 2,
      type: "image/webp"
    }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.getByRole("status").filter({ hasText: "释放以添加图片" })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "dropped.webp" })).toHaveAttribute("src", /^blob:/u);
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

  await page.getByLabel("选择图片附件").setInputFiles({
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
    images: [{ name: "draft.png", mimeType: "image/png", bytes: 8 }]
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

  await page.getByLabel("选择图片附件").setInputFiles({
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
  await expect(page.getByRole("status").filter({ hasText: "Pi 正在执行任务" })).toHaveCount(0);

  await setMockAgentResponseDelay(page, "prompt.submit", 0);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => scenarioCommandTypes(page)).toEqual(["prompt.submit", "prompt.submit"]);
  const promptCommands = await scenarioCommands(page);
  const retrySubmissionId = (promptCommands[1]?.payload as { submissionId?: string } | undefined)?.submissionId;
  expect(firstSubmissionId).toBeTruthy();
  expect(retrySubmissionId).toBeTruthy();
  expect(retrySubmissionId).not.toBe(firstSubmissionId);
  await expect(composer).toHaveValue("");
  await expect(preview).toHaveCount(0);
});

const WORKBENCH_SETUP_OR_READ_COMMANDS = new Set([
  "workspace.open",
  "workspace.register",
  "workspace.changes",
  "session.catalog.query"
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function scenarioCommands(page: Page): Promise<Awaited<ReturnType<typeof recordedCommandDetails>>> {
  return (await recordedCommandDetails(page))
    .filter((command) => !WORKBENCH_SETUP_OR_READ_COMMANDS.has(command.type));
}

async function scenarioCommandTypes(page: Page): Promise<string[]> {
  return (await scenarioCommands(page)).map((command) => command.type);
}

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
