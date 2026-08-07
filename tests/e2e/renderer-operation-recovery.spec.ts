import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  emitMockAgentEvent,
  installMockDesktopBridge,
  recordedCommands,
  setMockResyncOperations
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("restores the interrupted Operation terminal after a sequence-gap resync", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [], {}, { autoStartOperation: true });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  await page.getByLabel("给 Pi 发送消息").fill("运行直到连接重新同步");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible();

  await setMockResyncOperations(page, {
    latestOperationTerminal: terminalReceipt("operation-1")
  });
  await emitMockAgentEvent(page, {
    type: "resource.changed",
    payload: { reason: "force-operation-recovery" }
  }, { sequence: 100, operationId: "operation-1" });

  await expect.poll(async () => (await recordedCommands(page)).includes("projection.resync")).toBe(true);
  await expect(page.locator("[data-turn-activity]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);
  await expect(page.locator('[data-runtime-phase="ready"]')).toBeVisible();
  await expect(page.locator("[data-notification-id]").filter({ hasText: "任务已完成" })).toHaveCount(1);

  await emitMockAgentEvent(page, {
    type: "operation.completed",
    payload: { operationId: "operation-1", completedAt: 20 }
  }, { sequence: 101, operationId: "operation-1" });
  await expect(page.locator("[data-notification-id]").filter({ hasText: "任务已完成" })).toHaveCount(1);

  await page.getByRole("button", { name: "打开通知中心，1 条未读" }).click();
  const center = page.getByRole("dialog", { name: "通知中心" });
  await expect(center.getByRole("listitem").filter({ hasText: "任务已完成" })).toHaveCount(1);
});

test("does not restore an unrelated historical terminal after resync", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [], {}, { autoStartOperation: true });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  await page.getByLabel("给 Pi 发送消息").fill("不要恢复其他任务的状态");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible();

  await setMockResyncOperations(page, {
    latestOperationTerminal: terminalReceipt("operation-unrelated")
  });
  await emitMockAgentEvent(page, {
    type: "resource.changed",
    payload: { reason: "force-unrelated-terminal" }
  }, { sequence: 100, operationId: "operation-1" });

  await expect.poll(async () => (await recordedCommands(page)).includes("projection.resync")).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: "任务已完成" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "停止" })).toHaveCount(0);
  await expect(page.locator('[data-runtime-phase="ready"]')).toBeVisible();
});

function terminalReceipt(operationId: string) {
  return {
    kind: "settled" as const,
    operationId,
    operationKind: "prompt" as const,
    lifecycle: "completed" as const,
    cancellable: false as const,
    hostEpoch: 1,
    sessionId: "session-test",
    sessionFileIdentity: "session-file-fixture-demo",
    sessionGeneration: 1,
    startedAt: 10,
    settledAt: 20
  };
}
