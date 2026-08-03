import { expect, test, type Page } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("preserves the workspace hierarchy in dark mode", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

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
  await openWorkspace(page);

  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme-preference", "system");
  await expect(root).toHaveAttribute("data-theme", "dark");

  const trigger = page.getByRole("button", { name: "帮助与设置" });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "帮助与设置" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "设置", exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  const settings = await openAppearanceSettings(page);
  await expect(settings.getByRole("heading", { name: "外观", exact: true, level: 1 })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("appearance-settings-dark.png"), animations: "disabled" });

  await settings.getByRole("button", { name: /^浅色/u }).click();
  await expect(root).toHaveAttribute("data-theme-preference", "light");
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(245, 246, 244)");
  expect(await page.evaluate(() => localStorage.getItem("pi67.themePreference"))).toBe("light");
  await page.screenshot({ path: testInfo.outputPath("appearance-settings-light.png"), animations: "disabled" });

  await page.reload();
  await expect(root).toHaveAttribute("data-theme-preference", "light");
  await expect(root).toHaveAttribute("data-theme", "light");
  await openWorkspace(page);
  const restoredSettings = await openAppearanceSettings(page);
  await restoredSettings.getByRole("button", { name: /^深色/u }).click();
  await expect(root).toHaveAttribute("data-theme-preference", "dark");
  await expect(root).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("pi67.themePreference"))).toBe("dark");

  await restoredSettings.getByRole("button", { name: /^跟随系统/u }).click();
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
  await openWorkspace(page);

  const settings = await openAppearanceSettings(page);
  await expect(page.getByText("主题存储不可用，选择仅在本次运行有效。")).toBeVisible();
  await settings.getByRole("button", { name: /^深色/u }).click();
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

  await expect(page.locator('[data-highlight-state="ready"]')).toBeVisible({ timeout: 15_000 });
  const highlightedLine = page.locator('[data-code-line="0"]');
  await expect(highlightedLine).toHaveCount(1);
  await expect(highlightedLine.locator(":scope > span").first()).toHaveCSS("color", "rgb(255, 123, 114)");
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

test("keeps long code horizontally navigable without a persistent scrollbar", async ({ page }, testInfo) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  const longLine = `const enabledTools = new Set(savedTools.filter((tool: string) => allToolNames.includes(tool))); // ${"long-code-path-".repeat(18)}`;
  await attachMockAgent(page, [{
    id: "long-code-message",
    role: "assistant",
    parts: [{ type: "text", text: `\`\`\`typescript\n${longLine}\n\`\`\`` }]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const codeBlock = page.getByTestId("code-block");
  const codeViewport = codeBlock.locator("pre");
  await expect(codeBlock).toHaveAttribute("data-highlight-state", "ready", { timeout: 15_000 });
  const metrics = await codeViewport.evaluate((element) => {
    const initialScrollLeft = element.scrollLeft;
    element.scrollLeft = 80;
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      scrollLeft: element.scrollLeft,
      initialScrollLeft,
      horizontalScrollbarHeight: getComputedStyle(element, "::-webkit-scrollbar").height,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth
    };
  });
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  expect(metrics.scrollLeft).toBeGreaterThan(metrics.initialScrollLeft);
  expect(metrics.horizontalScrollbarHeight).toBe("0px");
  expect(metrics.documentScrollWidth).toBe(metrics.documentClientWidth);

  await expect(codeViewport).toHaveAttribute("data-code-scrollable", "true");
  await expect(codeViewport).toHaveCSS("visibility", "visible");
  await codeViewport.evaluate((element) => { element.scrollLeft = 0; });
  await codeViewport.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  expect(await codeViewport.evaluate((element) => {
    element.focus();
    return document.activeElement === element;
  })).toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => codeViewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  const copyCode = codeBlock.getByRole("button", { name: "复制", exact: true });
  await copyCode.click();
  await expect(codeBlock.getByRole("button", { name: "已复制", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(longLine);
  await expect(codeBlock.getByRole("button", { name: "复制", exact: true })).toBeVisible({ timeout: 3_000 });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("code clipboard blocked"); } }
    });
  });
  await copyCode.click();
  await expect(codeBlock.getByRole("button", { name: "复制失败", exact: true })).toBeVisible();
  await expect(page.locator("[data-notification-id]").filter({ hasText: "代码复制失败" }))
    .toContainText("code clipboard blocked");
  await page.screenshot({ path: testInfo.outputPath("long-code-without-scrollbar.png"), animations: "disabled" });
});

