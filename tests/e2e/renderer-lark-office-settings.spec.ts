import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge,
  recordedCommandDetails,
  setMockAgentResponseResult
} from "./pi67-renderer-fixture.js";

const DISCONNECTED = {
  cliStatus: "ready",
  phase: "disconnected",
  verified: false,
  checkedAt: 1_754_731_200_000,
  appStatus: "ready",
  appId: "cli_test123",
  appBrand: "feishu",
  appName: "Pi-67 Office",
  detail: "尚未获得有效的飞书用户授权。"
} as const;

const AUTHORIZING = {
  cliStatus: "ready",
  phase: "authorizing",
  verified: false,
  checkedAt: 1_754_731_201_000,
  appStatus: "ready",
  appId: "cli_test123",
  appBrand: "feishu",
  appName: "Pi-67 Office",
  detail: "授权页已打开；完成飞书确认后会自动更新连接状态。"
} as const;

const UNCONFIGURED = {
  cliStatus: "ready",
  phase: "disconnected",
  verified: false,
  checkedAt: 1_754_731_200_000,
  appStatus: "missing",
  detail: "尚未配置飞书开放平台应用。"
} as const;

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("configures a user-managed Feishu app and keeps user authorization separate", async ({ page }, testInfo) => {
  const visualArtifactDirectory = process.env.PI67_VISUAL_ARTIFACT_DIR;
  if (visualArtifactDirectory) await mkdir(visualArtifactDirectory, { recursive: true });
  const verificationUrl = "https://open.feishu.cn/device?state=pi67-test";
  await page.goto("/");
  await attachMockAgent(page, [], {}, {
    responseResults: {
      "lark.auth.status": DISCONNECTED,
      "lark.app.configuration.save": {
        ...DISCONNECTED,
        checkedAt: 1_754_731_200_500,
        appId: "cli_updated123",
        appName: "用户应用"
      },
      "lark.auth.login.begin": {
        status: AUTHORIZING,
        verificationUrl,
        userCode: "ABCD-EFGH",
        authorizationExpiresAt: 1_754_731_800_000
      }
    }
  });
  await page.getByRole("button", { name: "选择工作区" }).click();
  const settings = await openLarkSettings(page);

  await expect(settings.getByRole("heading", { name: "飞书", exact: true, level: 1 })).toBeVisible();
  const userTab = settings.getByRole("tab", { name: "用户授权", exact: true });
  const applicationTab = settings.getByRole("tab", { name: "应用配置", exact: true });
  await expect(userTab).toHaveAttribute("aria-selected", "true");
  await expect(applicationTab).toHaveAttribute("aria-selected", "false");
  await expect(settings.getByRole("heading", { name: "用户授权", exact: true })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "飞书应用", exact: true })).toBeHidden();
  await expect(settings.getByRole("button", { name: "登录飞书", exact: true })).toBeVisible();

  await applicationTab.click();
  await expect(applicationTab).toHaveAttribute("aria-selected", "true");
  await expect(settings.getByRole("heading", { name: "飞书应用", exact: true })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "用户授权", exact: true })).toBeHidden();
  await expect(settings.getByText("Pi-67 Office", { exact: true })).toBeVisible();
  await expect(settings.getByText("cli_test123", { exact: true })).toBeVisible();
  await expect(settings.getByText("已安全保存", { exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "编辑配置", exact: true })).toBeVisible();

  await settings.getByRole("button", { name: "编辑配置", exact: true }).click();
  const applicationForm = settings.getByRole("form", { name: "飞书应用配置" });
  await expect(applicationForm.getByLabel("App ID")).toHaveValue("cli_test123");
  await applicationForm.getByLabel("App ID").fill("cli_updated123");
  const appSecret = applicationForm.getByLabel("App Secret", { exact: true });
  await appSecret.fill("fixture-app-secret-value");
  await applicationForm.getByRole("button", { name: "显示 App Secret" }).click();
  await expect(appSecret).toHaveAttribute("type", "text");
  await expect(appSecret).toHaveValue("fixture-app-secret-value");
  await applicationForm.getByRole("button", { name: "验证并保存" }).click();
  await expect(settings.getByText("cli_updated123", { exact: true })).toBeVisible();
  await expect(settings.getByText("用户应用", { exact: true })).toBeVisible();
  await expect(applicationForm).toHaveCount(0);
  const applicationScreenshotPath = visualArtifactDirectory
    ? resolve(visualArtifactDirectory, "lark-office-settings-application-light.png")
    : testInfo.outputPath("lark-office-settings-application-light.png");
  await page.screenshot({ path: applicationScreenshotPath, animations: "disabled" });
  await testInfo.attach("lark-office-settings-application-light", {
    path: applicationScreenshotPath,
    contentType: "image/png"
  });

  await page.evaluate(() => {
    (window as unknown as { __pi67UpdateTest: { allowOpen: boolean } }).__pi67UpdateTest.allowOpen = true;
  });
  await setMockAgentResponseResult(page, "lark.auth.status", AUTHORIZING);
  await userTab.click();
  await expect(userTab).toHaveAttribute("aria-selected", "true");
  await settings.getByRole("button", { name: "登录飞书", exact: true }).click();

  await expect(settings.getByText(/验证码：/u)).toContainText("ABCD-EFGH");
  await expect(settings.getByRole("button", { name: "打开授权页", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __pi67UpdateTest: { openedUrls: string[] } }
  ).__pi67UpdateTest.openedUrls)).toEqual([verificationUrl]);
  await expect.poll(async () => (await recordedCommandDetails(page)).filter((command) => (
    command.type === "lark.auth.status"
  )).length, { timeout: 5_000 }).toBeGreaterThanOrEqual(3);

  await setMockAgentResponseResult(page, "lark.auth.status", {
    cliStatus: "ready",
    phase: "connected",
    verified: true,
    checkedAt: 1_754_731_210_000,
    appStatus: "ready",
    appId: "cli_updated123",
    appBrand: "feishu",
    appName: "Pi-67 Office",
    userName: "测试用户",
    tokenStatus: "needs-refresh",
    tokenExpiresAt: 1_754_817_600_000,
    detail: "飞书用户身份可用，访问令牌将在下一次用户 API 调用时自动续期。"
  });
  await expect(settings.getByText("测试用户", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(settings.getByText("待自动续期", { exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "重新授权", exact: true })).toBeVisible();
  await expect(settings.getByText(/下一次用户身份 API 调用时自动完成续期/u)).toBeVisible();

  const commands = (await recordedCommandDetails(page)).filter((command) => (
    command.type === "lark.auth.status"
    || command.type === "lark.auth.login.begin"
    || command.type === "lark.app.configuration.save"
  ));
  expect(commands.length).toBeGreaterThanOrEqual(3);
  expect(commands.every((command) => command.context?.scope === "app")).toBe(true);
  expect(commands.find((command) => command.type === "lark.app.configuration.save")?.payload).toEqual({
    appId: "cli_updated123",
    appSecret: "[redacted]",
    brand: "feishu"
  });
  const rendered = await settings.textContent();
  for (const forbidden of [
    "fixture-user-token-value",
    "fixture-device-code-value",
    "ou_fixture_open_id",
    "fixture-app-secret-value"
  ]) expect(rendered).not.toContain(forbidden);
  const lightScreenshotPath = visualArtifactDirectory
    ? resolve(visualArtifactDirectory, "lark-office-settings-light.png")
    : testInfo.outputPath("lark-office-settings-light.png");
  await page.screenshot({ path: lightScreenshotPath, animations: "disabled" });
  await testInfo.attach("lark-office-settings-light", {
    path: lightScreenshotPath,
    contentType: "image/png"
  });

  await page.emulateMedia({ colorScheme: "dark" });
  const darkScreenshotPath = visualArtifactDirectory
    ? resolve(visualArtifactDirectory, "lark-office-settings-dark.png")
    : testInfo.outputPath("lark-office-settings-dark.png");
  await page.screenshot({ path: darkScreenshotPath, animations: "disabled" });
  await testInfo.attach("lark-office-settings-dark", {
    path: darkScreenshotPath,
    contentType: "image/png"
  });
});

