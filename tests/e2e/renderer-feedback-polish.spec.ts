import { expect, test } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge, waitForMockWorkspaceReady } from "./pi67-renderer-fixture.js";

for (const theme of ["light", "dark"] as const) {
  test(`single-page message index stays compact in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await installMockDesktopBridge(page);
    await page.goto("/");
    await attachMockAgent(page, [{ id: "compact-message", role: "user", parts: [{ type: "text", text: "检查本周进展" }] }]);
    await page.getByRole("button", { name: "选择工作区" }).click();
    await waitForMockWorkspaceReady(page);
    const inspector = page.getByRole("complementary", { name: "任务检查器" });
    await inspector.getByRole("tab", { name: "消息", exact: true }).click();
    await expect(inspector.getByText("1 条用户消息", { exact: true })).toBeVisible();
    await expect(inspector.locator(".inspector-message-pagination")).toHaveCount(0);
    const header = await inspector.locator(".inspector-messages-header").boundingBox();
    const row = await inspector.getByRole("listitem").boundingBox();
    expect(row!.y - header!.y - header!.height).toBeLessThan(60);
    await inspector.getByRole("listitem").getByRole("button").click();
    await expect(page.locator('[data-message-id="compact-message"]')).toBeFocused();
    await page.screenshot({ path: `artifacts/visual-review/feedback-polish/${theme}.png`, animations: "disabled" });
  });
}

test("switch success expires without mutating runtime or hiding recovery", async ({ page }) => {
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);
  await page.evaluate(`(async () => {
    const { useAppStore } = await import('/src/app/app-store.ts');
    useAppStore.setState({ runtime: { phase: 'ready', detail: '已切换至「检查任务」', recoverable: true } });
  })()`);
  await expect(page.getByLabel("当前状态：已切换至「检查任务」", { exact: true })).toBeVisible();
  await expect(page.getByLabel("当前状态：就绪", { exact: true })).toBeVisible({ timeout: 5_000 });
  expect(await page.evaluate(`(async () => (await import('/src/app/app-store.ts')).useAppStore.getState().runtime.detail)()`))
    .toBe("已切换至「检查任务」");
  await page.evaluate(`(async () => {
    const { useAppStore } = await import('/src/app/app-store.ts');
    useAppStore.setState({ runtime: { phase: 'recovering', detail: '正在恢复连接', recoverable: true } });
  })()`);
  await expect(page.getByLabel("当前状态：正在恢复连接", { exact: true })).toBeVisible();
  await page.waitForTimeout(3_200);
  await expect(page.getByLabel("当前状态：正在恢复连接", { exact: true })).toBeVisible();
});
