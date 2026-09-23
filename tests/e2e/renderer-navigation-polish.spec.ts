import { expect, test } from "@playwright/test";
import { DEFAULT_MOCK_WORKSPACE } from "./pi67-renderer-desktop-bridge.js";
import { openWorkbench, sessionSummary, workspaceGroup } from "./renderer-workbench-test-fixture.js";

for (const theme of ["light", "dark"] as const) {
  test(`compact navigation preserves keyboard actions in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    const workspace = { ...DEFAULT_MOCK_WORKSPACE, displayName: "pi-67-desktop" };
    await openWorkbench(page, { pickerQueue: [workspace] }, {
      sessionCatalogItemsByWorkspace: {
        [workspace.id]: ["长沙旅行安排", "直播数据链路排查", "升级验收流式输出", "周报进展与下一步", "团队知识检索", "文字层级检查"].map((name, index) => sessionSummary(workspace, index + 1, name))
      }
    });
    const group = workspaceGroup(page, workspace.displayName);
    await group.getByTestId("conversation-row").filter({ hasText: "直播数据链路排查" }).click();
    await expect(page.getByTestId("title-context-current")).toHaveText("直播数据链路排查");
    await page.getByLabel("给 Pi 发送消息").focus();
    await page.mouse.move(800, 500);
    await page.screenshot({ path: `artifacts/visual-review/navigation/${theme}-rest.png` });
    const menu = group.getByRole("button", { name: "pi-67-desktop 工作区菜单", exact: true });
    await menu.focus();
    await expect(menu).toBeFocused();
    await page.screenshot({ path: `artifacts/visual-review/navigation/${theme}-focus.png` });
    await menu.press("Enter");
    await expect(page.getByRole("menu", { name: "pi-67-desktop 工作区菜单" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
