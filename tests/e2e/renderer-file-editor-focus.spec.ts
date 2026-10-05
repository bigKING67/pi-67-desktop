import { expect, test } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";

for (const moveFocus of [false, true]) {
  test(`late editor loading respects the opening focus, moved=${moveFocus}`, async ({ page }) => {
    let releaseEditor!: () => void;
    let editorRequested!: () => void;
    const release = new Promise<void>((resolve) => { releaseEditor = resolve; });
    const requested = new Promise<void>((resolve) => { editorRequested = resolve; });
    await page.route(/\/FileEditor(?:-[^/]+\.js|\.tsx)(?:\?.*)?$/u, async (route) => {
      editorRequested();
      await release;
      await route.continue();
    });
    try {
      await installMockDesktopBridge(page);
      await page.goto("/");
      await attachMockAgent(page);
      await page.getByRole("button", { name: "选择工作区" }).click();
      const row = page.getByRole("treeitem", { name: "文件 README.md 24 B", exact: true });
      await row.click();
      await requested;
      await expect(page.getByText("正在加载编辑器", { exact: true })).toBeVisible();
      const menu = row.getByRole("button", { name: "README.md 更多操作", exact: true });
      if (moveFocus) {
        await menu.focus();
        await expect(menu).toBeFocused();
      }
      releaseEditor();
      const editor = page.getByRole("textbox", { name: "README.md 文件编辑器", exact: true });
      await expect(editor).toBeVisible();
      if (moveFocus) {
        await expect(menu).toBeFocused();
        await menu.press("Enter");
        await expect(page.getByRole("menuitem", { name: "重命名", exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(menu).toBeFocused();
        await expect(page.getByRole("tab", { name: "README.md", exact: true })).toBeVisible();
      } else {
        await expect(editor).toBeFocused();
      }
    } finally {
      releaseEditor();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}
