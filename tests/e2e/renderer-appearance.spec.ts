import { expect, test } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
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

  let trigger = page.getByRole("button", { name: "打开更多菜单" });
  await trigger.hover();
  await expect(page.getByRole("tooltip", { name: "更多" })).toBeVisible();
  await trigger.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(page.getByRole("tooltip", { name: "更多" })).not.toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /外观：跟随系统，当前选择/u })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("appearance-menu-dark.png"), animations: "disabled" });

  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await menu.getByRole("menuitem", { name: /外观：浅色/u }).click();
  await expect(root).toHaveAttribute("data-theme-preference", "light");
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(245, 246, 244)");
  expect(await page.evaluate(() => localStorage.getItem("pi67.themePreference"))).toBe("light");
  await trigger.click();
  await page.screenshot({ path: testInfo.outputPath("appearance-menu-light.png"), animations: "disabled" });
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(root).toHaveAttribute("data-theme-preference", "light");
  await expect(root).toHaveAttribute("data-theme", "light");
  trigger = page.getByRole("button", { name: "打开更多菜单" });
  await trigger.click();
  await page.getByRole("menu").getByRole("menuitem", { name: /外观：深色/u }).click();
  await expect(root).toHaveAttribute("data-theme-preference", "dark");
  await expect(root).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("pi67.themePreference"))).toBe("dark");

  await trigger.click();
  await page.getByRole("menu").getByRole("menuitem", { name: /外观：跟随系统/u }).click();
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

  await page.getByRole("button", { name: "打开更多菜单" }).click();
  await expect(page.getByText("主题存储不可用；选择仅在本次运行有效。")).toBeVisible();
  await page.getByRole("menu").getByRole("menuitem", { name: /外观：深色/u }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("keeps Shiki deferred and permits only its WASM engine when code is present", async ({ page }) => {
  await page.goto("/");
  const welcomeResources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
  expect(welcomeResources.some(isHighlightResource)).toBe(false);
  const messages = [{
    id: "code-message",
    role: "assistant",
    parts: [{ type: "text", text: "```typescript\nconst answer: number = 42;\n```" }]
  }];
  await attachMockAgent(page, messages);
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

test("keeps unsigned preview checks and external downloads user initiated", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "打开更多菜单" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: /检查更新/u }).click();

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

function isHighlightResource(name: string): boolean {
  return /(?:code-highlighter|shiki_wasm|shiki_langs_typescript|\/wasm-[^/]+\.js$|\/typescript-[^/]+\.js$)/u.test(name);
}
