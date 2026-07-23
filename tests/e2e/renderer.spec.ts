import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  emitMockAgentEvent,
  installMockDesktopBridge,
  recordedCommands
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("opens a trusted Pi workspace through the MessagePort contract", async ({ page }, testInfo) => {
  await page.goto("/");
  await attachMockAgent(page);

  await expect(page.getByRole("heading", { name: "把真实的 Pi 会话，放进一个清晰的工作面。" })).toBeVisible();
  const titleLineLengths = await page.getByRole("heading", { name: "把真实的 Pi 会话，放进一个清晰的工作面。" }).evaluate((heading) => {
    const lines = new Map<number, number>();
    for (const node of heading.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      for (let index = 0; index < (node.textContent?.length ?? 0); index += 1) {
        const character = node.textContent?.[index];
        if (!character?.trim()) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const top = Math.round(range.getBoundingClientRect().top);
        lines.set(top, (lines.get(top) ?? 0) + 1);
      }
    }
    return [...lines.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
  });
  expect(titleLineLengths.at(-1)).toBeGreaterThan(1);
  await expect(page.locator(".brand-lockup")).toHaveCSS("padding-left", "0px");
  expect((await page.locator(".brand-lockup").boundingBox())?.x).toBeGreaterThanOrEqual(78);
  await page.screenshot({ path: testInfo.outputPath("welcome-before.png"), animations: "disabled" });
  await page.getByRole("button", { name: "选择工作区" }).click();

  await expect(page.getByText("pi-demo", { exact: true })).toBeVisible();
  await expect(page.getByRole("status").getByText("工作区尚未信任")).toBeVisible();
  await expect(page.getByLabel("Pi conversation")).toBeVisible();
  await expect(page.getByRole("tab", { name: /会话树/u })).toBeVisible();
  await expect(page.getByLabel("给 Pi 发送消息")).toBeVisible();
  await expect(page.locator(".title-actions").getByRole("button", { name: /外观：/u })).toHaveCount(0);
  await expect(page.locator(".navigation-footer").getByRole("button", { name: /外观：跟随系统/u })).toBeVisible();

  await page.getByRole("button", { name: /信任并加载资源/u }).click();
  await expect(page.getByText("工作区尚未信任")).toHaveCount(0);

  const conversationBottom = await page.getByLabel("Pi conversation").evaluate((element) => element.getBoundingClientRect().bottom);
  const composerBottom = await page.locator(".composer-region").evaluate((element) => element.getBoundingClientRect().bottom);
  expect(Math.abs(conversationBottom - composerBottom)).toBeLessThanOrEqual(1);

  const fontFamily = await page.locator(".runtime-summary").evaluate((element) => getComputedStyle(element).fontFamily);
  expect(fontFamily).toContain("Maple Mono");
  await page.screenshot({ path: testInfo.outputPath("workspace-after.png"), animations: "disabled" });
});

test("gives the first on-demand Agent Host connection one initialization owner", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择工作区" }).click();

  await expect(page.getByText("pi-demo", { exact: true })).toBeVisible();
  const trustButton = page.locator(".trust-banner .secondary-button");
  await expect(trustButton).toBeDisabled();
  await expect(trustButton).toContainText("等待 Agent Host");

  await attachMockAgent(page);

  await expect.poll(() => recordedCommands(page)).toEqual(["runtime.initialize", "session.list"]);
  await expect(trustButton).toBeEnabled();
  await expect(trustButton).toContainText("信任并加载资源");
});

test("serializes trust and resource reload without stacking clicks", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [], { "resource.reload": 200 });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.getByText("从一个具体任务开始")).toBeVisible();
  await clearRecordedCommands(page);

  const trustButton = page.locator(".trust-banner .secondary-button");
  await expect(trustButton).toContainText("信任并加载资源");
  await trustButton.click();
  await expect(trustButton).toBeDisabled();
  await expect(trustButton).toContainText("正在加载 Pi 资源");
  await expect.poll(() => recordedCommands(page)).toEqual(["workspace.setTrust", "resource.reload"]);
  await expect(page.getByText("工作区尚未信任")).toHaveCount(0);
});

