import { expect, test } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";
import { signIn } from "./pi67-team-chat-controls.js";
import type { MockTeamChatState } from "./pi67-team-chat-command-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("searches messages and Work Cards from the Chat rail and opens a result", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("group", { name: "工作模式" }).getByRole("button", { name: "聊天" }).click();
  await signIn(page);
  const field = page.getByRole("searchbox", { name: "搜索团队聊天消息" });
  await field.fill("口径");
  await field.press("Enter");
  const results = page.getByTestId("team-chat-search");
  await expect(results.getByRole("heading", { name: "「口径」的搜索结果" })).toBeVisible();
  await expect(page.getByTestId("title-context-current")).toHaveText("搜索消息");
  const rows = results.getByTestId("team-chat-search-result");
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator("mark")).toHaveText("口径");
  await expect(rows.first()).toContainText("任务卡");

  await results.getByLabel("发送人").selectOption({ label: "王一凡" });
  await expect(results.getByText("在当前筛选下没有找到包含「口径」的消息。")).toBeVisible();
  await expect(results.getByRole("button", { name: "清除筛选" })).toBeVisible();
  await results.getByLabel("发送人").selectOption({ label: "李若溪" });
  await expect(rows).toHaveCount(2);

  await rows.filter({ hasText: "顺便把港股" }).click();
  const log = page.getByRole("log", { name: "#宏观研究" });
  await expect(log.locator("[data-focused]")).toContainText("顺便把港股那几家的口径对齐一下。");

  // In Chat, the "find in current conversation" shortcut scopes the search to it.
  await page.keyboard.press("ControlOrMeta+f");
  await expect(field).toBeFocused();
  await expect(page.getByText("在 #宏观研究 中")).toBeVisible();
  await field.fill("折现率");
  await field.press("Enter");
  await expect(rows).toHaveCount(1);
  await results.getByRole("button", { name: "关闭搜索" }).click();
  await expect(results).toHaveCount(0);
});

for (const longLastMessage of [false, true]) {
  test(`opens older search history and reaches the newest message end, long=${longLastMessage}`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-05T13:05:00Z"));
    await page.goto("/");
    await attachMockAgent(page);
    await page.evaluate((longLastMessage) => {
      const chat = (window as unknown as { __pi67MockTeamChat: MockTeamChatState }).__pi67MockTeamChat;
      const channel = chat.directory.conversations.find((conversation) => conversation.id === "conv-ops")!;
      const base = Date.now() - 80 * 3_600_000;
      chat.messages["conv-ops"] = Array.from({ length: 400 }, (_, index) => ({
        id: `ops-${index + 1}`, conversationId: "conv-ops", seq: index + 1, senderUserId: "user-wang",
        body: `复盘记录 ${index + 1}号` + (longLastMessage && index === 399 ? "\n最新消息的详细记录".repeat(60) : ""),
        clientKey: `ops-key-${String(index + 1).padStart(4, "0")}`, createdAt: base + index * 600_000
      }));
      Object.assign(channel, { joined: true, lastSeq: 400, lastReadSeq: 400, lastMessageAt: base + 399 * 600_000 });
    }, longLastMessage);
    await page.getByRole("button", { name: "选择工作区" }).click();
    await page.getByRole("group", { name: "工作模式" }).getByRole("button", { name: "聊天" }).click();
    await signIn(page);
    const field = page.getByRole("searchbox", { name: "搜索团队聊天消息" });
    await field.fill("记录 20号");
    await field.press("Enter");
    await page.getByTestId("team-chat-search-result").click();
    const log = page.getByRole("log", { name: "#交易复盘" });
    await expect(log.locator("[data-focused]")).toContainText("复盘记录 20号");
    const jump = page.getByRole("button", { name: "跳到最新消息" });
    await expect(jump).toBeVisible();
    // The overlay shares the timeline's cell; the workbench stays a single column.
    expect(await page.getByTestId("team-chat-workbench").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
    await jump.click();
    const latest = log.getByText("复盘记录 400号", { exact: !longLastMessage });
    await expect(latest).toBeInViewport();
    // The latest message can be taller than the viewport. Its end, rather than
    // just its first line or an overscanned DOM node, must be above the Composer.
    await expect.poll(() => latest.evaluate(element => {
      const viewport = element.closest('[role="log"]')!;
      return element.getBoundingClientRect().bottom - viewport.getBoundingClientRect().bottom;
    })).toBeLessThanOrEqual(1);
    await expect(jump).toHaveCount(0);
  });
}
