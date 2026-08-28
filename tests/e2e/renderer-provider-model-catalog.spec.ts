import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  installMockDesktopBridge,
  recordedCommandDetails
} from "./pi67-renderer-fixture.js";
import { DEFAULT_MOCK_WORKSPACE } from "./pi67-renderer-desktop-bridge.js";
import { createMockDeepSeekProviderConfigurationSnapshot } from "./pi67-provider-configuration-snapshot-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page, {
    initialWorkspaces: [DEFAULT_MOCK_WORKSPACE],
    currentWorkspaceId: DEFAULT_MOCK_WORKSPACE.id,
    expandedWorkspaceIds: [DEFAULT_MOCK_WORKSPACE.id],
    selectedSurface: { kind: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id }
  });
});

test("refreshes Pi's official model catalog independently from configuration files", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.keyboard.press("Control+,");
  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "模型", exact: true }).click();
  const panel = settings.getByTestId("provider-configuration-panel");
  await expect(panel.getByRole("button", { name: "刷新模型目录" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "重新加载配置" })).toBeVisible();

  await clearRecordedCommands(page);
  await panel.getByRole("button", { name: "刷新模型目录" }).click();

  await expect(page.getByText("Pi 模型目录已刷新", { exact: true })).toBeVisible();
  expect((await recordedCommandDetails(page)).filter((command) => (
    command.type === "provider.modelCatalog.refresh"
  ))).toHaveLength(1);
});

test("declares native search for every official DeepSeek catalog model", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [], {}, {
    providerConfigurationSnapshot: createMockDeepSeekProviderConfigurationSnapshot(true)
  });
  await page.keyboard.press("Control+,");
  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "模型", exact: true }).click();
  const panel = settings.getByTestId("provider-configuration-panel");
  await panel.getByTestId("provider-configuration-list")
    .getByRole("button", { name: /DeepSeek/u }).click();

  const rows = panel.getByTestId("provider-model-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("原生搜索 · 已声明");
  await expect(rows.nth(1)).toContainText("原生搜索 · 已声明");
  await expect(rows.nth(2)).toContainText("图片 · 推理 · 原生搜索 · 已声明");
  await panel.getByRole("button", { name: "原生搜索", exact: true }).click();
  await expect(rows).toHaveCount(3);
});
