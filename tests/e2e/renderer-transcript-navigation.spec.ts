import { expect, test, type Locator } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge,
  type FixtureMessage
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("restores an away-from-bottom reading anchor across a Settings round trip", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, Array.from({ length: 72 }, (_, index) => message(
    `settings-round-trip-${index}`,
    `Settings round-trip transcript ${index}. ${"Reading anchor context. ".repeat(12)}`
  )));
  await page.getByRole("button", { name: "选择工作区" }).click();

  const transcript = page.locator('[data-transcript-region="true"]');
  const scroller = transcript.getByTestId("virtuoso-scroller");
  const latestButton = transcript.getByRole("button", { name: /^回到最新/u });
  await scroller.hover();
  await page.mouse.wheel(0, -900);
  await expect(latestButton).toBeVisible();
  await expect.poll(() => scroller.evaluate((element) => (
    element.scrollHeight - element.clientHeight - element.scrollTop
  ))).toBeGreaterThan(400);
  await expect.poll(() => firstVisibleTranscriptMessageId(scroller)).not.toBeNull();
  const anchorId = await firstVisibleTranscriptMessageId(scroller);
  if (!anchorId) throw new Error("Expected an away-from-bottom transcript anchor.");

  await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
  await expect(page.getByLabel("π 设置")).toBeVisible();
  await page.getByRole("button", { name: "返回工作台" }).click();

  await expect(transcript).toHaveAttribute("data-message-count", "72");
  await expect(transcript.locator(`[data-message-id="${anchorId}"]`)).toBeVisible();
  await expect(latestButton).toBeVisible();
  await expect.poll(() => scroller.evaluate((element) => (
    element.scrollHeight - element.clientHeight - element.scrollTop
  ))).toBeGreaterThan(400);
});

function message(id: string, text: string): FixtureMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

async function firstVisibleTranscriptMessageId(scroller: Locator): Promise<string | null> {
  return scroller.evaluate((element) => {
    const scrollerTop = element.getBoundingClientRect().top;
    const candidates = Array.from(element.querySelectorAll<HTMLElement>("[data-message-id]"));
    return candidates.find((candidate) => candidate.getBoundingClientRect().bottom > scrollerTop + 8)
      ?.dataset.messageId ?? null;
  });
}
