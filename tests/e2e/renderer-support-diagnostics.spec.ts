import { expect, test, type Page } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge
} from "./pi67-renderer-fixture.js";

test("keeps support upload pending, receipt, failure, retry, and local fallback explicit", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "更新与诊断", exact: true }).click();
  const row = settings.getByText("上传脱敏诊断", { exact: true }).locator("xpath=../..");
  await expect(row).toContainText("仅手动");
  await expect(row).toContainText("仅在你点击后上传");
  await page.screenshot({ path: testInfo.outputPath("support-upload-idle-light.png"), animations: "disabled" });

  await setUploadMode(page, "pending");
  const upload = row.getByRole("button", { name: "上传脱敏诊断", exact: true });
  await upload.click();
  await expect(upload).toBeDisabled();
  await expect(row).toContainText("正在收集 Main、Agent Host 与恢复状态并上传");
  await expect.poll(() => uploadAttempts(page)).toBe(1);
  await finishPendingUpload(page);

  await expect(row).toContainText("PI67-A1B2C3D4E5F6");
  await expect(row).toContainText("30 天后自动删除");
  await expect(row).toContainText("精确对象键");
  await expect(row.getByRole("button", { name: "复制诊断定位信息 PI67-A1B2C3D4E5F6" })).toBeVisible();
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: testInfo.outputPath("support-upload-success-dark.png"), animations: "disabled" });

  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await setUploadMode(page, "failure");
  await row.getByRole("button", { name: "再次上传", exact: true }).click();
  await expect(row).toContainText("上传未完成：诊断上传服务暂时不可用");
  await expect(row.getByRole("button", { name: "导出到本地", exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "重试上传", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("support-upload-error-light.png"), animations: "disabled" });

  await setUploadMode(page, "success");
  await row.getByRole("button", { name: "重试上传", exact: true }).click();
  await expect(row).toContainText("PI67-A1B2C3D4E5F6");
  await expect.poll(() => uploadAttempts(page)).toBe(3);
});

async function setUploadMode(page: Page, mode: "success" | "failure" | "pending"): Promise<void> {
  await page.evaluate((nextMode) => {
    (window as typeof window & {
      __pi67SupportDiagnosticsTest: { setMode(mode: typeof nextMode): void };
    }).__pi67SupportDiagnosticsTest.setMode(nextMode);
  }, mode);
}

async function finishPendingUpload(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as typeof window & {
      __pi67SupportDiagnosticsTest: { finishPending(): void };
    }).__pi67SupportDiagnosticsTest.finishPending();
  });
}

async function uploadAttempts(page: Page): Promise<number> {
  return page.evaluate(() => (
    window as typeof window & {
      __pi67SupportDiagnosticsTest: { attempts: number };
    }
  ).__pi67SupportDiagnosticsTest.attempts);
}
