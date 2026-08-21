import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge
} from "./pi67-renderer-fixture.js";

test("keeps Network drafts in memory until the user saves or discards them", async ({ page }) => {
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
  await expect(settings.getByText("Internal Unsigned · 点击更新", { exact: true })).toBeVisible();
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
});

test("keeps update actions disabled until the Main update state is ready", async ({ page }) => {
  await installMockDesktopBridge(page, { deferInitialUpdateState: true });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "更新与诊断", exact: true }).click();
  const automaticRow = settings.getByText("自动检查更新", { exact: true }).locator("xpath=../..");
  const statusRow = settings.getByText("更新状态", { exact: true }).locator("xpath=../..");
  await expect(automaticRow).toContainText("正在读取…");
  await expect(statusRow).toContainText("正在读取当前版本和更新设置。");
  await expect(statusRow).toContainText("正在读取…");
  await expect(settings.getByRole("button", { name: "正在读取…", exact: true })).toBeDisabled();
  expect(await updateTestState(page)).toMatchObject({ checks: 0 });

  await finishInitialUpdateRead(page);
  await expect(automaticRow).toContainText("已开启");
  await expect(statusRow).toContainText("等待首次检查");
  await expect(settings.getByRole("button", { name: "立即检查", exact: true })).toBeEnabled();

  await page.reload();
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("button", { name: "帮助与设置" }).click();
  await page.getByRole("menu", { name: "帮助与设置" })
    .getByRole("menuitem", { name: "检查更新", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Pi-67 更新" });
  await expect(dialog.getByText("正在读取更新状态", { exact: true })).toBeVisible();
  await expect(dialog.getByText("正在确认当前版本和自动检查设置。", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "检查更新", exact: true })).toHaveCount(0);
  expect(await updateTestState(page)).toMatchObject({ checks: 0 });

  await finishInitialUpdateRead(page);
  await expect(dialog.getByText("正在等待自动检查", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "检查更新", exact: true })).toBeEnabled();
});

async function settingsActionState(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const state = (window as typeof window & {
      __pi67SettingsTest: {
        packageSaves: unknown[];
        packageResets: number;
        packageProbes: unknown[];
        platformInfoCalls: number;
      };
    }).__pi67SettingsTest;
    return {
      packageSaves: state.packageSaves.length,
      packageResets: state.packageResets,
      packageProbes: state.packageProbes.length,
      platformInfoCalls: state.platformInfoCalls
    };
  });
}

async function finishInitialUpdateRead(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    (window as typeof window & {
      __pi67UpdateTest: { finishInitialRead(): void };
    }).__pi67UpdateTest.finishInitialRead();
  });
}

async function updateTestState(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const state = (window as typeof window & {
      __pi67UpdateTest: { checks: number; openedUrls: string[] };
    }).__pi67UpdateTest;
    return { checks: state.checks, openedUrls: [...state.openedUrls] };
  });
}
