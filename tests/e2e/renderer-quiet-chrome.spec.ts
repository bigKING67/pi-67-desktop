import { expect, test } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("keeps conversation chrome quiet: no default origin line, no turn hairlines, full thinking value", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 920 });
  const createdAt = Date.UTC(2026, 9, 7, 5, 0, 0);
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "user-quiet-chrome",
    role: "user",
    createdAt,
    parts: [{ type: "text", text: "你好" }]
  }, {
    id: "assistant-quiet-chrome",
    role: "assistant",
    createdAt: createdAt + 1_000,
    parts: [{ type: "text", text: "你好！有什么我可以帮你的吗？" }]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  const conversation = page.getByLabel("Pi conversation");
  await expect(conversation).toBeVisible();
  const assistantMessage = page.locator('[data-message-id="assistant-quiet-chrome"]');
  await expect(assistantMessage).toBeVisible();

  // Unverified history is the quiet default and renders no origin line.
  await expect(conversation.getByLabel("会话来源")).toHaveCount(0);
  // Turns separate by rhythm alone.
  expect(await assistantMessage.evaluate((element) => getComputedStyle(element).borderBottomWidth)).toBe("0px");

  const thinkingValue = page.locator('button[data-runtime-select="thinking"] span').first();
  await expect(thinkingValue).toHaveText(/^思考：/u);
  expect(await thinkingValue.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  const stash = page.getByRole("button", { name: /^Prompt 暂存/u });
  expect(await stash.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
});

test("paints exactly one command palette highlight under mixed pointer and keyboard input", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByLabel("给 Pi 发送消息").focus();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "命令面板" });
  await expect(palette).toBeVisible();

  const options = palette.getByRole("option");
  await expect(options.nth(2)).toBeVisible();
  await options.nth(1).hover();
  await page.keyboard.press("ArrowDown");

  const painted = await options.evaluateAll((elements) => elements
    .filter((element) => getComputedStyle(element).backgroundColor !== "rgba(0, 0, 0, 0)")
    .map((element) => element.getAttribute("aria-selected")));
  expect(painted).toEqual(["true"]);
});
