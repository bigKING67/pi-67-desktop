import { expect, test } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";
import { emitMockAgentEvent } from "./pi67-renderer-controls.js";
import { signIn } from "./pi67-team-chat-controls.js";
import type { MockTeamChatState } from "./pi67-team-chat-command-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("edits and recalls own messages, removes others' as channel owner and shows placeholders", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("group", { name: "工作模式" }).getByRole("button", { name: "聊天" }).click();
  await signIn(page);
  await page.getByTestId("team-chat-navigation").getByRole("button", { name: /^宏观研究/u }).click();
  const log = page.getByRole("log", { name: "#宏观研究" });
  const composer = page.getByRole("textbox", { name: "发送到 #宏观研究" });

  // Edit own message from its hover actions; the draft in progress comes back afterwards.
  const own = log.locator("article").filter({ hasText: "可以，我先在工作里跑一遍敏感性分析。" });
  await composer.fill("还没发的草稿");
  await own.hover();
  await own.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByTestId("team-chat-editing")).toBeVisible();
  await expect(composer).toHaveValue("可以，我先在工作里跑一遍敏感性分析。");
  await composer.fill("可以，今晚给敏感性分析。");
  await composer.press("Enter");
  await expect(log.getByText("可以，今晚给敏感性分析。")).toBeVisible();
  await expect(log.locator("article").filter({ hasText: "可以，今晚给敏感性分析。" }).getByText("（已编辑）")).toBeVisible();
  await expect(composer).toHaveValue("还没发的草稿");

  // ↑ in an empty composer edits the newest own message; Esc cancels.
  await composer.fill("");
  await composer.press("ArrowUp");
  await expect(composer).toHaveValue("可以，今晚给敏感性分析。");
  await composer.press("Escape");
  await expect(page.getByTestId("team-chat-editing")).toHaveCount(0);

  // Recall needs a second, confirming press.
  const edited = log.locator("article").filter({ hasText: "可以，今晚给敏感性分析。" });
  await edited.hover();
  await edited.getByRole("button", { name: "撤回", exact: true }).click();
  await edited.getByRole("button", { name: "确认撤回" }).click();
  await expect(log.getByText("你撤回了一条消息")).toBeVisible();

  // The channel owner here is 王一凡; 高乾 is the team owner and may remove others' messages.
  const others = log.locator("article").filter({ hasText: "重点是第三节的折现率假设。" });
  await others.hover();
  await expect(others.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  await others.getByRole("button", { name: "移除", exact: true }).click();
  await others.getByRole("button", { name: "确认移除" }).click();
  await expect(log.getByText("这条消息已被管理员移除")).toBeVisible();

  // A teammate's own recall arrives by push.
  const pushed = await page.evaluate(() => {
    const state = (window as unknown as { __pi67MockTeamChat: MockTeamChatState }).__pi67MockTeamChat;
    const message = state.messages["conv-research"]!.find((item) => item.id === "msg-4")!;
    return { ...message, body: "", mentionUserIds: undefined, recalledAt: Date.now(), recalledBy: "user-li" };
  });
  await emitMockAgentEvent(page, { type: "teamChat.pushed", payload: { type: "message.updated",
    message: JSON.parse(JSON.stringify(pushed)) as Record<string, unknown> } }, { context: "app" });
  await expect(log.getByText("李若溪 撤回了一条消息")).toBeVisible();
});
