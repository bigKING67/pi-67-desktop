import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  emitMockAgentEvent,
  installMockDesktopBridge,
  setMockConversationMessages
} from "./pi67-renderer-fixture.js";
import { scenarioCommands, scenarioCommandTypes } from "./pi67-renderer-scenario-commands.js";
import type { FixtureMessage } from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("renders a native Plan proposal and starts it with identifier-only confirmation", async ({ page }) => {
  const proposedPlanMessage = planMessage("proposed");
  await page.goto("/");
  await attachMockAgent(page, [proposedPlanMessage], {}, { terminalDelayMs: 90_000 });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  await emitMockAgentEvent(page, {
    type: "plan.proposed",
    payload: {
      plan: {
        planId: "plan-fixture-1",
        sourceOperationId: "operation-plan-source",
        markdown: "# 实施计划\n\n1. 检查现有合同\n2. 完成实现与验证",
        createdAt: 67
      }
    }
  });

  const card = page.getByTestId("plan-proposal-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("实施计划");
  await expect(card).toContainText("待确认");
  await expect(card.getByRole("button", { name: "开始执行", exact: true })).toHaveCount(0);
  await page.screenshot({
    path: "artifacts/visual-review/plan-proposal-wide.png",
    animations: "disabled"
  });
  await card.getByRole("button", { name: /实施计划/u }).click();
  await expect(card.getByText("检查现有合同")).toHaveCount(0);
  await card.getByRole("button", { name: /实施计划/u }).click();

  const actionBar = page.getByTestId("active-plan-action-bar");
  await expect(actionBar).toBeVisible();
  await actionBar.getByRole("button", { name: "继续完善" }).click();
  await expect(page.getByLabel("给 Pi 发送消息")).toHaveValue(/继续完善当前计划/u);
  await page.getByLabel("给 Pi 发送消息").fill("");
  await page.setViewportSize({ width: 720, height: 480 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await expect(actionBar.getByRole("button", { name: "开始执行", exact: true })).toBeVisible();
  await expect(page.getByLabel("给 Pi 发送消息")).toBeVisible();
  await page.screenshot({
    path: "artifacts/visual-review/plan-proposal-narrow.png",
    animations: "disabled"
  });

  await actionBar.getByRole("button", { name: "开始执行", exact: true }).click();
  await expect.poll(() => scenarioCommandTypes(page)).toEqual(["plan.implement"]);
  const [command] = await scenarioCommands(page);
  expect(command?.payload).toMatchObject({
    planId: "plan-fixture-1",
    submissionId: expect.stringMatching(UUID_PATTERN)
  });
  expect(JSON.stringify(command?.payload)).not.toContain("实施计划");
  await expect(actionBar).toHaveCount(0);
  await setMockConversationMessages(page, [planMessage("implemented")]);
  await emitMockAgentEvent(page, {
    type: "conversation.changed",
    payload: { sessionId: "session-test", reason: "settled" }
  });
  await expect(card).toBeVisible();
  await expect(card).toContainText("已开始执行");
  await expect(card.getByRole("button", { name: "复制计划" })).toBeVisible();
  await expect(card.getByRole("button", { name: "开始执行", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("transcript-process-group")).toContainText("正在继续处理");
});

function planMessage(status: "proposed" | "implemented"): FixtureMessage {
  return {
    id: "plan-entry-fixture-1",
    role: "system",
    createdAt: 67,
    parts: [{
      type: "plan-proposal",
      plan: {
        entryId: "plan-entry-fixture-1",
        planId: "plan-fixture-1",
        sourceOperationId: "operation-plan-source",
        markdown: "# 实施计划\n\n1. 检查现有合同\n2. 完成实现与验证",
        createdAt: 67,
        status
      }
    }]
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
