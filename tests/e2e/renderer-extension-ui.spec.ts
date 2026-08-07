import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  emitMockAgentEvent,
  installMockDesktopBridge,
  recordedCommands,
  replaceMockAgentHost,
  waitForMockWorkspaceReady
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("clears stale Extension UI and restores the session after Host epoch replacement", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);
  await clearRecordedCommands(page);
  const operationId = "operation-old-host";

  await emitMockAgentEvent(page, {
    type: "operation.started",
    payload: {
      operation: {
        operationId,
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-test",
        sessionFileIdentity: "session-file-fixture-demo",
        sessionGeneration: 1,
        startedAt: Date.now()
      }
    }
  }, { operationId });
  await emitMockAgentEvent(page, {
    type: "extension.ui.requested",
    payload: {
      requestId: "extension-old-host",
      extensionId: "fixture-extension",
      hostEpoch: 1,
      sessionId: "session-test",
      sessionGeneration: 1,
      operationId,
      kind: "confirm",
      title: "旧 Host 请求",
      message: "是否继续？",
      blocking: true
    }
  }, { operationId });
  await emitMockAgentEvent(page, {
    type: "extension.ui.updated",
    payload: {
      requestId: "extension-title-old-host",
      hostEpoch: 1,
      sessionId: "session-test",
      sessionGeneration: 1,
      operationId,
      kind: "title",
      message: "旧 Host 标题",
      blocking: false
    }
  }, { operationId });
  await emitMockAgentEvent(page, {
    type: "extension.ui.updated",
    payload: {
      requestId: "extension-widget-old-host",
      hostEpoch: 1,
      sessionId: "session-test",
      sessionGeneration: 1,
      operationId,
      kind: "widget",
      key: "old-host-widget",
      message: "旧 Host 状态",
      placement: "belowEditor",
      blocking: false
    }
  }, { operationId });
  await expect(page.getByRole("dialog", { name: "旧 Host 请求" })).toBeVisible();
  await expect.poll(() => page.title()).toBe("旧 Host 标题 - π");
  await expect(page.getByText("旧 Host 状态")).toBeVisible();

  await replaceMockAgentHost(page, 2);
  await expect(page.getByRole("dialog", { name: "旧 Host 请求" })).toHaveCount(0);
  await expect.poll(() => page.title()).toBe("π");
  await expect(page.getByText("旧 Host 状态")).toHaveCount(0);
  await expect.poll(async () => (await recordedCommands(page)).filter((type) => type === "runtime.initialize").length).toBe(1);
  await expect(page.getByText("Pi 会话已恢复")).toBeVisible();
  await emitMockAgentEvent(page, {
    type: "operation.failed",
    payload: {
      operationId,
      failedAt: Date.now(),
      error: { code: "INTERNAL", message: "旧 Host 错误", recoverable: true }
    }
  }, { hostEpoch: 1, operationId });
  await expect(page.getByText("旧 Host 错误")).toHaveCount(0);
});
