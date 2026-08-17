import { expect, test } from "@playwright/test";
import { MAX_PROMPT_TEXT_CHARS } from "@pi67/protocol";
import {
  attachMockAgent,
  clearRecordedCommands,
  installMockDesktopBridge
} from "./pi67-renderer-fixture.js";
import { scenarioCommandTypes } from "./pi67-renderer-scenario-commands.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("rejects oversized Prompt text without starting a Pi turn or clearing the draft", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  await page.getByLabel("选择附件").setInputFiles({
    name: "oversized-draft.png",
    mimeType: "image/png",
    buffer: Buffer.from("89504e470d0a1a0a", "hex")
  });
  const composer = page.getByLabel("给 Pi 发送消息");
  await composer.fill("x".repeat(MAX_PROMPT_TEXT_CHARS + 1));
  const preview = page.getByRole("img", { name: "oversized-draft.png" });
  await expect(preview).toHaveAttribute("src", /^blob:/u);
  await page.getByRole("button", { name: "发送", exact: true }).click();

  await expect.poll(async () => (await composer.inputValue()).length)
    .toBe(MAX_PROMPT_TEXT_CHARS + 1);
  await expect(preview).toHaveAttribute("src", /^blob:/u);
  await expect(page.getByRole("alert")).toContainText(
    "消息超出 120,000 字符上限（多出 1 个字符）。请缩短或拆分后再发送。"
  );
  expect(await scenarioCommandTypes(page)).toEqual([]);
});
