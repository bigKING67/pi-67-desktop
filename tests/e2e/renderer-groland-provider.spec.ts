import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  createMockProviderConfigurationSnapshot,
  installMockDesktopBridge
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

test("presents Groland vision and native-search capability without a per-turn search switch", async ({ page }) => {
  const providerConfigurationSnapshot = createMockProviderConfigurationSnapshot();
  const template = providerConfigurationSnapshot.providers.find((provider) => provider.id === "anthropic")!;
  const modelTemplate = template.models[0]!;
  providerConfigurationSnapshot.providers = [{
    ...template,
    id: "groland",
    name: "Groland",
    api: "anthropic-messages",
    configured: true,
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
