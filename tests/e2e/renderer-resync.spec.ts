import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  emitMockAgentEvent,
  installMockDesktopBridge,
  recordedCommands
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("resynchronizes the projection after an event sequence gap without guessing the missing event", async ({ page }) => {
  await page.goto("/");
  // Keep the recovery state observable long enough for Chromium's accessibility tree to update.
  await attachMockAgent(page, [], { "projection.resync": 1_500 });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  await emitMockAgentEvent(page, {
    type: "resource.changed",
    payload: { reason: "missing-event" }
  }, { sequence: 100 });
  await expect(page.getByRole("status").filter({ hasText: "检测到状态事件缺口" })).toBeVisible();
  await expect(page.getByText("Pi 资源已重新加载", { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await recordedCommands(page)).filter((command) => (
    command === "projection.resync"
  ))).toEqual(["projection.resync"]);
  await expect(page.getByText("Pi 状态已重新同步")).toBeVisible();

  await emitMockAgentEvent(page, {
    type: "resource.changed",
    payload: { reason: "after-resync" }
  });
  await expect(page.getByLabel("通知").getByText("Pi 资源已重新加载", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /打开通知中心/u }).click();
  await expect(page.getByRole("dialog", { name: "通知中心" })
    .getByText("Pi 资源已重新加载", { exact: true })).toBeVisible();
});
