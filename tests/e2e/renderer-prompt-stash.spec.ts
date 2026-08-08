import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge
} from "./pi67-renderer-fixture.js";

test("clears and restores exact Prompt text only after secure persistence acknowledgement", async ({ page }) => {
  await installMockDesktopBridge(page, { composerDraftUpdateDelayMs: 220 });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const composer = page.getByLabel("给 Pi 发送消息");
  const exactText = "  Preserve exact whitespace\n第二行  ";
  await composer.fill(exactText);
  await page.getByRole("button", { name: "Prompt 暂存，0 条" }).click();
  const stash = page.getByRole("dialog", { name: "Prompt 暂存" });
  await stash.getByRole("button", { name: "暂存当前输入" }).click();

  await page.waitForTimeout(100);
  await expect(composer).toHaveValue(exactText);
  await expect(stash.getByRole("button", { name: "暂存当前输入" })).toBeDisabled();
  await expect.poll(() => composer.inputValue()).toBe("");
  await expect(page.getByRole("button", { name: "Prompt 暂存，1 条" })).toBeVisible();

  await page.setViewportSize({ width: 720, height: 520 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const item = stash.getByRole("button", { name: /^Preserve exact whitespace/u });
  await expect(item).toBeEnabled();
  await page.screenshot({
    path: "artifacts/visual-review/prompt-stash-dark-narrow.png",
    animations: "disabled"
  });
  await item.click();
  await expect.poll(() => composer.inputValue()).toBe(exactText);
  await expect(page.getByRole("button", { name: "Prompt 暂存，0 条" })).toBeVisible();
  await expect(composer).toBeFocused();
  expect(await page.evaluate(() => (
    window as unknown as { __pi67ComposerDraftTest: { state(): { drafts: Array<{ text: string }> } } }
  ).__pi67ComposerDraftTest.state().drafts[0]?.text)).toBe(exactText);
});

test("keeps the Composer text when the first Prompt Stash persistence write fails", async ({ page }) => {
  await installMockDesktopBridge(page, { composerDraftFailureCalls: [1] });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const composer = page.getByLabel("给 Pi 发送消息");
  await composer.fill("Do not lose this Prompt");
  await page.getByRole("button", { name: "Prompt 暂存，0 条" }).click();
  await page.getByRole("dialog", { name: "Prompt 暂存" })
    .getByRole("button", { name: "暂存当前输入" })
    .click();

  await expect(composer).toHaveValue("Do not lose this Prompt");
  await expect(page.getByRole("button", { name: "Prompt 暂存，0 条" })).toBeVisible();
  await expect(page.getByText("安全存储未确认最终状态，内容仍保留在当前输入或暂存中。", {
    exact: true
  })).toBeVisible();
  expect(await page.evaluate(() => (
    window as unknown as { __pi67ComposerDraftTest: { state(): { drafts: unknown[] } } }
  ).__pi67ComposerDraftTest.state().drafts)).toEqual([]);
});
