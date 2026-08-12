import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
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

function createGrolandProviderConfigurationSnapshot(configured: boolean) {
  const snapshot = createMockProviderConfigurationSnapshot();
  const template = snapshot.providers.find((provider) => provider.id === "anthropic")!;
  const modelTemplate = template.models[0]!;
  snapshot.providers = [{
    ...template,
    id: "groland",
    name: "Groland",
    api: "anthropic-messages",
    configured,
    models: [{
      ...modelTemplate,
      id: "claude-opus-4-8",
      name: "Claude Opus 4.8",
      api: "anthropic-messages",
      input: ["text", "image"],
      reasoning: true
    }, {
      ...modelTemplate,
      id: "gpt-5.5",
      name: "GPT 5.5",
      api: "openai-responses",
      input: ["text", "image"],
      reasoning: true
    }],
    modelCount: 2
  }];
  return snapshot;
}

test("presents Groland vision and native-search capability without a per-turn search switch", async ({ page }) => {
  const providerConfigurationSnapshot = createGrolandProviderConfigurationSnapshot(true);

  await page.goto("/");
  await attachMockAgent(page, [], {}, { providerConfigurationSnapshot });
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "模型", exact: true }).click();
  const panel = settings.getByTestId("provider-configuration-panel");
  await panel.getByTestId("provider-configuration-list")
    .getByRole("button", { name: /Groland/u }).click();

  const modelRows = panel.getByTestId("provider-model-row");
  await expect(modelRows).toHaveCount(2);
  await expect(modelRows.nth(0)).toContainText("协议 anthropic-messages · 图片 · 推理 · 原生搜索 · 已声明");
  await expect(modelRows.nth(1)).toContainText("协议 openai-responses · 图片 · 推理 · 原生搜索 · 已声明");
  await expect(settings.getByRole("switch", { name: /搜索/u })).toHaveCount(0);
  await expect(settings.getByRole("checkbox", { name: /搜索/u })).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/visual-review/groland-model-capabilities.png",
    animations: "disabled"
  });

  await page.setViewportSize({ width: 680, height: 820 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(modelRows.nth(1)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(await page.evaluate(() => document.documentElement.clientWidth));
  await page.screenshot({
    path: "artifacts/visual-review/groland-model-capabilities-dark-narrow.png",
    animations: "disabled"
  });
});

test("targets the Groland credential without starting a Session", async ({ page }) => {
  const providerConfigurationSnapshot = createGrolandProviderConfigurationSnapshot(false);
  await page.goto("/");
  await attachMockAgent(page, [], {}, {
    providerCatalogProviders: [{ id: "groland", label: "Groland", configured: false, modelCount: 7 }],
    providerConfigurationSnapshot
  });
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "模型", exact: true }).click();
  const panel = settings.getByTestId("provider-configuration-panel");
  await panel.getByTestId("provider-configuration-list").getByRole("button", { name: /Groland/u }).click();
  await panel.getByRole("button", { name: "配置 API Key", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "配置 Groland API Key" });
  await expect(dialog.getByLabel("Pi Provider 列表")).toHaveCount(0);
  const apiKeyInput = dialog.getByLabel("Provider API 密钥", { exact: true });
  await expect(apiKeyInput).toBeFocused();
  await apiKeyInput.fill("groland-test-key");
  await page.screenshot({
    path: "artifacts/visual-review/groland-credential-dialog.png",
    animations: "disabled"
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: "artifacts/visual-review/groland-credential-dialog-dark.png",
    animations: "disabled"
  });
  await dialog.getByRole("button", { name: "保存到 Pi" }).click();

  await expect.poll(() => recordedCommandDetails(page), { timeout: 15_000 }).toContainEqual(expect.objectContaining({
    type: "provider.credential.store",
    payload: expect.objectContaining({ provider: "groland", apiKey: "[redacted]" })
  }));
  const commands = await recordedCommandDetails(page);
  expect(commands).not.toContainEqual(expect.objectContaining({
    type: "provider.credential.store",
    payload: expect.objectContaining({ provider: "anthropic" })
  }));
});

test("does not fall back to Anthropic when a targeted Provider is missing", async ({ page }) => {
  const providerConfigurationSnapshot = createGrolandProviderConfigurationSnapshot(false);
  await page.goto("/");
  await attachMockAgent(page, [], {}, {
    providerCatalogProviders: [{ id: "anthropic", label: "Anthropic", configured: true, modelCount: 15 }],
    providerConfigurationSnapshot
  });
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "模型", exact: true }).click();
  const panel = settings.getByTestId("provider-configuration-panel");
  await panel.getByTestId("provider-configuration-list").getByRole("button", { name: /Groland/u }).click();
  await panel.getByRole("button", { name: "配置 API Key", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "配置 Groland API Key" });
  await expect(dialog).toContainText("当前 Pi Provider 目录中找不到 groland");
  await expect(dialog.getByLabel("Provider API 密钥", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "保存到 Pi" })).toBeDisabled();
  expect((await recordedCommandDetails(page)).filter((command) => command.type === "provider.credential.store"))
    .toHaveLength(0);
});
