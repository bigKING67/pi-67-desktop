import { expect, test, type Page } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge,
  recordedCommandDetails
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("shows Provider status while keeping runtime API keys ephemeral", async ({ page }, testInfo) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const settings = await openSettingsSection(page, /^运行服务/u);
  await expect(settings.getByText("同时运行的会话任务", { exact: true })).toBeVisible();
  await expect(settings.getByText("最多 8 个", { exact: true })).toBeVisible();
  await expect(settings.getByText(/任务内部的子代理不单独占用/u)).toBeVisible();
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
  const providerSearch = credentialDialog.getByRole("textbox", { name: "搜索 Provider" });
  await expect(providerSearch).toBeVisible();
  await providerSearch.fill("anthro");
  await expect(credentialDialog.getByRole("button", { name: /Anthropic/u })).toBeVisible();
  await expect(credentialDialog.getByRole("button", { name: /^OpenAI\b/u })).toHaveCount(0);
  await credentialDialog.getByRole("button", { name: "清除 Provider 搜索" }).click();
  await credentialDialog.getByRole("button", { name: /^OpenAI\b/u }).click();
  await expect(credentialDialog.getByText("已持久化到 Pi auth.json")).toBeVisible();
  await expect(credentialDialog.getByText("••••••••••••")).toBeVisible();
  await credentialDialog.getByRole("button", { name: "临时显示已保存 API Key" }).click();
  await expect(credentialDialog.getByText("fixture-persisted-openai-key", { exact: true })).toBeVisible();
  await credentialDialog.getByRole("button", { name: "隐藏已保存 API Key" }).click();
  await expect(credentialDialog.getByText("fixture-persisted-openai-key", { exact: true })).toHaveCount(0);
  await credentialDialog.getByRole("button", { name: "临时显示已保存 API Key" }).click();
  await expect(credentialDialog.getByText("fixture-persisted-openai-key", { exact: true })).toBeVisible();
  await credentialDialog.getByRole("button", { name: /Anthropic/u }).click();
  await expect(credentialDialog.getByText("fixture-persisted-openai-key", { exact: true })).toHaveCount(0);
  await credentialDialog.getByRole("button", { name: /^OpenAI\b/u }).click();
  await expect(credentialDialog.getByText("••••••••••••")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("credential-dialog-saved.png"), animations: "disabled" });
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

  const modelSelect = page.getByRole("button", { name: "Pi 模型", exact: true });
  await expect(modelSelect).toContainText("GPT Test");
  await expect(modelSelect).not.toContainText("openai");
  await modelSelect.click();
  const modelList = page.getByRole("listbox");
  await expect(modelList.getByRole("option")).toHaveCount(2);
  await expect(modelList.getByRole("option", { name: /Claude Test/u })).toHaveCount(0);
  await expect(modelList.getByRole("option", { name: /GPT Test/u })).toContainText("openai/gpt-test");
  const thinkingSelect = page.getByLabel("Pi 思考级别");
  await expect(thinkingSelect.locator('option[value="off"]')).toHaveText("思考：关闭");
  await expect(thinkingSelect.locator('option[value="medium"]')).toHaveText("思考：中");
});

test("switches the active model once with pending and confirmed feedback", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [], { "model.select": 350 });
  await page.getByRole("button", { name: "选择工作区" }).click();

  const modelSelect = page.getByRole("button", { name: "Pi 模型", exact: true });
  await modelSelect.click();
  await page.getByRole("option", { name: /DeepSeek V4 Flash/u }).click();
  await expect(modelSelect).toBeDisabled();
  await expect(modelSelect).toContainText("DeepSeek V4 Flash");
  await expect(modelSelect).not.toContainText("deepseek/");
  await expect(page.getByText("正在切换到 DeepSeek V4 Flash…", { exact: true })).toBeVisible();

  await expect(modelSelect).toBeEnabled();
  await expect(page.getByText("已切换到 DeepSeek V4 Flash", { exact: true })).toBeVisible();
  const modelCommands = (await recordedCommandDetails(page)).filter((command) => command.type === "model.select");
  expect(modelCommands).toEqual([expect.objectContaining({
    payload: { provider: "deepseek", id: "deepseek-v4-flash" }
  })]);
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
  const providerList = dialog.getByLabel("Pi Provider 列表");
  expect(await providerList.evaluate((element) => getComputedStyle(element).overflowY)).toBe("scroll");
  const scrollState = await providerList.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop
    };
  });
  expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
  expect(scrollState.scrollTop).toBeGreaterThan(0);
  await expect(dialog.getByRole("button", { name: /^xAI\b/u })).toBeVisible();
  const layoutColumns = await dialog.locator(".provider-credential-layout").evaluate((element) => (
    getComputedStyle(element).gridTemplateColumns
  ));
  expect(layoutColumns.split(" ")).toHaveLength(1);
  await expect(dialog.getByRole("button", { name: "仅本次运行" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(680);
  await page.screenshot({ path: testInfo.outputPath("credential-dialog-narrow-dark.png"), animations: "disabled" });
});

async function openProviderDialog(page: Page): Promise<void> {
  const settings = await openSettingsSection(page, /^模型服务/u);
  const editor = settings.getByTestId("provider-configuration-editor");
  if (!(await editor.isVisible())) {
    await settings.getByRole("button", { name: /^OpenAI\b/u }).click();
  }
  await expect(editor).toBeVisible();
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
