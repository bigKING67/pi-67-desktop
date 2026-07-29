import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  createMockProviderConfigurationSnapshot,
  emitMockAgentEvent,
  installMockDesktopBridge,
  recordedCommandDetails
} from "./pi67-renderer-fixture.js";
import { DEFAULT_MOCK_WORKSPACE } from "./pi67-renderer-desktop-bridge.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page, {
    initialWorkspaces: [DEFAULT_MOCK_WORKSPACE],
    currentWorkspaceId: DEFAULT_MOCK_WORKSPACE.id,
    expandedWorkspaceIds: [DEFAULT_MOCK_WORKSPACE.id],
    selectedSurface: { kind: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id }
  });
});

test("keeps Provider and model catalogs single-layer while search preserves the active draft", async ({ page }) => {
  const providerConfigurationSnapshot = createMockProviderConfigurationSnapshot();
  const anthropic = providerConfigurationSnapshot.providers.find((provider) => provider.id === "anthropic")!;
  const openai = providerConfigurationSnapshot.providers.find((provider) => provider.id === "openai")!;
  const modelTemplate = anthropic.models[0]!;
  const anthropicModels = Array.from({ length: 9 }, (_, index) => ({
    ...modelTemplate,
    id: `claude-test-${index + 1}`,
    name: `Claude Test ${index + 1}`,
    input: (index % 2 === 0 ? ["text", "image"] : ["text"]) as Array<"text" | "image">,
    reasoning: index % 3 === 0,
    ...(index === 6 ? { baseUrl: "https://model-override.invalid/v1" } : {})
  }));
  const providerCatalog = [
    ["amazon-bedrock", "Amazon Bedrock"],
    ["ant-ling", "Ant Ling"],
    ["azure-openai-responses", "Azure OpenAI"],
    ["cerebras", "Cerebras"],
    ["cloudflare-ai-gateway", "Cloudflare AI Gateway"],
    ["cloudflare-workers-ai", "Cloudflare Workers AI"],
    ["codex", "codex"],
    ["deepseek", "DeepSeek"],
    ["fireworks", "Fireworks"],
    ["github-copilot", "GitHub Copilot"],
    ["google", "Google"],
    ["google-vertex-ai", "Google Vertex AI"],
    ["groq", "Groq"],
    ["huggingface", "Hugging Face"],
    ["kimi-code", "Kimi For Coding"],
    ["minimax", "MiniMax"],
    ["mistral", "Mistral"],
    ["moonshot-ai", "Moonshot AI"],
    ["nvidia", "NVIDIA"],
    ["openai", "OpenAI"],
    ["openrouter", "OpenRouter"],
    ["qwen-token-plan", "Qwen Token Plan"],
    ["together", "Together"],
    ["vercel-ai-gateway", "Vercel AI Gateway"],
    ["xai", "xAI"],
    ["z-ai", "Z.AI"]
  ] as const;
  providerConfigurationSnapshot.providers = [
    {
      ...anthropic,
      origin: "models.json",
      configured: true,
      models: anthropicModels,
      modelCount: anthropicModels.length
    },
    ...providerCatalog.map(([id, name]) => ({
      ...openai,
      id,
      name,
      configured: id === "openai"
    }))
  ];

  await page.goto("/");
  await attachMockAgent(page, [], {}, { providerConfigurationSnapshot });
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^模型服务/u }).click();
  const panel = settings.getByTestId("provider-configuration-panel");
  const search = panel.getByRole("textbox", { name: "搜索 Pi Provider" });
  const providerList = panel.getByTestId("provider-configuration-list");
  const editor = panel.getByTestId("provider-configuration-editor");
  const modelList = panel.getByTestId("provider-model-list");
  const modelDetail = panel.getByTestId("provider-model-detail");
  const settingsScroll = settings.getByTestId("settings-scroll-region");

  await expect(search).toBeVisible();
  await expect(providerList.getByRole("button")).toHaveCount(providerCatalog.length + 1);
  await expect(editor).toBeHidden();
  expect(await providerList.evaluate((element) => getComputedStyle(element).overflowY)).toBe("visible");
  expect(await settingsScroll.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
    await settingsScroll.evaluate((element) => element.clientHeight)
  );
  await search.fill("anthropic");
  await providerList.getByRole("button", { name: /Anthropic/u }).click();
  await expect(providerList).toBeHidden();
  await expect(editor).toBeVisible();
  await expect(panel.getByRole("tab", { name: "模型 9" })).toHaveAttribute("aria-selected", "true");
  await expect(modelList.getByTestId("provider-model-row")).toHaveCount(9);
  await expect(modelDetail).toBeHidden();

  const modelSearch = panel.getByRole("textbox", { name: "搜索模型" });
  await modelSearch.fill("claude-test-8");
  await expect(modelList.getByTestId("provider-model-row")).toHaveCount(1);
  await modelList.getByTestId("provider-model-row").click();
  await expect(modelList).toBeHidden();
  await expect(modelDetail).toBeVisible();
  await expect(panel.getByLabel("Model ID")).toHaveValue("claude-test-8");
  await panel.getByRole("button", { name: "返回模型列表" }).click();
  await expect(modelSearch).toHaveValue("claude-test-8");
  await panel.getByRole("button", { name: "清除模型搜索" }).click();
  await panel.getByRole("button", { name: "支持图片" }).click();
  await expect(modelList.getByTestId("provider-model-row")).toHaveCount(5);
  await modelList.getByRole("button", { name: /Claude Test 5/u }).click();
  await panel.getByLabel("显示名称").fill("Unsaved Claude Five");
  await panel.getByRole("button", { name: "返回模型列表" }).click();
  await panel.getByRole("button", { name: "支持推理" }).click();
  await expect(modelList.getByTestId("provider-model-row")).toHaveCount(3);
  await panel.getByRole("button", { name: "全部" }).click();
  await modelList.getByRole("button", { name: /Unsaved Claude Five/u }).click();
  await expect(panel.getByLabel("Model ID")).toHaveValue("claude-test-5");
  await expect(panel.getByLabel("显示名称")).toHaveValue("Unsaved Claude Five");
  await panel.getByRole("button", { name: "删除模型 Unsaved Claude Five" }).click();
  await expect(modelList.getByTestId("provider-model-row")).toHaveCount(8);

  await panel.getByRole("tab", { name: "基本配置" }).click();
  const providerName = panel.getByLabel("显示名称");
  await providerName.fill("Unsaved Anthropic Name");
  await panel.getByRole("button", { name: "返回模型服务列表" }).click();
  await expect(providerList).toBeVisible();
  await search.fill("deep");
  await expect(providerList.getByRole("button")).toHaveCount(1);
  await expect(providerList.getByRole("button", { name: /DeepSeek/u })).toBeVisible();
  await panel.getByRole("button", { name: "清除 Provider 搜索" }).click();
  await expect(providerList.getByRole("button")).toHaveCount(providerCatalog.length + 1);
  await search.fill("missing-provider-fixture");
  await expect(providerList.getByText("没有匹配的 Provider。", { exact: true })).toBeVisible();
  await search.fill("anthropic");
  await providerList.getByRole("button", { name: /Anthropic/u }).click();
  await expect(providerName).toHaveValue("Unsaved Anthropic Name");
});

