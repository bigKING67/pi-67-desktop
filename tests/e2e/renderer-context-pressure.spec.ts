import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  emitMockAgentEvent,
  installMockDesktopBridge,
  recordedCommandDetails,
  recordedCommands
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("shows warning and critical context pressure and invokes native Session compaction", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  await emitUsage(page, 92);
  const critical = page.getByRole("status", { name: "上下文接近上限 92%" });
  await expect(critical).toHaveAttribute("data-tone", "critical");
  await expect(critical.getByRole("button", { name: "压缩", exact: true })).toBeVisible();

  await emitUsage(page, 75);
  const warning = page.getByRole("status", { name: "上下文偏高 75%" });
  await expect(warning).toHaveAttribute("data-tone", "warning");
  await warning.getByRole("button", { name: "压缩", exact: true }).click();
  await expect.poll(async () => (await recordedCommands(page)).filter((type) => (
    type === "session.compact"
  ))).toEqual(["session.compact"]);
  expect((await recordedCommandDetails(page)).find((command) => command.type === "session.compact")?.payload)
    .toMatchObject({ submissionId: expect.stringMatching(/^compaction-/u) });
});

test("distinguishes automatic compaction and respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await emitUsage(page, 94);

  const operationId = "operation-automatic-compaction";
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
        startedAt: 100
      }
    }
  }, { operationId });
  await emitMockAgentEvent(page, {
    type: "operation.activityChanged",
    payload: { operationId, activity: { kind: "compaction" } }
  }, { operationId });

  const automatic = page.getByRole("status", { name: "自动压缩中 94%" });
  await expect(automatic).toContainText("自动压缩中");
  await expect(automatic.getByRole("button", { name: "压缩", exact: true })).toHaveCount(0);
  const animationName = await automatic.locator("svg").last().evaluate((element) => (
    getComputedStyle(element).animationName
  ));
  expect(animationName).toBe("none");
});

async function emitUsage(page: Parameters<typeof emitMockAgentEvent>[0], contextPercent: number) {
  await emitMockAgentEvent(page, {
    type: "usage.changed",
    payload: { tokens: 12_000, cost: 0.2, contextPercent }
  });
}