test("keeps the transcript primary at the context-drawer breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  await expect(page.getByLabel("Pi conversation")).toBeVisible();
  await expect(page.getByLabel("会话上下文")).toHaveCount(0);
  const contextToggle = page.getByRole("button", { name: "显示上下文" });
  await contextToggle.click();
  await expect(page.getByLabel("会话上下文")).toBeVisible();
  await expect(page.getByRole("tab", { name: /会话树/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭上下文抽屉" })).toBeVisible();
  const columns = await page.locator(".workspace-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  expect(columns.split(" ").length).toBeLessThanOrEqual(2);
  await page.getByRole("button", { name: "关闭上下文抽屉" }).click();
  await expect(page.getByLabel("会话上下文")).toHaveCount(0);
  await expect(contextToggle).toBeFocused();
});

test("imports an external Pi session instead of opening the source file in place", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.getByText("pi-demo", { exact: true })).toBeVisible();
  await expect.poll(async () => (await recordedCommands(page)).includes("session.list")).toBe(true);
  await clearRecordedCommands(page);

  await page.getByRole("button", { name: "导入 Pi session 到当前工作区" }).click();
  await expect.poll(() => recordedCommands(page)).toEqual(["session.import", "session.list"]);

  await page.evaluate(() => {
    const testWindow = window as unknown as {
      pi67: { system: { selectSessionFile(): Promise<string | undefined> } };
    };
    testWindow.pi67.system.selectSessionFile = async () => undefined;
  });
  await clearRecordedCommands(page);
  await page.getByRole("button", { name: "导入 Pi session 到当前工作区" }).click();
  await page.waitForTimeout(50);
  expect(await recordedCommands(page)).toEqual([]);
});

test("serializes new-session transitions and deduplicates repeated notices", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [], { "session.create": 200 });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  const createButton = page.getByRole("button", { name: "新建会话" });
  await createButton.click();
  await expect(createButton).toBeDisabled();
  await expect(page.getByLabel("Pi conversation").getByText("正在创建 Pi 新会话")).toBeVisible();
  await expect.poll(() => recordedCommands(page)).toEqual(["session.create", "session.list"]);

  await emitMockAgentEvent(page, { type: "turn.failed", payload: { message: "重复错误" } });
  await emitMockAgentEvent(page, { type: "turn.failed", payload: { message: "重复错误" } });
  await expect(page.getByText("重复错误")).toHaveCount(1);
});

test("preserves the workspace hierarchy in dark mode", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("button", { name: /信任并加载资源/u }).click();

  const colors = await page.locator("body").evaluate((body) => ({
    background: getComputedStyle(body).backgroundColor,
    foreground: getComputedStyle(body).color
  }));
  expect(colors.background).toBe("rgb(17, 20, 18)");
  expect(colors.foreground).toBe("rgb(240, 243, 239)");
  await page.screenshot({ path: testInfo.outputPath("workspace-dark.png"), animations: "disabled" });
});

test("lets users persist System, Light, and Dark appearance choices", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");

  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme-preference", "system");
  await expect(root).toHaveAttribute("data-theme", "dark");

  let trigger = page.getByRole("button", { name: /外观：跟随系统，当前深色/u });
  await trigger.hover();
  await expect(page.getByRole("tooltip", { name: "外观" })).toBeVisible();
  await trigger.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(page.getByRole("tooltip", { name: "外观" })).not.toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: /跟随系统/u })).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: testInfo.outputPath("appearance-menu-dark.png"), animations: "disabled" });

  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await menu.getByRole("menuitemradio", { name: /浅色/u }).click();
  await expect(root).toHaveAttribute("data-theme-preference", "light");
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(245, 246, 244)");
  expect(await page.evaluate(() => localStorage.getItem("pi67.themePreference"))).toBe("light");
  await page.getByRole("button", { name: /外观：浅色，当前浅色/u }).click();
  await page.screenshot({ path: testInfo.outputPath("appearance-menu-light.png"), animations: "disabled" });
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(root).toHaveAttribute("data-theme-preference", "light");
  await expect(root).toHaveAttribute("data-theme", "light");
  trigger = page.getByRole("button", { name: /外观：浅色，当前浅色/u });
  await trigger.click();
  await page.getByRole("menu").getByRole("menuitemradio", { name: /深色/u }).click();
  await expect(root).toHaveAttribute("data-theme-preference", "dark");
  await expect(root).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("pi67.themePreference"))).toBe("dark");

  await page.getByRole("button", { name: /外观：深色，当前深色/u }).click();
  await page.getByRole("menu").getByRole("menuitemradio", { name: /跟随系统/u }).click();
  expect(await page.evaluate(() => localStorage.getItem("pi67.themePreference"))).toBeNull();
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(root).toHaveAttribute("data-theme", "dark");
});