test("uses a list-to-detail model flow in a narrow Settings workspace", async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 820 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  await attachMockAgent(page);
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^模型服务/u }).click();
  const panel = settings.getByTestId("provider-configuration-panel");
  const providerList = panel.getByTestId("provider-configuration-list");
  const editor = panel.getByTestId("provider-configuration-editor");
  const modelList = panel.getByTestId("provider-model-list");
  const modelDetail = panel.getByTestId("provider-model-detail");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(providerList).toBeVisible();
  await expect(editor).toBeHidden();
  await providerList.getByRole("button").first().click();
  await expect(providerList).toBeHidden();
  await expect(editor).toBeVisible();
  await expect(panel.getByRole("button", { name: "返回模型服务列表" })).toBeVisible();
  await expect(modelList).toBeVisible();
  await expect(modelDetail).toBeHidden();
  await modelList.getByTestId("provider-model-row").first().click();
  await expect(modelList).toBeHidden();
  await expect(modelDetail).toBeVisible();
  await expect(panel.getByRole("button", { name: "返回模型列表" })).toBeVisible();
  await panel.getByRole("button", { name: "返回模型列表" }).click();
  await expect(modelList).toBeVisible();
  await expect(modelDetail).toBeHidden();
  await panel.getByRole("button", { name: "返回模型服务列表" }).click();
  await expect(providerList).toBeVisible();
  await expect(editor).toBeHidden();
});

