import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  emitMockAgentEvent,
  installMockDesktopBridge
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("balances wide side columns and expands the shared conversation measure", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "adaptive-measure-message",
    role: "assistant",
    parts: [{ type: "text", text: "## 自适应工作区\n\n回答、过程和输入框使用同一阅读轨道。" }]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const navigation = page.getByRole("complementary", { name: "会话导航" });
  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  const message = page.getByRole("article", { name: "Pi 消息", exact: true });
  const composer = page.getByTestId("composer-shell");
  await expect(navigation).toBeVisible();
  await expect(inspector).toBeVisible();

  const wide = await measureWorkspace(navigation, inspector, message, composer);
  expect(Math.abs(wide.navigationWidth! - wide.inspectorWidth!)).toBeLessThanOrEqual(1);
  expect(wide.navigationWidth).toBeGreaterThanOrEqual(248);
  expect(wide.navigationWidth).toBeLessThanOrEqual(288);
  expect(wide.messageWidth).toBeGreaterThanOrEqual(858);
  expect(wide.messageWidth).toBeLessThanOrEqual(862);
  expect(Math.abs(wide.messageWidth - wide.composerWidth)).toBeLessThanOrEqual(1);

  await page.getByTestId("inspector-toggle").click();
  await expect(inspector).toHaveCount(0);
  await expect.poll(async () => (await message.boundingBox())?.width ?? 0).toBeGreaterThan(1010);
  const contextHidden = await measureWorkspace(navigation, undefined, message, composer);
  expect(contextHidden.messageWidth).toBeGreaterThan(wide.messageWidth + 150);
  expect(contextHidden.messageWidth).toBeLessThanOrEqual(1042);
  expect(Math.abs(contextHidden.messageWidth - contextHidden.composerWidth)).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "隐藏会话导航" }).click();
  await expect(navigation).not.toBeVisible();
  await expect.poll(async () => (await message.boundingBox())?.width ?? 0).toBeGreaterThan(1110);
  const sidesHidden = await measureWorkspace(undefined, undefined, message, composer);
  expect(sidesHidden.workspaceClass).toContain("navigation-hidden");
  expect(sidesHidden.conversationTrack).toBe("1120px");
  expect(sidesHidden.messageWidth).toBeGreaterThan(contextHidden.messageWidth + 70);
  expect(sidesHidden.messageWidth).toBeLessThanOrEqual(1122);
  expect(Math.abs(sidesHidden.messageWidth - sidesHidden.composerWidth)).toBeLessThanOrEqual(1);
  expect(sidesHidden.documentScrollWidth).toBe(sidesHidden.documentClientWidth);

  await page.screenshot({ path: testInfo.outputPath("conversation-measure-sides-hidden.png"), animations: "disabled" });
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
  expect((await inspector.boundingBox())?.width).toBeLessThanOrEqual(320);
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

async function measureWorkspace(
  navigation: import("@playwright/test").Locator | undefined,
  inspector: import("@playwright/test").Locator | undefined,
  message: import("@playwright/test").Locator,
  composer: import("@playwright/test").Locator
) {
  const [navigationBox, inspectorBox, messageBox, composerBox, documentWidth] = await Promise.all([
    navigation?.boundingBox() ?? Promise.resolve(null),
    inspector?.boundingBox() ?? Promise.resolve(null),
    message.boundingBox(),
    composer.boundingBox(),
    message.evaluate((element) => {
      const workspace = element.closest(".workspace-grid");
      return {
        conversationTrack: getComputedStyle(element).getPropertyValue("--conversation-track-width").trim(),
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        workspaceClass: workspace?.className ?? ""
      };
    })
  ]);
  if (!messageBox || !composerBox) throw new Error("Conversation geometry is unavailable");
  return {
    navigationWidth: navigationBox?.width,
    inspectorWidth: inspectorBox?.width,
    messageWidth: messageBox.width,
    composerWidth: composerBox.width,
    ...documentWidth
  };
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
  const narrowLayout = await page.locator(".workspace-grid").evaluate((element) => ({
    columns: getComputedStyle(element).gridTemplateColumns,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth
  }));
  expect(narrowLayout.columns.split(" ")).toHaveLength(1);
  expect(narrowLayout.documentScrollWidth).toBe(narrowLayout.documentClientWidth);
  await page.keyboard.press("Control+Shift+b");
  await expect(inspector).toHaveCount(0);
  await expect(page.getByRole("button", { name: "显示任务检查器" })).toBeFocused();
});
