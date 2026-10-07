import { expect, test, type Page } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge, waitForMockWorkspaceReady } from "./pi67-renderer-fixture.js";

const wideRow = "| dataops-api-quick-regression.yml | pull_request(main)、workflow_dispatch | schedule 18:30 UTC | disabled_manually | 需要手动触发并核对 secrets |";
const markdown = [
  "正文保持阅读宽度，不随表格和代码变宽。".repeat(6),
  ["| Workflow | 触发 | 定时 | 当前远端状态 | 备注 |", "| --- | --- | --- | --- | --- |", wideRow, wideRow].join("\n"),
  ["| 键 | 值 |", "| --- | --- |", "| A | 1 |"].join("\n"),
  "```\n" + "const value = compute(alpha, beta, gamma, delta);".repeat(4) + "\n```"
].join("\n\n");

async function openAnswer(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page, [{ id: "wide-content", role: "assistant", parts: [{ type: "text", text: markdown }] }]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);
  const answer = page.locator('[data-message-role="assistant"]');
  await expect(answer.getByRole("table").first()).toBeVisible();
  return answer;
}

test("lets Assistant tables and code break out of the reading track when the Transcript is wide", async ({ page }) => {
  const answer = await openAnswer(page, 1600);
  const [prose, wideTable, smallTable, code] = await Promise.all([
    answer.locator("p").first().boundingBox(),
    answer.locator('[data-markdown-table-scroll="true"]').nth(0).boundingBox(),
    answer.locator('[data-markdown-table-scroll="true"]').nth(1).boundingBox(),
    answer.getByTestId("code-block").boundingBox()
  ]);
  const proseCenter = (prose?.x ?? 0) + (prose?.width ?? 0) / 2;
  expect(prose?.width ?? 0).toBeLessThanOrEqual(801);
  expect(wideTable?.width ?? 0).toBeGreaterThan((prose?.width ?? 0) + 40);
  expect(wideTable?.width ?? 0).toBeLessThanOrEqual(1041);
  expect(Math.abs((wideTable?.x ?? 0) + (wideTable?.width ?? 0) / 2 - proseCenter)).toBeLessThan(2);
  expect(Math.abs((smallTable?.width ?? 0) - (prose?.width ?? 0))).toBeLessThan(2);
  expect(Math.abs((smallTable?.x ?? 0) - (prose?.x ?? 0))).toBeLessThan(2);
  expect(code?.width ?? 0).toBeGreaterThan((prose?.width ?? 0) + 40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("keeps tables and code inside the reading track when the Transcript is narrow", async ({ page }) => {
  const answer = await openAnswer(page, 900);
  const [prose, wideTable, code] = await Promise.all([
    answer.locator("p").first().boundingBox(),
    answer.locator('[data-markdown-table-scroll="true"]').nth(0).boundingBox(),
    answer.getByTestId("code-block").boundingBox()
  ]);
  expect(Math.abs((wideTable?.width ?? 0) - (prose?.width ?? 0))).toBeLessThan(2);
  expect(Math.abs((code?.width ?? 0) - (prose?.width ?? 0))).toBeLessThan(2);
});
