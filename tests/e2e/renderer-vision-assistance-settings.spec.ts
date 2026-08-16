import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  createMockProviderConfigurationSnapshot,
  installMockDesktopBridge,
  recordedCommandDetails
} from "./pi67-renderer-fixture.js";
import {
  DEFAULT_MOCK_WORKSPACE,
  type MockWorkspaceDescriptor
} from "./pi67-renderer-desktop-bridge.js";

const IDENTITY_CHANGED_WORKSPACE: MockWorkspaceDescriptor = {
  ...DEFAULT_MOCK_WORKSPACE,
  trust: "unknown",
  trustProvenance: "identity-changed",
  availability: "identity-changed"
};

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page, {
    initialWorkspaces: [IDENTITY_CHANGED_WORKSPACE],
    currentWorkspaceId: IDENTITY_CHANGED_WORKSPACE.id,
    expandedWorkspaceIds: [IDENTITY_CHANGED_WORKSPACE.id],
    selectedSurface: { kind: "workspace", workspaceId: IDENTITY_CHANGED_WORKSPACE.id }
  });
});

test("keeps global visual-model settings available without Workspace registration", async ({ page }, testInfo) => {
  const providerConfigurationSnapshot = createMockProviderConfigurationSnapshot();
  const openai = providerConfigurationSnapshot.providers.find((provider) => provider.id === "openai")!;
  openai.models.push({
    ...openai.models[0]!,
    id: "gpt-vision-alt",
    name: "GPT Vision Alt"
  });
  openai.modelCount = openai.models.length;
  const unconfiguredTemplate = providerConfigurationSnapshot.providers.find((provider) => (
    provider.id === "anthropic"
  ))!;
  providerConfigurationSnapshot.providers.push({
    ...unconfiguredTemplate,
    id: "amazon-bedrock",
    name: "Amazon Bedrock",
    models: [{
      ...unconfiguredTemplate.models[0]!,
      id: "nova-pro",
      name: "Nova Pro"
    }]
  });

  await page.goto("/");
  await attachMockAgent(page, [], {}, {
    providerConfigurationSnapshot
  });
  await clearRecordedCommands(page);

  await page.keyboard.press("Control+,");
  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "视觉辅助", exact: true }).click();

  const visionSettings = settings.getByTestId("vision-assistant-settings");
  const vision = visionSettings.getByTestId("vision-assistant-global");
  await expect(vision).toBeVisible();
  await expect(vision.getByText("Qwen3.7 Flash", { exact: true })).toBeVisible();
  await expect(vision.getByText("Doubao Seed 2.0 Mini", { exact: true })).toBeVisible();
  await expect(visionSettings.getByText("视觉辅助配置尚不可用", { exact: true })).toHaveCount(0);
  const modelSelect = vision.getByLabel("全局视觉辅助模型");
  await expect(modelSelect.getByRole("option", { name: "OpenAI / GPT Test" })).toBeAttached();
  await expect(modelSelect.getByRole("option", { name: "OpenAI / GPT Vision Alt" })).toBeAttached();
  await expect(modelSelect.getByRole("option", { name: "Anthropic / Claude Test" })).toHaveCount(0);
  await expect(modelSelect.getByRole("option", { name: "Amazon Bedrock / Nova Pro" })).toHaveCount(0);

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({
    path: testInfo.outputPath("vision-assistance-settings-light.png"),
    animations: "disabled"
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: testInfo.outputPath("vision-assistance-settings-dark.png"),
    animations: "disabled"
  });

  expect(await recordedCommandDetails(page)).toContainEqual(expect.objectContaining({
    type: "provider.configuration.get",
    context: { scope: "app" }
  }));
  expect((await recordedCommandDetails(page)).filter((command) => (
    command.type === "workspace.register"
  ))).toHaveLength(0);

  await clearRecordedCommands(page);
  await modelSelect.selectOption("openai::gpt-vision-alt");
  await expect(vision.getByText("openai / gpt-vision-alt", { exact: true })).toBeVisible();
  expect(await recordedCommandDetails(page)).toContainEqual(expect.objectContaining({
    type: "vision.assistant.global.set",
    context: { scope: "app" },
    payload: expect.objectContaining({ provider: "openai", model: "gpt-vision-alt" })
  }));

  await vision.getByRole("button", { name: "使用预设" }).first().click();
  await expect(settings.getByRole("heading", { name: "模型", exact: true })).toBeVisible();
  const panel = settings.getByTestId("provider-configuration-panel");
  await expect(panel.getByTestId("vision-assistant-global")).toHaveCount(0);
  const editor = panel.getByTestId("provider-configuration-editor");
  await expect(editor.getByLabel("Provider ID")).toHaveValue("bailian");
  await expect(editor.getByLabel("Base URL")).toHaveValue(
    "https://dashscope.aliyuncs.com/compatible-mode/v1"
  );
  await expect(editor.getByRole("tab", { name: "模型 1" })).toBeVisible();
});

test("keeps an unavailable saved helper explicit when no configured visual model remains", async ({ page }) => {
  const providerConfigurationSnapshot = createMockProviderConfigurationSnapshot();
  providerConfigurationSnapshot.providers = providerConfigurationSnapshot.providers.map((provider) => ({
    ...provider,
    configured: false
  }));

  await page.goto("/");
  await attachMockAgent(page, [], {}, { providerConfigurationSnapshot });
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "视觉辅助", exact: true }).click();
  const vision = settings.getByTestId("vision-assistant-global");
  const modelSelect = vision.getByLabel("全局视觉辅助模型");

  await expect(modelSelect.getByRole("option")).toHaveText([
    "关闭视觉辅助",
    "当前配置不可用 · OpenAI / GPT Test"
  ]);
  await expect(modelSelect.getByRole("option", { name: "当前配置不可用 · OpenAI / GPT Test" }))
    .toHaveAttribute("disabled", "");
  await expect(vision.getByText("暂无已配置的视觉模型。请使用下方预设完成模型服务和 API Key 配置。"))
    .toBeVisible();
  await expect(vision.getByLabel("配置不可用：openai / gpt-test")).toBeVisible();
  await expect(vision.getByRole("button", { name: "使用预设" })).toHaveCount(2);
});
