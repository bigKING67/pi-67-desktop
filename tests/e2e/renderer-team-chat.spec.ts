import { expect, test, type Page } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";
import { emitMockAgentEvent } from "./pi67-renderer-controls.js";
import type { MockTeamChatState } from "./pi67-team-chat-command-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

async function signIn(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __pi67MockTeamChat: MockTeamChatState }).__pi67MockTeamChat.connection = { status: "live", generation: 1 };
  });
  await emitMockAgentEvent(page, { type: "teamChat.connectionChanged", payload: { status: "live", generation: 1 } }, { context: "app" });
}

function pushed(seq: number, body: string, senderUserId = "user-li") {
  return {
    type: "teamChat.pushed",
    payload: {
      type: "message.created",
      message: { id: `push-${seq}`, conversationId: "conv-research", seq, senderUserId, body, clientKey: `push-key-${seq}`, createdAt: Date.now() }
    }
  };
}

test("switches between Work and Chat and exchanges team messages", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const modes = page.getByRole("group", { name: "工作模式" });
  await expect(modes.getByRole("button", { name: "工作" })).toHaveAttribute("aria-pressed", "true");
  await modes.getByRole("button", { name: "聊天" }).click();
  await expect(modes.getByRole("button", { name: "聊天" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("team-chat-signed-out")).toBeVisible();
  await expect(page.getByTestId("inspector-toggle")).toHaveCount(0);

  await signIn(page);
  const navigation = page.getByTestId("team-chat-navigation");
  await navigation.getByRole("button", { name: "宏观研究，1 条未读" }).click();
  const log = page.getByRole("log", { name: "#宏观研究" });
  await expect(log.getByText("重点是第三节的折现率假设。")).toBeVisible();
  await expect(page.getByTestId("title-context-current")).toHaveText("# 宏观研究");
  await expect(navigation.getByRole("button", { name: "宏观研究", exact: true })).toBeVisible();

  const composer = page.getByRole("textbox", { name: "发送到 #宏观研究" });
  await composer.fill("收到，晚上前给结论。");
  await composer.press("Enter");
  await expect(log.getByText("收到，晚上前给结论。")).toBeVisible();
  await expect(composer).toHaveValue("");

  await emitMockAgentEvent(page, pushed(6, "口径表我也更新了。"), { context: "app" });
  await expect(log.getByText("口径表我也更新了。")).toBeVisible();

  await navigation.getByRole("button", { name: "交易复盘，可加入" }).click();
  await page.getByRole("button", { name: "加入频道" }).click();
  await expect(page.getByRole("textbox", { name: "发送到 #交易复盘" })).toBeVisible();

  await navigation.getByRole("button", { name: "王一凡" }).click();
  await expect(page.getByTestId("title-context-current")).toHaveText("王一凡");
  await expect(page.getByRole("textbox", { name: "发送到 王一凡" })).toBeVisible();

  await modes.getByRole("button", { name: "工作" }).click();
  await expect(page.getByTestId("team-chat-workbench")).toHaveCount(0);
  await emitMockAgentEvent(page, pushed(7, "明早九点同步一下？"), { context: "app" });
  await expect(modes.getByRole("button", { name: "聊天，1 条未读" })).toBeVisible();
});

test("creates a channel with teammates from the navigation header", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("group", { name: "工作模式" }).getByRole("button", { name: "聊天" }).click();
  await signIn(page);

  await page.getByTestId("team-chat-new-channel").click();
  const dialog = page.getByRole("dialog", { name: "新建频道" });
  await expect(dialog.getByRole("button", { name: "创建" })).toBeDisabled();
  await dialog.getByLabel("频道名称").fill("  港股估值  ");
  await dialog.getByRole("radio", { name: /私密频道/ }).check();
  await dialog.getByRole("checkbox", { name: "李若溪" }).check();
  await dialog.getByRole("button", { name: "创建" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("title-context-current")).toHaveText("# 港股估值");
  await expect(page.getByRole("log", { name: "#港股估值" }).getByText("还没有消息。发出第一条吧。")).toBeVisible();
});