test("routes an unconfigured user authorization to application configuration", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [], {}, {
    responseResults: { "lark.auth.status": UNCONFIGURED }
  });
  await page.getByRole("button", { name: "选择工作区" }).click();
  const settings = await openLarkSettings(page);

  const userTab = settings.getByRole("tab", { name: "用户授权", exact: true });
  const applicationTab = settings.getByRole("tab", { name: "应用配置", exact: true });
  await expect(userTab).toHaveAttribute("aria-selected", "true");
  await expect(settings.getByText("请先配置并验证飞书应用，再登录个人飞书账号。")).toBeVisible();
  await settings.getByRole("button", { name: "前往应用配置", exact: true }).click();
  await expect(applicationTab).toHaveAttribute("aria-selected", "true");
  await expect(settings.getByRole("heading", { name: "飞书应用", exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "配置应用", exact: true })).toBeVisible();
});

async function openLarkSettings(page: Page) {
  await page.getByRole("button", { name: "帮助与设置" }).click();
  await page.getByRole("menu", { name: "帮助与设置" })
    .getByRole("menuitem", { name: "设置", exact: true }).click();
  const settings = page.getByLabel("π 设置");
  await expect(settings).toBeVisible();
  await expect(settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("group", { name: "办公" })).toBeVisible();
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "飞书", exact: true }).click();
  return settings;
}
