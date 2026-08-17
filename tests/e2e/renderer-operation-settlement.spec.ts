import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  emitMockAgentEvent,
  installMockDesktopBridge,
  setMockConversationMessages,
  waitForMockWorkspaceReady
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("reconciles a completed Operation with its committed Assistant answer", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);

  const operationId = "operation-completed-with-settled-answer";
  const startedAt = Date.now() - 2_000;
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
        startedAt
      }
    }
  }, { operationId });
  await emitMockAgentEvent(page, {
    type: "operation.activityChanged",
    payload: { operationId, activity: { kind: "responding" } }
  }, { operationId });
  await setMockConversationMessages(page, [
    {
      id: "settled-answer-user",
      role: "user",
      parts: [{ type: "text", text: "你是谁" }]
    },
    {
      id: "settled-answer-assistant",
      role: "assistant",
      parts: [{ type: "text", text: "我是运行在 Pi-67 Desktop 里的 AI 助手。" }]
    }
  ]);
  await emitMockAgentEvent(page, {
    type: "conversation.changed",
    payload: { sessionId: "session-test", reason: "settled" }
  }, { operationId });
  await expect(page.getByText("我是运行在 Pi-67 Desktop 里的 AI 助手。", { exact: true })).toBeVisible();

  await emitMockAgentEvent(page, {
    type: "operation.completed",
    payload: { operationId, completedAt: startedAt + 2_000 }
  }, { operationId });
  const timeline = page.locator("[data-turn-activity][data-operation-lifecycle='completed']");
  await expect(timeline).toContainText("执行完成");
  await expect(timeline).not.toContainText("执行未完整收口");
  await expect(timeline).not.toHaveAttribute("open", "");
});
