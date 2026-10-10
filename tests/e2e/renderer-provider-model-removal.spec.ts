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

test("removes models straight from the catalog and keeps focus on the list", async ({ page }, testInfo) => {
  const providerConfigurationSnapshot = createMockProviderConfigurationSnapshot();
  const anthropic = providerConfigurationSnapshot.providers.find((provider) => provider.id === "anthropic")!;
  const models = Array.from({ length: 4 }, (_, index) => ({
    ...anthropic.models[0]!,
    id: `claude-test-${index + 1}`,
    name: `Claude Test ${index + 1}`
  }));
  providerConfigurationSnapshot.providers = [
    { ...anthropic, origin: "models.json", configured: true, models, modelCount: models.length }
  ];

  await page.goto("/");
  await attachMockAgent(page, [], {}, { providerConfigurationSnapshot });
  await page.keyboard.press("Control+,");
  const settings = page.getByLabel("New Money 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "模型", exact: true }).click();
  const panel = settings.getByTestId("provider-configuration-panel");
  await panel.getByTestId("provider-configuration-list").getByRole("button", { name: /Anthropic/u }).click();
  const modelList = panel.getByTestId("provider-model-list");
  const rows = modelList.getByTestId("provider-model-row");
  await expect(rows).toHaveCount(4);
  await rows.nth(1).hover();
  await modelList.screenshot({ path: testInfo.outputPath("model-catalog-remove-actions.png"), animations: "disabled" });

  // Removal is visible at rest, never hover-only, and does not open the detail editor.
  const removeSecond = modelList.getByRole("button", { name: "删除模型 Claude Test 2" });
  await expect(removeSecond).toBeVisible();
  await removeSecond.click();
  await expect(rows).toHaveCount(3);
  await expect(panel.getByTestId("provider-model-detail")).toBeHidden();
  await expect(modelList.getByRole("button", { name: "删除模型 Claude Test 3" })).toBeFocused();

  // Keyboard removal hands focus to the next row, and to the previous one at the end.
  await page.keyboard.press("Enter");
  await expect(rows).toHaveCount(2);
  await expect(modelList.getByRole("button", { name: "删除模型 Claude Test 4" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(rows).toHaveCount(1);
  await expect(modelList.getByRole("button", { name: "删除模型 Claude Test 1" })).toBeFocused();
  await expect(panel.getByRole("tab", { name: "模型 1" })).toBeVisible();

  await clearRecordedCommands(page);
  await panel.getByRole("button", { name: "保存到 Pi" }).click();
  await expect.poll(async () => (
    (await recordedCommandDetails(page)).find((command) => command.type === "provider.configuration.save")
  )).toMatchObject({
    payload: { provider: { id: "anthropic", models: [expect.objectContaining({ id: "claude-test-1" })] } }
  });
  const save = (await recordedCommandDetails(page)).find((command) => command.type === "provider.configuration.save");
  expect(save).toBeDefined();
  expect((save!.payload as { provider: { models: unknown[] } }).provider.models).toHaveLength(1);
});