test("keeps theme selection usable when renderer storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage disabled for test", "SecurityError");
      }
    });
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  await page.getByRole("button", { name: /外观：跟随系统，当前浅色/u }).click();
  await expect(page.getByText("主题存储不可用；选择仅在本次运行有效。")).toBeVisible();
  await page.getByRole("menu").getByRole("menuitemradio", { name: /深色/u }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("keeps Shiki deferred and permits only its WASM engine when code is present", async ({ page }) => {
  await page.goto("/");
  const welcomeResources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
  expect(welcomeResources.some(isHighlightResource)).toBe(false);
  await attachMockAgent(page, [{
    id: "code-message",
    role: "assistant",
    parts: [{ type: "text", text: "```typescript\nconst answer: number = 42;\n```" }]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  await expect(page.locator('.code-block[data-highlight-state="ready"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".code-line")).toHaveCount(1);
  await expect(page.locator(".code-line > span").first()).toHaveCSS("color", "rgb(255, 123, 114)");
  const loadedResources = await page.evaluate(() => [
    ...performance.getEntriesByType("resource").map((entry) => entry.name),
    ...performance.getEntriesByName("pi67-code-highlight-resources", "mark")
      .flatMap((entry) => {
        const detail = (entry as PerformanceMark).detail;
        return Array.isArray(detail) ? detail as string[] : [];
      })
  ]);
  for (const pattern of [
    /code-highlighter/u,
    /(?:\/wasm-[^/]+\.js$|shiki_wasm\.js)/u,
    /(?:\/typescript-[^/]+\.js$|shiki_langs_typescript__mjs\.js)/u
  ]) {
    expect(loadedResources.some((name) => pattern.test(name))).toBe(true);
  }
});

function isHighlightResource(name: string): boolean {
  return /(?:code-highlighter|shiki_wasm|shiki_langs_typescript|\/wasm-[^/]+\.js$|\/typescript-[^/]+\.js$)/u.test(name);
}

test("keeps unsigned preview checks and external downloads user initiated", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "检查 Pi-67 Desktop 更新" }).click();

  const dialog = page.getByRole("dialog", { name: "Unsigned Preview 手动更新" });
  await expect(dialog.getByText(/不会发送工作区、会话、模型、Provider 或凭据数据/u)).toBeVisible();
  await expect(dialog.getByText("由你决定何时联网检查")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __pi67UpdateTest: { checks: number } }).__pi67UpdateTest.checks)).toBe(0);
  await dialog.getByRole("button", { name: "检查更新" }).click();
  await expect(dialog.getByText("发现 Pi-67 Desktop 0.1.0-alpha.2")).toBeVisible();
  await expect(dialog.getByText(/核对 SHA-256 后手动下载安装/u)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __pi67UpdateTest: { checks: number } }).__pi67UpdateTest.checks)).toBe(1);

  await dialog.getByRole("button", { name: "打开 GitHub 下载页" }).click();
  await expect(dialog.getByRole("alert")).toContainText("GitHub 下载页未打开");
  await expect(dialog.getByText("发现 Pi-67 Desktop 0.1.0-alpha.2")).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as { __pi67UpdateTest: { allowOpen: boolean } }).__pi67UpdateTest.allowOpen = true;
  });
  await dialog.getByRole("button", { name: "打开 GitHub 下载页" }).click();
  const releaseUrl = "https://github.com/bigKING67/pi-67-desktop/releases/tag/v0.1.0-alpha.2";
  expect(await page.evaluate(() => (window as unknown as { __pi67UpdateTest: { openedUrls: string[] } }).__pi67UpdateTest.openedUrls)).toEqual([
    releaseUrl,
    releaseUrl
  ]);
});
