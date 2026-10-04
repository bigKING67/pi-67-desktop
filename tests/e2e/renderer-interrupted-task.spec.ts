import { expect, test } from "@playwright/test";
import { attachMockAgent, clearRecordedCommands, installMockDesktopBridge, recordedCommandDetails } from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => { await installMockDesktopBridge(page); });

test("requires an explicit continuation, keeps one pending submission and starts the native operation", async ({ page }, testInfo) => {
  await page.goto("/");
  await attachMockAgent(page, [{ id: "task-user", role: "user", parts: [{ type: "text", text: "请继续检查这个示例项目的运行入口。" }] }], { "session.recovery.continue": 800 }, { responseResults: {
    "session.recovery.inspect": { status: "available", anchor: "leaf-1" },
    "session.recovery.continue": { kind: "accepted", operationId: "recovery-1", cancellable: true, hostEpoch: 1,
      sessionId: "session-test", sessionFileIdentity: "session-file-fixture-demo", sessionGeneration: 1 }
  } });
  await page.getByRole("button", { name: "选择工作区" }).click();
  const notice = page.getByTestId("interrupted-task-notice");
  await expect(notice).toContainText("上次任务尚未完成");
  await expect(notice).toContainText("Auto 沿用上次的选择");
  expect((await recordedCommandDetails(page)).filter(command => command.type === "session.recovery.continue")).toHaveLength(0);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    await page.screenshot({ path: testInfo.outputPath(`recovery-${colorScheme}.png`), animations: "disabled" });
  }
  await clearRecordedCommands(page);
  await notice.getByRole("button", { name: "继续当前任务" }).click();
  await expect(notice.getByRole("button", { name: "正在接续…" })).toBeDisabled();
  await expect(notice.getByRole("button", { name: "重新检查" })).toBeDisabled();
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole("button", { name: "停止", exact: true })).toBeVisible();
  const requests = (await recordedCommandDetails(page)).filter(command => command.type === "session.recovery.continue");
  expect(requests).toHaveLength(1);
  expect(requests[0]?.payload).toEqual({ anchor: "leaf-1", submissionId: expect.any(String) });
});

test("blocks unknown tool outcomes without offering continuation", async ({ page }, testInfo) => {
  await page.goto("/");
  await attachMockAgent(page, [{ id: "task-user", role: "user", parts: [{ type: "text", text: "请运行示例项目的本地检查。" }] }], {}, { responseResults: {
    "session.recovery.inspect": { status: "blocked", reason: "unconfirmed-tools", pendingToolCount: 2 }
  } });
  await page.getByRole("button", { name: "选择工作区" }).click();
  const notice = page.getByTestId("interrupted-task-notice");
  await expect(notice).toContainText("2 个工具调用没有结果记录");
  await expect(notice.getByRole("button", { name: "继续当前任务" })).toHaveCount(0);
  await notice.getByRole("button", { name: "重新检查" }).click();
  await expect(notice).toContainText("继续前需要核对任务");
  await page.screenshot({ path: testInfo.outputPath("recovery-review-required.png"), animations: "disabled" });
  expect((await recordedCommandDetails(page)).filter(command => command.type === "session.recovery.continue")).toHaveLength(0);
});

test("does not show unfinished-work claims for a completed branch", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.getByLabel("给 Pi 发送消息")).toBeVisible();
  await expect.poll(async () => (await recordedCommandDetails(page)).some(command => command.type === "session.recovery.inspect")).toBe(true);
  await expect(page.getByTestId("interrupted-task-notice")).toHaveCount(0);
});
