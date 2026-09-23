import { expect, test } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge, waitForMockWorkspaceReady } from "./pi67-renderer-fixture.js";

for (const theme of ["light", "dark"] as const) {
  test(`workbench hierarchy and keyboard filters remain usable in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await installMockDesktopBridge(page);
    await page.goto("/");
    await attachMockAgent(page);
    await page.getByRole("button", { name: "选择工作区" }).click();
    await waitForMockWorkspaceReady(page);
    const inspector = page.getByRole("complementary", { name: "任务检查器" });
    const toggle = page.getByTestId("inspector-toggle");
    await expect(inspector).toHaveCSS("width", "320px");
    const filter = page.getByRole("button", { name: "文件筛选", exact: true });
    await filter.focus();
    await page.keyboard.press("Enter");
    const checkbox = page.getByRole("checkbox", { name: "显示依赖/生成目录" });
    await expect(checkbox).toBeVisible();
    await checkbox.check();
    await page.keyboard.press("Escape");
    await expect(filter).toBeFocused();
    await expect(filter).toContainText("1");
    for (const width of [1440, 1000, 720]) {
      await page.setViewportSize({ width, height: 920 });
      if (await toggle.getAttribute("aria-expanded") === "true") await toggle.click();
      await expect(page.getByRole("button", { name: "Pi 模型", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Pi 思考级别", exact: true })).toContainText("思考");
      const composer = page.getByLabel("给 Pi 发送消息");
      await composer.fill("请检查本周进展与下一步。");
      await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const shell = await page.getByTestId("composer-shell").boundingBox();
      expect(shell!.width).toBeLessThanOrEqual(802);
      await page.screenshot({ path: `artifacts/visual-review/workbench-polish/${theme}-${width}.png`, animations: "disabled" });
    }
  });
}