test("renders structured Markdown without letting wide tables widen the workbench", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  await attachMockAgent(page, [{
    id: "markdown-document-message",
    role: "assistant",
    parts: [{
      type: "text",
      text: [
        "## 内容方案",
        "",
        "- 明确目标人群",
        "  - 记录真实使用场景",
        "- [x] 保留可验证证据",
        "",
        "| 人群 | 场景 | 问题 | 证据 | 标题 | 正文 | 图片 | 复盘 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 通勤用户 | 早高峰 | 没时间护肤 | 30 天照片对比 | 油皮通勤底妆 | 步骤与数据 | 实拍对比图 | 收藏与搜索进站 |",
        "| 新手用户 | 第一次购买 | 不会选色号 | 自然光试色 | 新手选色指南 | 肤色判断方法 | 多肤色样本 | 有效评论 |",
        "",
        "> 结论必须能被读者验证。",
        "",
        "---",
        "",
        "正文继续保持稳定的阅读层级。"
      ].join("\n")
    }]
  }]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const tableViewport = page.getByLabel("表格，可横向滚动");
  const table = tableViewport.getByRole("table");
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "人群" })).toBeVisible();
  await expect(table.getByRole("cell", { name: "收藏与搜索进站" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "内容方案", level: 2 })).toBeVisible();

  const metrics = await tableViewport.evaluate((element) => {
    const header = element.querySelector("th");
    element.scrollLeft = 120;
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      scrollLeft: element.scrollLeft,
      headerBackground: header ? getComputedStyle(header).backgroundColor : "",
      headerPaddingLeft: header ? getComputedStyle(header).paddingLeft : "",
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth
    };
  });
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  expect(metrics.scrollLeft).toBeGreaterThan(0);
  expect(metrics.headerBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(metrics.headerPaddingLeft).toBe("12px");
  expect(metrics.documentScrollWidth).toBe(metrics.documentClientWidth);

  await tableViewport.focus();
  await expect(tableViewport).toBeFocused();
  await tableViewport.evaluate((element) => { element.scrollLeft = 0; });
  await page.screenshot({ path: testInfo.outputPath("markdown-document-dark.png"), animations: "disabled" });

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(await page.evaluate(() => document.documentElement.clientWidth));
  await page.screenshot({ path: testInfo.outputPath("markdown-document-light.png"), animations: "disabled" });
});

