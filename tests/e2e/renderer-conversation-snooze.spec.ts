import { expect, test, type Page } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  installMockDesktopBridge,
  recordedCommandDetails
} from "./pi67-renderer-fixture.js";
import {
  emitSessionCatalogChanged,
  installSessionCatalogFixture,
  updateSessionCatalogFixture,
  type FixtureSessionSummary
} from "./pi67-session-catalog-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("snoozes an idle conversation into a recoverable shelf and wakes it without deleting history", async ({ page }) => {
  const idle = session(1, "稍后继续的对话");
  const snoozedUntil = Date.now() + 60 * 60 * 1_000;
  await openCatalogWorkspace(page, { items: [idle] });
  await clearRecordedCommands(page);

  await page.getByRole("button", { name: `${idle.name} 对话菜单` }).click();
  await page.getByRole("menuitem", { name: "稍后" }).click();
  await expect.poll(async () => (await recordedCommandDetails(page))
    .map((command) => command.type)
    .filter((type) => type === "task.close" || type === "conversation.snooze"))
    .toEqual(["task.close", "conversation.snooze"]);
  await expect.poll(async () => (await recordedCommandDetails(page)).find((command) => (
    command.type === "conversation.snooze"
  ))).toMatchObject({
    payload: {
      path: idle.path,
      snoozedUntil: expect.any(Number)
    }
  });
  await expect(page.getByText("无法稍后处理对话", { exact: true })).toHaveCount(0);

  await updateSessionCatalogFixture(page, {
    revision: 2,
    items: [{ ...idle, snoozedUntil }]
  });
  await emitSessionCatalogChanged(page, 2, "session-updated");
  const shelf = page.getByRole("button", { name: /稍后\s*1/u });
  await expect(shelf).toBeVisible();
  await shelf.click();
  await expect(sessionButton(page, idle.name)).toContainText("稍后");
  await page.screenshot({
    path: "artifacts/visual-review/conversation-snooze-shelf.png",
    animations: "disabled"
  });

  await clearRecordedCommands(page);
  await page.getByRole("button", { name: `${idle.name} 对话菜单` }).click();
  await page.getByRole("menuitem", { name: "立即唤醒" }).click();
  await expect.poll(async () => (await recordedCommandDetails(page)).find((command) => (
    command.type === "conversation.snooze"
  ))).toMatchObject({
    type: "conversation.snooze",
    payload: { path: idle.path }
  });
  expect((await recordedCommandDetails(page)).find((command) => (
    command.type === "conversation.snooze"
  ))?.payload).not.toHaveProperty("snoozedUntil");
  await expect(page.getByText("无法唤醒对话", { exact: true })).toHaveCount(0);

  await updateSessionCatalogFixture(page, { revision: 3, items: [idle] });
  await emitSessionCatalogChanged(page, 3, "session-updated");
  await expect(page.getByRole("button", { name: /稍后\s*1/u })).toHaveCount(0);
  await expect(sessionButton(page, idle.name)).toBeVisible();
});

async function openCatalogWorkspace(
  page: Page,
  options: Parameters<typeof installSessionCatalogFixture>[1]
): Promise<void> {
  await page.goto("/");
  await attachMockAgent(page);
  await installSessionCatalogFixture(page, options);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.getByRole("button", { name: "pi-demo 工作区菜单" })).toBeVisible();
}

function session(index: number, name: string): FixtureSessionSummary {
  return {
    id: `catalog-session-${index}`,
    fileIdentity: `session-file-fixture-${index}`,
    path: `/sessions/catalog-${String(index).padStart(3, "0")}.jsonl`,
    cwd: "/workspace/catalog",
    name,
    modifiedAt: 1_753_000_000_000 - index * 1_000,
    messageCount: index
  };
}

function sessionButton(page: Page, name: string) {
  return page.getByTestId("conversation-row").filter({ hasText: name });
}
