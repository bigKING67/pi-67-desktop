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
          requestOpenExternal: async () => true,
          getUpdateState: async () => ({ phase: "idle" }),
          checkForUpdates: async () => ({ phase: "available", version: "0.2.0" }),
          downloadUpdate: async () => undefined,
          installUpdate: async () => undefined,
          onUpdateStateChanged: () => () => undefined,
          onAgentHostFailed: () => () => undefined
        }
      }
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

test("keeps update network and install actions user initiated", async ({ page }, testInfo) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "检查 Pi-67 Desktop 更新" }).click();

  const dialog = page.getByRole("dialog", { name: "Pi-67 Desktop 更新" });
  await expect(dialog.getByText(/不会发送工作区、会话、模型、Provider 或凭据数据/u)).toBeVisible();
  await expect(dialog.getByText("由你决定何时联网检查")).toBeVisible();
  await dialog.getByRole("button", { name: "检查更新" }).click();
  await expect(dialog.getByText("发现 Pi-67 Desktop 0.2.0")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "下载 0.2.0" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("update-dialog.png"), animations: "disabled" });
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
