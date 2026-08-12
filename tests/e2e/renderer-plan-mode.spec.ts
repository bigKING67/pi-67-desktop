import { expect, test, type Page } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  currentMockSessionAuthority,
  emitMockAgentEvent,
  installMockDesktopBridge
} from "./pi67-renderer-fixture.js";
import { scenarioCommands, scenarioCommandTypes } from "./pi67-renderer-scenario-commands.js";
import type { FixtureMessage } from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("submits the user's Composer context when refining a proposed Plan", async ({ page }) => {
  await openPlanScenario(page);
  const card = page.getByTestId("plan-proposal-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("实施计划");
  await expect(card).toContainText("待确认");
  await expect(card.getByRole("button", { name: "开始执行", exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: /实施计划/u }).click();
  await expect(card.getByText("检查现有合同")).toHaveCount(0);
  await card.getByRole("button", { name: /实施计划/u }).click();

  const actionBar = page.getByTestId("active-plan-action-bar");
  await expect(actionBar).toBeVisible();
  const refinement = "请补充回滚策略，不要改变现有接口。";
  await page.getByLabel("给 Pi 发送消息").fill(refinement);
  await expect(actionBar.getByRole("button", { name: "继续完善" })).toBeVisible();
  await actionBar.getByRole("button", { name: "继续完善" }).click();
  await expect.poll(() => scenarioCommandTypes(page)).toEqual(["prompt.submit"]);
  const [command] = await scenarioCommands(page);
  expect(command).toMatchObject({
    type: "prompt.submit",
    payload: { text: refinement, delivery: "new-turn" }
  });
  expect(JSON.stringify(command?.payload)).not.toContain("请继续完善当前计划");
  expect(await scenarioCommandTypes(page)).not.toContain("plan.implement");
});

test("keeps the Plan actionable until authoritative Pi start and submits identifiers only", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await openPlanScenario(page, 2_000);
  const card = page.getByTestId("plan-proposal-card");
  const actionBar = page.getByTestId("active-plan-action-bar");

  await expect(actionBar).toBeVisible();
  await expect(actionBar.getByRole("button", { name: "开始执行", exact: true })).toBeVisible();
  await actionBar.getByRole("button", { name: "开始执行", exact: true }).click();
  await expect.poll(() => scenarioCommandTypes(page)).toEqual(["plan.implement"]);
  const [command] = await scenarioCommands(page);
  expect(command?.payload).toMatchObject({
    planId: "plan-fixture-1",
    submissionId: expect.stringMatching(UUID_PATTERN)
  });
  expect(JSON.stringify(command?.payload)).not.toContain("实施计划");

  await expect(actionBar).toBeVisible();
  await expect(actionBar).toContainText("正在启动计划");
  await expect(actionBar.getByRole("button", { name: "正在启动" })).toBeDisabled();
  await page.setViewportSize({ width: 720, height: 480 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await expect(page.getByLabel("给 Pi 发送消息")).toBeVisible();
  await page.screenshot({
    path: "artifacts/visual-review/plan-proposal-narrow.png",
    animations: "disabled"
  });

  await expect(actionBar).toHaveCount(0);
  await expect(card).toBeVisible();
  await expect(card).toContainText("已开始执行");
  await expect(card.getByRole("button", { name: "复制计划" })).toBeVisible();
  await expect(card.getByRole("button", { name: "开始执行", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("transcript-process-group")).toContainText("正在继续处理");
});

test("restores a Plan for one-click retry when implementation fails before Pi start", async ({ page }) => {
  await openPlanScenario(page, 90_000);
  const actionBar = page.getByTestId("active-plan-action-bar");
  await actionBar.getByRole("button", { name: "开始执行", exact: true }).click();
  await expect.poll(() => scenarioCommandTypes(page)).toEqual(["plan.implement"]);
  const [firstCommand] = await scenarioCommands(page);
  if (!firstCommand || typeof firstCommand.payload !== "object" || firstCommand.payload === null) {
    throw new Error("Expected the first Plan implementation command.");
  }
  const firstPayload = firstCommand.payload as { submissionId: string };
  const authority = await currentMockSessionAuthority(page);
  const operationId = await page.evaluate(() => {
    const counter = (window as unknown as {
      __pi67TestAgent: { operationCounter: number };
    }).__pi67TestAgent.operationCounter;
    return `operation-${counter}`;
  });

  await expect(actionBar).toContainText("正在启动计划");
  await emitMockAgentEvent(page, {
    type: "plan.lifecycleChanged",
    payload: {
      phase: "implementation-start-failed",
      planId: "plan-fixture-1",
      sourceOperationId: "operation-plan-source",
      submissionId: firstPayload.submissionId,
      operationId,
      hostEpoch: firstCommand.hostEpoch,
      ...authority,
      timestamp: Date.now()
    }
  }, { operationId });
  await emitMockAgentEvent(page, {
    type: "operation.failed",
    payload: {
      operationId,
      failedAt: Date.now(),
      error: { code: "INTERNAL", message: "Pi start failed", recoverable: true }
    }
  }, { operationId });

  await expect(actionBar).toBeVisible();
  await expect(actionBar).toContainText("Pi start failed");
  await expect(actionBar.getByRole("button", { name: "开始执行", exact: true })).toBeEnabled();
  await actionBar.getByRole("button", { name: "开始执行", exact: true }).click();
  await expect.poll(() => scenarioCommandTypes(page)).toEqual(["plan.implement", "plan.implement"]);
  const commands = await scenarioCommands(page);
  const secondPayload = commands[1]?.payload as { submissionId?: string } | undefined;
  expect(secondPayload?.submissionId).toMatch(UUID_PATTERN);
  expect(secondPayload?.submissionId).not.toBe(firstPayload.submissionId);
});

async function openPlanScenario(page: Page, planImplementationStartDelayMs = 0): Promise<void> {
  await page.goto("/");
  await attachMockAgent(page, [planMessage("proposed")], {}, {
    terminalDelayMs: 90_000,
    planImplementationStartDelayMs
  });
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
  await expect(page.getByTestId("active-plan-action-bar")).toBeVisible({ timeout: 15_000 });
}

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
