import { expect, test } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("shows Provider status while keeping runtime API keys ephemeral", async ({ page }, testInfo) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  await page.getByRole("button", { name: "打开命令面板" }).click();
  await page.getByRole("button", { name: /运行环境 Doctor/u }).click();
  await expect(page.getByRole("dialog", { name: "运行环境 Doctor" })).toBeVisible();
  await expect(page.getByText("当前运行环境的关键检查均已通过。")).toBeVisible();
  await expect(page.getByLabel("Doctor 检查结果").getByText("Pi SDK")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("doctor-dialog.png"), animations: "disabled" });
  await page.getByRole("button", { name: "关闭" }).click();

  await page.getByRole("button", { name: "管理 Provider 与凭据" }).click();
  const credentialDialog = page.getByRole("dialog", { name: "Provider 与凭据" });
  await expect(credentialDialog.getByText("OpenAI", { exact: true }).first()).toBeVisible();
  await expect(credentialDialog.getByText("来源：Pi AuthStorage")).toBeVisible();
  await expect(credentialDialog.getByText("••••••••••••")).toBeVisible();
  await credentialDialog.getByRole("button", { name: /Anthropic/u }).click();
  await expect(credentialDialog.getByText("尚未配置")).toBeVisible();
  const keyInput = page.getByLabel("Provider API key", { exact: true });
  await keyInput.fill("test-secret-1234");
  await page.screenshot({ path: testInfo.outputPath("credential-dialog.png"), animations: "disabled" });
  await credentialDialog.getByRole("button", { name: "启用本次运行密钥" }).click();
  await expect(credentialDialog.getByText("来源：本次运行内存")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("test-secret-1234");
  await expect(keyInput).toHaveValue("");

  await credentialDialog.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "管理 Provider 与凭据" }).click();
  await expect(page.getByLabel("Provider API key", { exact: true })).toHaveValue("");
});

test("keeps the title controls limited to configured models and readable thinking labels", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const modelSelect = page.getByLabel("Pi model");
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
  await page.getByRole("button", { name: "管理 Provider 与凭据" }).click();

  const dialog = page.getByRole("dialog", { name: "Provider 与凭据" });
  await expect(dialog).toBeVisible();
  const layoutColumns = await dialog.locator(".provider-credential-layout").evaluate((element) => (
    getComputedStyle(element).gridTemplateColumns
  ));
  expect(layoutColumns.split(" ")).toHaveLength(1);
  await expect(dialog.getByRole("button", { name: "替换本次运行密钥" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(680);
  await page.screenshot({ path: testInfo.outputPath("credential-dialog-narrow-dark.png"), animations: "disabled" });
});
