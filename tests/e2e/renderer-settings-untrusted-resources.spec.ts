import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge
} from "./pi67-renderer-fixture.js";
import { DEFAULT_MOCK_WORKSPACE } from "./pi67-renderer-desktop-bridge.js";

test("explains why project skills are unavailable for an untrusted workspace", async ({ page }) => {
  await installMockDesktopBridge(page, {
    pickerQueue: [{
      ...DEFAULT_MOCK_WORKSPACE,
      trust: "untrusted",
      trustProvenance: "user-confirmed"
    }]
  });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "技能", exact: true }).click();
  const workspace = settings.getByTestId("skill-settings-workspace");
  await workspace.getByRole("tab", { name: "项目专属", exact: true }).click();
  await expect(workspace.getByText("当前项目尚未受信任", { exact: false })).toBeVisible();
  await expect(workspace.getByText("project-review", { exact: true })).toHaveCount(0);
});
