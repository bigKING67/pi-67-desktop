import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "pi67", {
      configurable: false,
      value: {
        system: {
          getPlatformInfo: async () => ({ platform: "darwin", architecture: "arm64", version: "0.1.0-alpha.1" }),
          connectAgentHost: async () => undefined,
          selectWorkspace: async () => "/Users/test/Projects/pi-demo",
          selectSessionFile: async () => "/Users/test/.pi/agent/sessions/demo.jsonl",
          saveDiagnostics: async () => "/tmp/pi67-diagnostics.json",
          showNotification: async () => undefined,
          requestOpenExternal: async (url: string) => {
            const testWindow = window as unknown as {
              __pi67UpdateTest: { checks: number; openedUrls: string[]; allowOpen: boolean };
            };
            testWindow.__pi67UpdateTest.openedUrls.push(url);
            return testWindow.__pi67UpdateTest.allowOpen;
          },
          getUpdateState: async () => ({
            phase: "idle",
            channel: "unsigned-preview",
            currentVersion: "0.1.0-alpha.1"
          }),
          checkForUpdates: async () => {
            const testWindow = window as unknown as { __pi67UpdateTest: { checks: number; openedUrls: string[] } };
            testWindow.__pi67UpdateTest.checks += 1;
            return {
              phase: "available",
              channel: "unsigned-preview",
              currentVersion: "0.1.0-alpha.1",
              version: "0.1.0-alpha.2",
              releaseUrl: "https://github.com/bigKING67/pi-67-desktop/releases/tag/v0.1.0-alpha.2",
              publishedAt: "2026-07-23T06:00:00.000Z"
            };
          },
          onAgentHostFailed: () => () => undefined
        }
      }
    });
    Object.defineProperty(window, "__pi67UpdateTest", {
      configurable: false,
      value: { checks: 0, openedUrls: [], allowOpen: false }
    });
  });
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

  await page.getByRole("button", { name: /信任并加载资源/u }).click();
  await expect(page.getByText("工作区尚未信任")).toHaveCount(0);

  const conversationBottom = await page.getByLabel("Pi conversation").evaluate((element) => element.getBoundingClientRect().bottom);
  const composerBottom = await page.locator(".composer-region").evaluate((element) => element.getBoundingClientRect().bottom);
  expect(Math.abs(conversationBottom - composerBottom)).toBeLessThanOrEqual(1);

  const fontFamily = await page.locator(".runtime-summary").evaluate((element) => getComputedStyle(element).fontFamily);
  expect(fontFamily).toContain("Maple Mono");
  await page.screenshot({ path: testInfo.outputPath("workspace-after.png"), animations: "disabled" });
});

test("keeps the transcript primary at the context-drawer breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  await expect(page.getByLabel("Pi conversation")).toBeVisible();
  await expect(page.getByRole("tab", { name: /会话树/u })).toBeVisible();
  const columns = await page.locator(".workspace-grid").evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  expect(columns.split(" ").length).toBeLessThanOrEqual(2);
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

test("runs Doctor and keeps a runtime API key ephemeral", async ({ page }, testInfo) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  await page.getByRole("button", { name: "打开命令面板" }).click();
  await page.getByRole("button", { name: /运行环境 Doctor/u }).click();
  await expect(page.getByRole("dialog", { name: "运行环境 Doctor" })).toBeVisible();
  await expect(page.getByText("当前运行环境的关键检查均已通过。")).toBeVisible();
  await expect(page.getByLabel("Doctor 检查结果").getByText("Pi SDK")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("doctor-dialog.png"), animations: "disabled" });
  await page.getByRole("button", { name: "关闭" }).click();

  await page.getByRole("button", { name: "配置本次运行的 Provider API key" }).click();
  const keyInput = page.getByLabel("Provider API key", { exact: true });
  await keyInput.fill("test-secret-1234");
  await page.screenshot({ path: testInfo.outputPath("credential-dialog.png"), animations: "disabled" });
  await page.getByRole("button", { name: "仅为本次运行启用" }).click();
  await expect(page.getByRole("dialog", { name: "配置本次运行的 Provider API key" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("test-secret-1234");

  await page.getByRole("button", { name: "配置本次运行的 Provider API key" }).click();
  await expect(page.getByLabel("Provider API key", { exact: true })).toHaveValue("");
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

  await expect(page.locator('.code-block[data-highlight-state="ready"]')).toBeVisible();
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

async function attachMockAgent(
  page: import("@playwright/test").Page,
  messages: Array<{ id: string; role: string; parts: Array<{ type: string; text: string }> }> = []
): Promise<void> {
  await page.evaluate((fixtureMessages) => {
    const snapshot = {
      sessionId: "session-test",
      sessionPath: "/Users/test/.pi/agent/sessions/demo.jsonl",
      cwd: "/Users/test/Projects/pi-demo",
      streaming: false,
      messages: fixtureMessages,
      models: [{ provider: "openai", id: "gpt-test", label: "GPT Test", configured: true, reasoning: true }],
      selectedModel: { provider: "openai", id: "gpt-test" },
      thinkingLevel: "medium",
      availableThinkingLevels: ["off", "medium", "high"],
      steeringQueue: [],
      followUpQueue: [],
      tree: [],
      resources: [{ kind: "skill", id: "design-craft", label: "design-craft", status: "ready" }],
      stats: { tokens: 0, cost: 0, contextPercent: 0 }
    };
    const channel = new MessageChannel();
    channel.port2.onmessage = (event) => {
      const envelope = event.data as { requestId?: string; command?: { type?: string } };
      if (!envelope.requestId) return;
      const testWindow = window as unknown as { __pi67TestCommands?: string[] };
      testWindow.__pi67TestCommands ??= [];
      if (envelope.command?.type) testWindow.__pi67TestCommands.push(envelope.command.type);
      const doctorReport = {
        generatedAt: Date.now(),
        checks: [
          { id: "platform", label: "Platform", status: "pass", detail: "darwin/arm64" },
          { id: "node", label: "Embedded Node", status: "pass", detail: "24.18.0" },
          { id: "pi-sdk", label: "Pi SDK", status: "pass", detail: "0.81.1" },
          { id: "shell", label: "Pi shell", status: "pass", detail: "/bin/bash - GNU bash" },
          { id: "git", label: "Git", status: "pass", detail: "git version 2.50.0" }
        ]
      };
      const data = envelope.command?.type === "session.list" || envelope.command?.type === "command.list"
        ? []
        : envelope.command?.type === "doctor.run"
          ? doctorReport
          : snapshot;
      channel.port2.postMessage({
        protocolVersion: 1,
        kind: "response",
        messageId: `mock-${Date.now()}`,
        requestId: envelope.requestId,
        timestamp: Date.now(),
        response: { ok: true, data }
      });
    };
    channel.port2.start();
    window.postMessage({ source: "pi67-preload", type: "agent-port" }, "*", [channel.port1]);
  }, messages);
}

async function clearRecordedCommands(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __pi67TestCommands?: string[] }).__pi67TestCommands = [];
  });
}

async function recordedCommands(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => [
    ...((window as unknown as { __pi67TestCommands?: string[] }).__pi67TestCommands ?? [])
  ]);
}
