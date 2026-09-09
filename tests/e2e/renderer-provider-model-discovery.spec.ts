import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  createMockProviderConfigurationSnapshot,
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

test("discovers mixed-protocol models from one URL and lets users exclude a family", async ({ page }) => {
  const providerConfigurationSnapshot = createMockProviderConfigurationSnapshot();
  await page.goto("/");
  await attachMockAgent(page, [], {}, {
    providerConfigurationSnapshot,
    responseResults: {
      "provider.modelDiscovery.inspect": {
        status: "current",
        models: [
          {
            id: "gpt-5.4",
            name: "GPT 5.4",
            supplier: "openai",
            protocol: "openai",
            api: "openai-responses",
            discoveredBy: ["openai", "anthropic", "gemini"],
            verification: "catalog"
          },
          {
            id: "vendor-b/gpt-5.4",
            name: "GPT 5.4 · Vendor B",
            supplier: "vendor-b",
            protocol: "openai",
            api: "openai-responses",
            discoveredBy: ["openai", "anthropic", "gemini"],
            verification: "catalog"
          },
          {
            id: "claude-sonnet-4-6",
            name: "Claude Sonnet 4.6",
            supplier: "anthropic",
            protocol: "anthropic",
            api: "anthropic-messages",
            discoveredBy: ["openai", "anthropic", "gemini"],
            verification: "catalog"
          },
          {
            id: "gemini-3-pro",
            name: "Gemini 3 Pro",
            supplier: "google",
            protocol: "gemini",
            api: "google-generative-ai",
            discoveredBy: ["openai", "anthropic", "gemini"],
            verification: "catalog"
          }
        ],
        families: [
          { protocol: "openai", status: "current", modelCount: 2 },
          { protocol: "anthropic", status: "shared", modelCount: 1 },
          { protocol: "gemini", status: "shared", modelCount: 1 }
        ],
        conflicts: [],
        truncated: false
      }
    }
  });
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("New Money 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "模型", exact: true }).click();
  const panel = settings.getByTestId("provider-configuration-panel");
  await panel.getByRole("tab", { name: "自定义 0" }).click();
  await panel.getByRole("button", { name: "新建模型服务" }).click();

  const discovery = panel.getByTestId("provider-model-discovery");
  const openAi = discovery.getByRole("checkbox", { name: /OpenAI 兼容/u });
  const anthropic = discovery.getByRole("checkbox", { name: /Anthropic Messages/u });
  const gemini = discovery.getByRole("checkbox", { name: /Google Gemini/u });
  await expect(openAi).toBeChecked();
  await expect(anthropic).toBeChecked();
  await expect(gemini).toBeChecked();
  await expect(discovery.getByText(/Responses 优先/u)).toBeVisible();
  await expect(panel.getByText("统一使用 Authorization: Bearer（聚合服务推荐）", { exact: true }))
    .toBeVisible();
  await expect(panel.getByRole("checkbox", { name: /统一使用 Authorization/u })).toBeChecked();

  await panel.getByLabel("Provider ID").fill("mixed-gateway");
  await panel.getByLabel("显示名称").fill("Mixed Gateway");
  await panel.getByLabel("Base URL").fill("https://gateway.example.invalid/v1");
  await discovery.getByRole("textbox", { name: "API Key" }).fill("fixture-mixed-gateway-secret");
  await discovery.getByRole("button", { name: "检测并加载模型" }).click();

  await expect.poll(async () => (
    (await recordedCommandDetails(page)).filter((command) => command.type === "provider.modelDiscovery.inspect").length
  )).toBe(1);
  expect((await recordedCommandDetails(page)).find((command) => (
    command.type === "provider.modelDiscovery.inspect"
  ))).toMatchObject({
    payload: {
      protocols: ["openai", "anthropic", "gemini"],
      openAiApi: "openai-responses",
      authHeader: true
    }
  });

  const results = discovery.getByRole("region", { name: "发现结果" });
  await expect(results.getByText("发现结果 · 4 个模型", { exact: true })).toBeVisible();
  await expect(results.getByText(/vendor-b\/gpt-5\.4.*openai-responses/u)).toBeVisible();
  await expect(results.getByText(/claude-sonnet-4-6.*anthropic-messages/u)).toBeVisible();
  await expect(results.getByText(/gemini-3-pro.*google-generative-ai/u)).toBeVisible();

  await results.getByRole("checkbox", { name: /Anthropic Messages · 1/u }).focus();
  await page.keyboard.press("Space");
  await results.getByRole("button", { name: "添加所选模型到草稿" }).click();
  await expect(panel.getByRole("tab", { name: "模型 3" })).toBeVisible();

  await clearRecordedCommands(page);
  await panel.getByRole("button", { name: "保存到 Pi" }).click();
  await expect.poll(async () => (
    (await recordedCommandDetails(page)).filter((command) => (
      command.type === "provider.credential.store"
    )).length
  )).toBe(1);
  const commands = await recordedCommandDetails(page);
  const save = commands.find((command) => command.type === "provider.configuration.save");
  expect(save).toMatchObject({
    payload: {
      provider: {
        id: "mixed-gateway",
        models: [
          expect.objectContaining({ id: "gpt-5.4", api: "openai-responses" }),
          expect.objectContaining({ id: "vendor-b/gpt-5.4", api: "openai-responses" }),
          expect.objectContaining({ id: "gemini-3-pro", api: "google-generative-ai" })
        ]
      }
    }
  });
  expect(JSON.stringify(commands)).not.toContain("fixture-mixed-gateway-secret");
  expect(commands).toContainEqual(expect.objectContaining({
    type: "provider.credential.store",
    payload: expect.objectContaining({ provider: "mixed-gateway", apiKey: "[redacted]" })
  }));
});
