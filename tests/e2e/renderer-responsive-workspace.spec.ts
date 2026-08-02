import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  emitMockAgentEvent,
  installMockDesktopBridge
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("keeps the transcript primary at the context-drawer breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  await expect(page.getByLabel("Pi conversation")).toBeVisible();
  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  await expect(inspector).toHaveCount(0);
  const contextToggle = page.getByRole("button", { name: "显示任务检查器" });
  await contextToggle.click();
  await expect(inspector).toBeVisible();
  await expect(page.getByRole("tab", { name: "消息", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭任务检查器抽屉" })).toBeVisible();
  const sendButton = page.getByRole("button", { name: "发送" });
  await expect(sendButton).toBeVisible();
  await expect.poll(() => isControlTopmost(sendButton)).toBe(true);
  await emitMockAgentEvent(page, {
    type: "operation.started",
    payload: {
      operation: {
        operationId: "operation-context-drawer",
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-test",
        sessionGeneration: 1,
        startedAt: Date.now(),
        activity: {
          kind: "tool",
          toolCallId: "tool-context-drawer",
          toolName: "bash",
          toolKind: "shell",
          status: "running"
        }
      }
    }
  }, { operationId: "operation-context-drawer" });
  const stopButton = page.getByRole("button", { name: "停止" });
  await expect(stopButton).toBeVisible();
  await expect.poll(() => isControlTopmost(stopButton)).toBe(true);
  const columns = await page.locator(".workspace-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  expect(columns.split(" ").length).toBeLessThanOrEqual(2);
  await page.getByRole("button", { name: "关闭任务检查器抽屉" }).click();
  await expect(inspector).toHaveCount(0);
  await expect(contextToggle).toBeFocused();
});

async function isControlTopmost(locator: import("@playwright/test").Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return topmost === element || (topmost !== null && element.contains(topmost));
  });
}

test("opens narrow session navigation as a focus-restoring drawer", async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 800 });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const navigation = page.getByLabel("会话导航", { exact: true });
  const navigationToggle = page.getByRole("button", { name: "显示会话导航" });
  await expect(navigation).not.toBeVisible();
  await expect(navigationToggle).toHaveAttribute("aria-expanded", "false");

  await navigationToggle.click();
  await expect(navigation).toBeVisible();
  await expect(page.getByRole("button", { name: "隐藏会话导航" })).toHaveAttribute("aria-expanded", "true");
  await expect(navigation.getByRole("button", { name: "添加或创建工作区" })).toBeFocused();

  await page.getByRole("button", { name: "关闭会话导航" }).click();
  await expect(navigation).not.toBeVisible();
  await expect(page.getByRole("button", { name: "显示会话导航" })).toBeFocused();

  await page.keyboard.press("Control+b");
  await expect(navigation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(navigation).not.toBeVisible();
  await expect(page.getByRole("button", { name: "显示会话导航" })).toBeFocused();

  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  await page.keyboard.press("Control+Shift+b");
  await expect(inspector).toBeVisible();
  await page.keyboard.press("Control+Shift+b");
  await expect(inspector).toHaveCount(0);
  await expect(page.getByRole("button", { name: "显示任务检查器" })).toBeFocused();
});
