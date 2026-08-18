import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  emitMockAgentEvent,
  installMockDesktopBridge
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("bounds wide side columns and expands the shared conversation measure", async ({ page }, testInfo) => {
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
  expect(wide.navigationWidth).toBeGreaterThanOrEqual(248);
  expect(wide.navigationWidth).toBeLessThanOrEqual(288);
  expect(wide.inspectorWidth).toBeGreaterThanOrEqual(360);
  expect(wide.inspectorWidth).toBeLessThanOrEqual(384);
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

test("keeps the transcript primary at the context-drawer breakpoint", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1_320, height: 800 });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  await expect(page.getByLabel("Pi conversation")).toBeVisible();
  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  await expect(inspector).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("context-auto-collapsed-1320px.png"),
    animations: "disabled"
  });
  const contextToggle = page.getByRole("button", { name: "显示任务检查器" });
  await contextToggle.click();
  await expect(inspector).toBeVisible();
  expect((await inspector.boundingBox())?.width).toBeGreaterThanOrEqual(359);
  expect((await inspector.boundingBox())?.width).toBeLessThanOrEqual(384);
  await expect(page.getByRole("tab", { name: "消息", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭任务检查器抽屉" })).toBeVisible();
  const sendButton = page.getByRole("button", { name: "发送" });
  await expect(sendButton).toBeVisible();
  await expect.poll(() => controlTopmostSurface(sendButton)).toBe("context-drawer");
  await emitMockAgentEvent(page, {
    type: "operation.started",
    payload: {
      operation: {
        operationId: "operation-context-drawer",
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-test",
        sessionFileIdentity: "session-file-fixture-demo",
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
  await page.getByLabel("给 Pi 发送消息").fill("Windows packaged responsive layout probe");
  await expect(sendButton).toBeVisible();
  await expect.poll(() => controlTopmostSurface(sendButton)).toBe("context-drawer");
  const stopButton = page.getByRole("button", { name: "停止" });
  await expect(stopButton).toBeVisible();
  await expect.poll(() => controlTopmostSurface(stopButton)).toBe("context-drawer");
  const columns = await page.locator(".workspace-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  expect(columns.split(" ").length).toBeLessThanOrEqual(2);
  await page.screenshot({
    path: testInfo.outputPath("context-drawer-1320px.png"),
    animations: "disabled"
  });
  await page.getByRole("button", { name: "关闭任务检查器抽屉" }).click();
  await expect(inspector).toHaveCount(0);
  await expect(contextToggle).toBeFocused();
  await expect.poll(() => controlTopmostSurface(sendButton)).toBe("control");
  await expect.poll(() => controlTopmostSurface(stopButton)).toBe("control");
});

test("keeps the Composer inside the comfortable docked Inspector work plane", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1_328, height: 800 });
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "adaptive-composer-message",
    role: "assistant",
    parts: [{ type: "text", text: "Inspector 打开后，对话和输入区必须留在中间工作区内。" }]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  const inspectorToggle = page.getByTestId("inspector-toggle");
  const message = page.getByRole("article", { name: "Pi 消息", exact: true });
  const sendButton = page.getByRole("button", { name: "发送", exact: true });
  if (await inspectorToggle.getAttribute("aria-expanded") === "false") {
    await inspectorToggle.click();
  }
  await expect(inspector).toBeVisible();
  await expect(message).toContainText("Inspector 打开后，对话和输入区必须留在中间工作区内。");
  await expect(sendButton).toBeVisible();

  const geometry = await page.getByTestId("composer-region").evaluate((region) => {
    const conversation = region.closest<HTMLElement>(".conversation-region");
    const inspectorElement = document.querySelector<HTMLElement>(".context-pane");
    const messageElement = document.querySelector<HTMLElement>('[aria-label="Pi 消息"]');
    const shell = region.querySelector<HTMLElement>('[data-testid="composer-shell"]');
    const toolbar = region.querySelector<HTMLElement>("[class*='_toolbar_']");
    const tools = toolbar?.children.item(0) as HTMLElement | null;
    const actions = toolbar?.children.item(1) as HTMLElement | null;
    const send = [...(actions?.querySelectorAll<HTMLElement>("button") ?? [])]
      .find((button) => button.textContent?.trim() === "发送");
    if (!conversation || !inspectorElement || !messageElement || !shell || !toolbar || !tools || !actions || !send) {
      throw new Error("Docked Inspector Composer geometry is unavailable.");
    }
    const conversationRect = conversation.getBoundingClientRect();
    const inspectorRect = inspectorElement.getBoundingClientRect();
    const messageRect = messageElement.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const toolsRect = tools.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const sendRect = send.getBoundingClientRect();
    const topmost = document.elementFromPoint(sendRect.left + sendRect.width / 2, sendRect.top + sendRect.height / 2);
    return {
      conversationRight: conversationRect.right,
      inspectorLeft: inspectorRect.left,
      messageLeft: messageRect.left,
      messageRight: messageRect.right,
      shellLeft: shellRect.left,
      shellRight: shellRect.right,
      toolbarClientWidth: toolbar.clientWidth,
      toolbarScrollWidth: toolbar.scrollWidth,
      rows: Math.min(toolsRect.bottom, actionsRect.bottom) > Math.max(toolsRect.top, actionsRect.top) ? 1 : 2,
      sendLeft: sendRect.left,
      sendRight: sendRect.right,
      sendTopmost: topmost === send || (topmost !== null && send.contains(topmost)),
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth
    };
  });

  expect(geometry.conversationRight).toBeLessThanOrEqual(geometry.inspectorLeft + 1);
  expect(geometry.messageLeft).toBeGreaterThanOrEqual(geometry.shellLeft - 1);
  expect(geometry.messageRight).toBeLessThanOrEqual(geometry.inspectorLeft + 1);
  expect(geometry.sendLeft).toBeGreaterThanOrEqual(geometry.shellLeft - 1);
  expect(geometry.sendRight).toBeLessThanOrEqual(geometry.shellRight + 1);
  expect(geometry.toolbarScrollWidth).toBeLessThanOrEqual(geometry.toolbarClientWidth + 1);
  expect(geometry.rows).toBe(1);
  expect(geometry.sendTopmost).toBe(true);
  expect(geometry.documentScrollWidth).toBe(geometry.documentClientWidth);
  await page.screenshot({
    path: testInfo.outputPath("docked-inspector-1328px.png"),
    animations: "disabled"
  });
});

async function controlTopmostSurface(locator: import("@playwright/test").Locator): Promise<string> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const topmost = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (topmost === element || (topmost !== null && element.contains(topmost))) return "control";
    if (topmost?.closest(".context-pane, .context-drawer-scrim")) return "context-drawer";
    if (topmost?.closest('.navigation-rail, [aria-label="关闭会话导航"]')) return "navigation-drawer";
    return topmost ? "other" : "none";
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
  const sendButton = page.getByRole("button", { name: "发送" });
  await expect(navigation).not.toBeVisible();
  await expect(navigationToggle).toHaveAttribute("aria-expanded", "false");
  await expect(sendButton).toBeVisible();
  await expect.poll(() => controlTopmostSurface(sendButton)).toBe("control");

  await navigationToggle.click();
  await expect(navigation).toBeVisible();
  await expect.poll(() => controlTopmostSurface(sendButton)).toBe("navigation-drawer");
  await expect(page.getByRole("button", { name: "隐藏会话导航" })).toHaveAttribute("aria-expanded", "true");
  await expect(navigation.getByRole("button", { name: "添加或创建工作区" })).toBeFocused();

  await page.getByRole("button", { name: "关闭会话导航" }).click();
  await expect(navigation).not.toBeVisible();
  await expect(page.getByRole("button", { name: "显示会话导航" })).toBeFocused();
  await expect.poll(() => controlTopmostSurface(sendButton)).toBe("control");

  await page.keyboard.press("Control+b");
  await expect(navigation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(navigation).not.toBeVisible();
  await expect(page.getByRole("button", { name: "显示会话导航" })).toBeFocused();

  const inspector = page.getByRole("complementary", { name: "任务检查器" });
  await page.keyboard.press("Control+Shift+b");
  await expect(inspector).toBeVisible();
  await expect.poll(() => controlTopmostSurface(sendButton)).toBe("context-drawer");
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
  await expect.poll(() => controlTopmostSurface(sendButton)).toBe("control");
});
