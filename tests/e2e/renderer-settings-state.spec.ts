import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge
} from "./pi67-renderer-fixture.js";

test("keeps Network and MCP drafts in memory until the user saves or discards them", async ({ page }) => {
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  const navigation = settings.getByRole("navigation", { name: "设置分类" });
  await navigation.getByRole("button", { name: "下载源与网络", exact: true }).click();
  const npmMode = settings.getByRole("combobox", { name: "npm", exact: true });
  const registry = settings.getByRole("textbox", { name: "自定义 Registry", exact: true });
  await npmMode.selectOption("custom");
  await registry.fill("https://registry.settings-draft.example.com");
  const save = settings.getByRole("button", { name: "保存", exact: true });
  await expect(save).toBeEnabled();

  await settings.getByRole("button", { name: "检测全部源", exact: true }).click();
  await expect(settings.getByText("以下结果基于未保存配置；检测没有写入下载源设置。", { exact: true }))
    .toBeVisible();
  await expect(save).toBeEnabled();
  expect(await settingsActionState(page)).toMatchObject({ packageSaves: 0, packageProbes: 1 });

  await registry.fill("https://registry.changed-after-probe.example.com");
  await expect(settings.getByText("草稿已在上次检测后修改，当前结果需要重新检测。", { exact: true }))
    .toBeVisible();
  await navigation.getByRole("button", { name: "关于", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "放弃未保存的修改" });
  await expect(discard).toContainText("下载源与网络");
  await discard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(registry).toHaveValue("https://registry.changed-after-probe.example.com");
  await navigation.getByRole("button", { name: "关于", exact: true }).click();
  await discard.getByRole("button", { name: "放弃修改并离开", exact: true }).click();

  await expect(settings.getByText("0.1.0-alpha.1", { exact: true })).toBeVisible();
  await expect(settings.getByText("macOS", { exact: true })).toBeVisible();
  await expect(settings.getByText("Apple Silicon (arm64)", { exact: true })).toBeVisible();
  await expect(settings.getByText("Unsigned Preview · 自动检查，手动安装", { exact: true })).toBeVisible();
  expect((await settingsActionState(page)).platformInfoCalls).toBeGreaterThan(0);

  await navigation.getByRole("button", { name: "运行服务", exact: true }).click();
  await expect(settings.getByText("0 / 8", { exact: true })).toBeVisible();

  await navigation.getByRole("button", { name: "下载源与网络", exact: true }).click();
  await settings.getByRole("button", { name: "恢复默认", exact: true }).click();
  const reset = page.getByRole("dialog", { name: "恢复默认下载源？" });
  await expect(reset).toContainText("覆盖当前保存的下载源设置");
  expect((await settingsActionState(page)).packageResets).toBe(0);
  await reset.getByRole("button", { name: "取消", exact: true }).click();
  expect((await settingsActionState(page)).packageResets).toBe(0);
  await settings.getByRole("button", { name: "恢复默认", exact: true }).click();
  await reset.getByRole("button", { name: "恢复默认下载源", exact: true }).click();
  expect((await settingsActionState(page)).packageResets).toBe(1);

  await navigation.getByRole("button", { name: "MCP 服务", exact: true }).click();
  const token = settings.getByRole("textbox", { name: "Tavily Bridge Client Token" });
  await token.fill("mcp_unsaved.0123456789abcdef");
  await navigation.getByRole("button", { name: "浏览器集成", exact: true }).click();
  await expect(discard).toContainText("Tavily Bridge Client Token");
  await discard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(token).toHaveValue("mcp_unsaved.0123456789abcdef");
  await navigation.getByRole("button", { name: "浏览器集成", exact: true }).click();
  await discard.getByRole("button", { name: "放弃修改并离开", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "浏览器集成", exact: true })).toBeVisible();
  expect((await settingsActionState(page)).mcpSaves).toBe(0);
});

async function settingsActionState(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const state = (window as typeof window & {
      __pi67SettingsTest: {
        packageSaves: unknown[];
        packageResets: number;
        packageProbes: unknown[];
        mcpSaves: number;
        mcpClears: number;
        platformInfoCalls: number;
      };
    }).__pi67SettingsTest;
    return {
      packageSaves: state.packageSaves.length,
      packageResets: state.packageResets,
      packageProbes: state.packageProbes.length,
      mcpSaves: state.mcpSaves,
      mcpClears: state.mcpClears,
      platformInfoCalls: state.platformInfoCalls
    };
  });
}
