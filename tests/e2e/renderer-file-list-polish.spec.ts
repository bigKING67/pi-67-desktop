import { expect, test } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";

for (const theme of ["light", "dark"] as const) {
  test(`preserves long filename suffix and keyboard menu in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await installMockDesktopBridge(page);
    await page.goto("/");
    await attachMockAgent(page);
    await page.getByRole("button", { name: "选择工作区" }).click();
    const inspector = page.getByRole("complementary", { name: "任务检查器" });
    const name = "经营分析_五渠道数据核验与汇总_2026-09-23_详细版.md";
    await inspector.getByRole("button", { name: "新建工作区项目" }).click();
    await page.getByRole("menuitem", { name: "新建文件", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新建文件" });
    await dialog.getByRole("textbox", { name: "文件名称" }).fill(name);
    await dialog.getByRole("button", { name: "创建", exact: true }).click();
    const row = inspector.getByRole("treeitem", { name: `文件 ${name} 0 B`, exact: true });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("title", name);
    await expect(row.locator(".inspector-file-name")).toHaveText(name);
    const tail = row.locator(".inspector-file-name-tail");
    await expect(tail).toContainText("详细版.md");
    const bounds = await tail.evaluate((element) => ({ tail: element.getBoundingClientRect().right, row: element.closest('[role="treeitem"]')!.getBoundingClientRect().right }));
    expect(bounds.tail).toBeLessThanOrEqual(bounds.row);
    await page.mouse.move(500, 100);
    await page.screenshot({ path: `artifacts/visual-review/file-list/${theme}.png` });
    const menu = row.getByRole("button", { name: `${name} 更多操作` });
    await menu.focus();
    const tailBox = await tail.boundingBox();
    const menuBox = await menu.boundingBox();
    expect(tailBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    expect(tailBox!.x + tailBox!.width).toBeLessThanOrEqual(menuBox!.x);
    await menu.press("Enter");
    await expect(page.getByRole("menuitem", { name: "重命名", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
