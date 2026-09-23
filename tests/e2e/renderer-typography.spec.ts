import { expect, test } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge, waitForMockWorkspaceReady } from "./pi67-renderer-fixture.js";

const markdown = [
  "## 两个需要区分的假设",
  "先确认数字来源，再判断变化原因。正文、辅助信息和操作入口应有清楚且稳定的层级。",
  "| | 假设 | 支持证据 | 反证 |",
  "| --- | --- | --- | --- |",
  "| A | 实际经营发生下降 | 需要核对后台实时数据与相同统计周期 | 当前样本尚不完整 |",
  "| B | 同步中断导致看板为空 | 多张表在同一时间停止更新，需要确认任务与源数据状态 | 仍需核对上游来源 |",
  "### 核验日志",
  "```\nRuntimeError: source readiness timed out\ntarget_date=2026-09-20\n```",
  "行内 `target_date` 保持行内显示。",
  "### **行程安排**",
  "- **Day 1（中心城区）**：早餐之后沿步行街游览，下午参观展览，晚餐后沿江散步，再返回住处休息。\n- **Day 2（河西）**：上午参观校园，中午就近用餐，下午留出休息时间。\n- **Day 3（返程）**：早餐之后整理行李，提前出发前往车站。"
].join("\n\n").replaceAll("|\n\n|", "|\n|");

for (const theme of ["light", "dark"] as const) {
  test(`keeps Composer action states distinct in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await installMockDesktopBridge(page);
    await page.goto("/");
    await attachMockAgent(page, [], {}, { terminalDelayMs: 90_000 });
    await page.getByRole("button", { name: "选择工作区" }).click();
    await waitForMockWorkspaceReady(page);
    const send = page.getByRole("button", { name: "发送", exact: true });
    const composer = page.getByTestId("composer-region");
    await expect(send).toBeDisabled();
    await composer.screenshot({ path: `artifacts/visual-review/typography/${theme}-composer-empty.png` });
    await page.getByLabel("给 Pi 发送消息").fill("整理本周进度");
    await expect(send).toBeEnabled();
    await composer.screenshot({ path: `artifacts/visual-review/typography/${theme}-composer-ready.png` });
    await send.click();
    await expect(composer.getByRole("button", { name: "停止", exact: true })).toBeVisible();
    await composer.screenshot({ path: `artifacts/visual-review/typography/${theme}-composer-running.png` });
  });

  test(`keeps typography and Markdown hierarchy readable in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await installMockDesktopBridge(page);
    await page.goto("/");
    await attachMockAgent(page, [{ id: "typography-sample", role: "assistant", parts: [{ type: "text", text: markdown }] }]);
    await page.getByRole("button", { name: "选择工作区" }).click();
    await waitForMockWorkspaceReady(page);
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    const widths = await table.locator("tbody tr").first().locator("td").evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width));
    expect(widths[0]).toBeLessThan(widths[2]! / 2);
    const block = page.getByTestId("code-block");
    await expect(block).toBeVisible();
    await expect(block.locator("pre")).toContainText("RuntimeError: source readiness timed out");
    await block.getByRole("button", { name: "复制", exact: true }).click();
    await expect(block.getByRole("button", { name: "已复制", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/visual-review/typography/${theme}-workbench.png`, animations: "disabled" });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
    await expect(page.getByLabel("New Money 设置")).toBeVisible();
    await page.screenshot({ path: `artifacts/visual-review/typography/${theme}-settings.png`, animations: "disabled" });
    await page.getByRole("button", { name: "返回工作台" }).click();
    const inspector = page.getByRole("complementary", { name: "任务检查器" });
    await inspector.getByRole("button", { name: "新建工作区项目" }).click();
    await page.getByRole("menuitem", { name: "新建文件", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "新建文件" })).toBeVisible();
    await page.screenshot({ path: `artifacts/visual-review/typography/${theme}-dialog.png`, animations: "disabled" });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 700, height: 900 });
    await expect(block).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/visual-review/typography/${theme}-narrow.png`, animations: "disabled" });
  });
}
