import { expect, test } from "@playwright/test";
import { setMockAgentResponseResult } from "./pi67-renderer-fixture.js";
import {
  openPackageSettings,
  packageEntry,
  type PackageEntry
} from "./pi67-renderer-package-settings-fixture.js";

test("separates content confirmation from resource state and reports ambiguous installs", async ({ page }) => {
  const driftedSource = "npm:@example/drifted-extension";
  const ambiguousSource = "npm:@example/ambiguous-extension";
  const driftedEntry: PackageEntry = {
    ...packageEntry(driftedSource, "global"),
    trustState: "drifted",
    trustReason: "content-hash-changed",
    trustObservedAt: 1_786_000_000_000
  };
  await openPackageSettings(page, [driftedEntry]);

  const workspace = page.getByTestId("extension-management-workspace");
  const driftedRow = workspace.getByRole("button", {
    name: /drifted-extension，npm:@example\/drifted-extension · 全局/u
  });
  await expect(driftedRow.locator("xpath=ancestor::li[1]").getByText("内容已变更", { exact: true })).toBeVisible();
  await driftedRow.click();
  await expect(workspace.getByText("内容已变更，等待重新确认", { exact: true })).toBeVisible();
  await expect(workspace.getByText("包内容与安装记录不一致", { exact: true })).toBeVisible();
  await expect(workspace.getByRole("button", { name: `停用 扩展 ${driftedSource}` })).toBeDisabled();
  const { trustReason: _trustReason, ...approvedEntry } = driftedEntry;
  await setMockAgentResponseResult(page, "extension.package.approveObserved", {
    changed: true,
    receiptState: "active",
    reloadRequired: true,
    items: [{ ...approvedEntry, trustState: "user-approved-observed" }],
    total: 1
  });
  await workspace.getByRole("button", { name: `重新确认 ${driftedSource} 当前内容` }).click();
  await expect(page.getByText("扩展包内容已确认", { exact: true })).toBeVisible();
  await expect(page.getByText("正在运行的任务继续使用原资源", { exact: false })).toBeVisible();
  await workspace.getByRole("button", { name: "返回扩展包列表" }).click();

  await setMockAgentResponseResult(page, "extension.package.install", {
    changed: true,
    receiptState: "ambiguous",
    items: [
      driftedEntry,
      {
        ...packageEntry(ambiguousSource, "global"),
        trustState: "unverified",
        trustReason: "mutation-ambiguous"
      }
    ],
    total: 2
  });
  await page.getByRole("button", { name: "安装扩展包" }).click();
  const installDialog = page.getByRole("dialog", { name: "安装 Pi 扩展包" });
  await installDialog.getByRole("textbox", { name: "npm 包、Git URL 或本地目录" }).fill(ambiguousSource);
  await installDialog.getByRole("button", { name: "确认安装" }).click();

  await expect(page.getByText("扩展包操作结果需要核对", { exact: true })).toBeVisible();
  await expect(page.getByText("扩展包已安装", { exact: true })).toHaveCount(0);
  const ambiguousRow = workspace.getByRole("button", {
    name: /ambiguous-extension，npm:@example\/ambiguous-extension · 全局/u
  });
  await expect(ambiguousRow.locator("xpath=ancestor::li[1]").getByText("待确认", { exact: true })).toBeVisible();
});
