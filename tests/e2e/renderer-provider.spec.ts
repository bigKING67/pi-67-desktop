import { expect, test, type Page } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("shows Provider status while keeping runtime API keys ephemeral", async ({ page }, testInfo) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const settings = await openSettingsSection(page, /^Runtime 与 Session/u);
  await settings.getByRole("button", { name: /运行环境诊断/u }).click();
  const doctorDialog = page.getByRole("dialog", { name: "运行环境诊断" });
  await expect(doctorDialog).toBeVisible();
  await expect(doctorDialog.getByText(/运行检查以确认/u)).toBeVisible();
  await doctorDialog.getByRole("button", { name: "运行检查" }).click();
  await expect(page.getByText("当前运行环境的关键检查均已通过。")).toBeVisible();
  await expect(page.getByLabel("运行环境检查结果").getByText("Pi SDK")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("doctor-dialog.png"), animations: "disabled" });
  await doctorDialog.getByRole("button", { name: "关闭", exact: true }).click();

  await openProviderDialog(page);
  const credentialDialog = page.getByRole("dialog", { name: "Provider 与凭据" });
  await expect(credentialDialog.getByText("OpenAI", { exact: true }).first()).toBeVisible();
  await expect(credentialDialog.getByText("已持久化到 Pi auth.json")).toBeVisible();
  await expect(credentialDialog.getByText("••••••••••••")).toBeVisible();
  await credentialDialog.getByRole("button", { name: /Anthropic/u }).click();
  await expect(credentialDialog.getByText("尚未配置")).toBeVisible();
  const keyInput = page.getByLabel("Provider API 密钥", { exact: true });
  await keyInput.fill("test-secret-1234");
  await page.screenshot({ path: testInfo.outputPath("credential-dialog.png"), animations: "disabled" });
  await credentialDialog.getByRole("button", { name: "仅本次运行" }).click();
  await expect(credentialDialog.getByText("来源：本次运行内存")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("test-secret-1234");
  await expect(keyInput).toHaveValue("");

  await credentialDialog.getByRole("button", { name: "关闭" }).click();
  await openProviderDialog(page);
  await expect(page.getByLabel("Provider API 密钥", { exact: true })).toHaveValue("");
});

test("keeps the title controls limited to configured models and readable thinking labels", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const modelSelect = page.getByLabel("Pi 模型");
  await expect(modelSelect.locator("option")).toHaveCount(2);
  await expect(modelSelect.getByRole("option", { name: /Claude Test/u })).toHaveCount(0);
  const thinkingSelect = page.getByLabel("Pi 思考级别");
  await expect(thinkingSelect.locator('option[value="off"]')).toHaveText("思考：关闭");
  await expect(thinkingSelect.locator('option[value="medium"]')).toHaveText("思考：中");
});

test("keeps Provider management usable in a narrow dark workspace", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 680, height: 800 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("button", { name: "显示会话导航" }).click();
  await openProviderDialog(page);

  const dialog = page.getByRole("dialog", { name: "Provider 与凭据" });
  await expect(dialog).toBeVisible();
  const layoutColumns = await dialog.locator(".provider-credential-layout").evaluate((element) => (
    getComputedStyle(element).gridTemplateColumns
  ));
  expect(layoutColumns.split(" ")).toHaveLength(1);
  await expect(dialog.getByRole("button", { name: "仅本次运行" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(680);
  await page.screenshot({ path: testInfo.outputPath("credential-dialog-narrow-dark.png"), animations: "disabled" });
});

async function openProviderDialog(page: Page): Promise<void> {
  const settings = await openSettingsSection(page, /^Provider 与模型/u);
  await settings.getByRole("button", { name: "管理凭据", exact: true }).click();
}

async function openSettingsSection(page: Page, sectionName: RegExp) {
  const settings = page.getByLabel("π 设置");
  if (await settings.count() === 0) {
    await page.getByRole("button", { name: "帮助与设置" }).click();
    await page.getByRole("menu", { name: "帮助与设置" })
      .getByRole("menuitem", { name: "设置", exact: true }).click();
  }
  await expect(settings).toBeVisible();
  await expect(page.getByRole("complementary", { name: "会话导航" })).toHaveCount(0);
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: sectionName }).click();
  return settings;
}