test("persists a Provider credential from a registered Workspace without starting a Task", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^模型服务/u }).click();
  await settings.getByTestId("provider-configuration-list").getByRole("button").first().click();
  await settings.getByRole("button", { name: "管理凭据", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Provider 与凭据" });
  await expect(dialog.getByText("OpenAI", { exact: true }).first()).toBeVisible();
  await dialog.getByRole("button", { name: /Anthropic/u }).click();
  const apiKeyInput = page.getByLabel("Provider API 密钥", { exact: true });
  await expect(apiKeyInput).toHaveAttribute("type", "password");
  await apiKeyInput.fill("workspace-secret-1234");
  await dialog.getByRole("button", { name: "显示 API Key" }).click();
  await expect(apiKeyInput).toHaveAttribute("type", "text");
  await expect(apiKeyInput).toHaveValue("workspace-secret-1234");
  await dialog.getByRole("button", { name: "隐藏 API Key" }).click();
  await expect(apiKeyInput).toHaveAttribute("type", "password");
  await dialog.getByRole("button", { name: "保存到 Pi" }).click();

  await expect(dialog.getByText("已持久化到 Pi auth.json")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("workspace-secret-1234");
  await dialog.getByRole("button", { name: "移除持久凭据" }).click();
  await expect(dialog.getByText("尚未配置")).toBeVisible();
  const commands = await recordedCommandDetails(page);
  expect(commands.filter((command) => command.type === "runtime.initialize")).toHaveLength(0);
  expect(commands).toContainEqual(expect.objectContaining({
    type: "provider.credential.store",
    payload: expect.objectContaining({ provider: "anthropic", apiKey: "[redacted]" }),
    context: { scope: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id }
  }));
  expect(commands).toContainEqual(expect.objectContaining({
    type: "provider.credential.remove",
    payload: expect.objectContaining({ provider: "anthropic" }),
    context: { scope: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id }
  }));
});

test("edits Pi Provider files, selects built-in defaults, and preserves a stale draft", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^模型服务/u }).click();
  const panel = settings.getByTestId("provider-configuration-panel");
  await panel.getByTestId("provider-configuration-list").getByRole("button").first().click();
  await panel.getByRole("tab", { name: "默认模型" }).click();
  const globalDefault = panel.getByRole("combobox", { name: "全局默认" });
  await globalDefault.click();
  await expect(page.getByRole("option", { name: /GPT Test/u })).toBeVisible();
  await expect(page.getByRole("option", { name: /Claude Test/u })).toBeVisible();
  await page.keyboard.press("Escape");

  await panel.getByRole("button", { name: "新建模型服务" }).click();
  await expect(panel.getByRole("tab", { name: "基本配置" })).toHaveAttribute("aria-selected", "true");
  await panel.getByLabel("Provider ID").fill("host-custom");
  await panel.getByLabel("显示名称").fill("Host Custom");
  await panel.getByLabel("Base URL").fill("https://example.invalid/v1");
  await panel.getByLabel("API 协议").fill("openai-responses");
  await panel.getByText(/^自定义 Headers/u).click();
  await panel.getByLabel("Header 名称").fill("X-Provider-Secret");
  await panel.getByLabel("Header 值").fill("provider-header-secret-value");
  await panel.getByRole("button", { name: "写入" }).click();

  await panel.getByRole("tab", { name: "模型 0" }).click();
  await panel.getByRole("button", { name: "添加模型" }).click();
  await expect(panel.getByLabel("Model ID")).toBeFocused();
  await panel.getByLabel("Model ID").fill("fixture-model");
  await panel.getByLabel("显示名称").fill("Fixture Model");
  await panel.getByLabel("Context Window").fill("32768");
  await panel.getByLabel("Max Tokens").fill("4096");
  await panel.getByText(/^自定义 Headers/u).click();
  await panel.getByLabel("Header 名称").fill("X-Model-Secret");
  await panel.getByLabel("Header 值").fill("model-header-secret-value");
  await panel.getByRole("button", { name: "写入" }).click();
  await clearRecordedCommands(page);
  await panel.getByRole("button", { name: "保存到 Pi" }).click();

  await expect(panel.getByText("Host Custom", { exact: true }).first()).toBeVisible();
  const saveCommand = (await recordedCommandDetails(page)).find((command) => (
    command.type === "provider.configuration.save"
  ));
  expect(saveCommand).toMatchObject({
    context: { scope: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id },
    payload: {
      provider: {
        id: "host-custom",
        headers: [{ name: "X-Provider-Secret", value: "[redacted]" }],
        models: [expect.objectContaining({
          id: "fixture-model",
          headers: [{ name: "X-Model-Secret", value: "[redacted]" }]
        })]
      }
    }
  });
  expect(JSON.stringify(saveCommand)).not.toContain("provider-header-secret-value");
  expect(JSON.stringify(saveCommand)).not.toContain("model-header-secret-value");

  await panel.getByRole("button", { name: "返回模型服务列表" }).click();
  await expect(panel.getByRole("button", { name: /Host Custom/u })).toBeVisible();
  await panel.getByRole("button", { name: /Host Custom/u }).click();

  await panel.getByRole("tab", { name: "默认模型" }).click();
  const updatedGlobalDefault = panel.getByRole("combobox", { name: "全局默认" });
  await updatedGlobalDefault.click();
  await updatedGlobalDefault.fill("fixture-model");
  await page.getByRole("option", { name: /Fixture Model/u }).click();
  await expect(panel.getByText("host-custom / fixture-model", { exact: true })).toBeVisible();
  expect((await recordedCommandDetails(page)).some((command) => (
    command.type === "model.default.set"
    && (command.payload as Record<string, unknown>).provider === "host-custom"
  ))).toBe(true);

  await panel.getByRole("tab", { name: "基本配置" }).click();
  await panel.getByLabel("显示名称").fill("Unsaved Local Name");
  const externalSnapshot = await page.evaluate(() => {
    const state = (window as typeof window & {
      __pi67TestAgent?: { providerConfiguration: Record<string, unknown> };
    }).__pi67TestAgent;
    if (!state) throw new Error("Missing Provider configuration fixture.");
    const snapshot = structuredClone(state.providerConfiguration) as Record<string, unknown>;
    snapshot.revision = "e".repeat(64);
    const providers = snapshot.providers as Array<Record<string, unknown>>;
    const provider = providers.find((candidate) => candidate.id === "host-custom");
    if (provider) provider.name = "Externally Updated Name";
    return snapshot;
  });
  await emitMockAgentEvent(page, {
    type: "provider.configuration.changed",
    payload: {
      snapshot: externalSnapshot,
      source: "external",
      changedFiles: ["models"],
      taskReload: "applied"
    }
  });

  await expect(panel.getByTestId("provider-configuration-conflict")).toBeVisible();
  await expect(panel.getByLabel("显示名称")).toHaveValue("Unsaved Local Name");
  await panel.getByRole("button", { name: "放弃草稿并采用最新配置" }).click();
  await expect(panel.getByTestId("provider-configuration-conflict")).toHaveCount(0);
  await expect(panel.getByLabel("显示名称")).toHaveValue("Externally Updated Name");
});