test("renders user messages as compact right-aligned bubbles", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  await attachMockAgent(page, [
    {
      id: "short-user-message",
      role: "user",
      parts: [{ type: "text", text: "你好" }]
    },
    {
      id: "assistant-message",
      role: "assistant",
      model: "deepseek-v4-pro",
      parts: [{ type: "text", text: "你好！有什么我可以帮你的吗？" }]
    },
    {
      id: "long-user-message",
      role: "user",
      parts: [{
        type: "text",
        text: "请检查当前工作区的前端实现，优先确认真实调用链、异常恢复和响应式布局，再给出可以直接验证的修改方案。不要为了形式上的高级架构增加无收益的抽象，也不要把需要基准测试验证的性能猜测写成已经存在的问题。"
      }]
    }
  ]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const userMessages = page.getByRole("article", { name: "用户消息", exact: true });
  const shortUserMessage = userMessages.nth(0);
  const longUserMessage = userMessages.nth(1);
  const piMessage = page.getByRole("article", { name: "Pi 消息", exact: true });
  await expect(userMessages).toHaveCount(2);
  await expect(shortUserMessage).toContainText("你好");
  await expect(shortUserMessage.getByText("你", { exact: true })).toHaveCount(0);
  await expect(piMessage.getByText("Pi", { exact: true })).toBeVisible();
  await expect(piMessage.getByText("deepseek-v4-pro", { exact: true })).toHaveCount(0);

  const [shortBox, longBox, piBox, shortTrackBox] = await Promise.all([
    shortUserMessage.getByTestId("message-content").boundingBox(),
    longUserMessage.getByTestId("message-content").boundingBox(),
    piMessage.boundingBox(),
    shortUserMessage.boundingBox()
  ]);
  expect(shortBox).not.toBeNull();
  expect(longBox).not.toBeNull();
  expect(piBox).not.toBeNull();
  expect(shortTrackBox).not.toBeNull();
  if (!shortBox || !longBox || !piBox || !shortTrackBox) throw new Error("Message geometry is unavailable");

  expect(shortBox.width).toBeLessThan(piBox.width / 2);
  expect(Math.abs(shortBox.x + shortBox.width - (piBox.x + piBox.width))).toBeLessThanOrEqual(1);
  expect(shortBox.x).toBeGreaterThan(piBox.x);
  expect(longBox.width).toBeLessThanOrEqual(682);
  expect(Math.abs(longBox.x + longBox.width - (piBox.x + piBox.width))).toBeLessThanOrEqual(1);
  expect(longBox.x).toBeGreaterThan(piBox.x);
  expect(shortTrackBox.width).toBe(piBox.width);

  const documentWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth
  }));
  expect(documentWidth.scroll).toBe(documentWidth.client);
  await page.screenshot({
    path: "artifacts/visual-review/user-message-bubble-after.png",
    animations: "disabled"
  });

  await page.setViewportSize({ width: 720, height: 920 });
  await expect(shortUserMessage).toBeVisible();
  const [narrowUserBox, narrowPiBox] = await Promise.all([
    shortUserMessage.getByTestId("message-content").boundingBox(),
    piMessage.boundingBox()
  ]);
  expect(narrowUserBox).not.toBeNull();
  expect(narrowPiBox).not.toBeNull();
  if (!narrowUserBox || !narrowPiBox) throw new Error("Narrow message geometry is unavailable");
  expect(Math.abs(narrowUserBox.x + narrowUserBox.width - (narrowPiBox.x + narrowPiBox.width)))
    .toBeLessThanOrEqual(1);
  expect(narrowUserBox.x).toBeGreaterThan(narrowPiBox.x);
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(await page.evaluate(() => document.documentElement.clientWidth));
  await page.screenshot({
    path: "artifacts/visual-review/user-message-bubble-after-narrow.png",
    animations: "disabled"
  });
});

test("keeps unsigned preview checks and external downloads user initiated", async ({ page }) => {
  await page.goto("/");
  await openWorkspace(page);
  await page.getByRole("button", { name: "帮助与设置" }).click();
  await page.getByRole("menu", { name: "帮助与设置" })
    .getByRole("menuitem", { name: "检查更新", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Unsigned Preview 手动更新" });
  await expect(dialog.getByText(/不会发送工作区、会话、模型、Provider 或凭据数据/u)).toBeVisible();
  await expect(dialog.getByText("由你决定何时联网检查")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __pi67UpdateTest: { checks: number } }).__pi67UpdateTest.checks)).toBe(0);
  await dialog.getByRole("button", { name: "检查更新" }).click();
  await expect(dialog.getByText("发现 π 0.1.0-alpha.2")).toBeVisible();
  await expect(dialog.getByText(/核对 SHA-256 后手动下载安装/u)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __pi67UpdateTest: { checks: number } }).__pi67UpdateTest.checks)).toBe(1);

  await dialog.getByRole("button", { name: "打开 GitHub 下载页" }).click();
  await expect(dialog.getByRole("alert")).toContainText("GitHub 下载页未打开");
  await expect(dialog.getByText("发现 π 0.1.0-alpha.2")).toBeVisible();

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

async function openWorkspace(page: Page): Promise<void> {
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
}

async function openAppearanceSettings(page: Page) {
  await page.getByRole("button", { name: "帮助与设置" }).click();
  await page.getByRole("menu", { name: "帮助与设置" })
    .getByRole("menuitem", { name: "设置", exact: true }).click();
  const settings = page.getByLabel("π 设置");
  await expect(settings).toBeVisible();
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^外观/u }).click();
  return settings;
}
