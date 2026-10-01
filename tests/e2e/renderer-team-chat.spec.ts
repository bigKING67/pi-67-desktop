import { expect, test, type Page } from "@playwright/test";
import { attachMockAgent, installMockDesktopBridge } from "./pi67-renderer-fixture.js";
import { emitMockAgentEvent } from "./pi67-renderer-controls.js";
import type { MockTeamChatState } from "./pi67-team-chat-command-fixture.js";
import { installSessionCatalogFixture } from "./pi67-session-catalog-fixture.js";

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

test("claims an assigned Work Card and opens a reviewed team-scoped Work draft", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [], {}, { responseResults: {
    "enterprise.project.list": { items: [{ id: "project-hk", accountId: "team-1", name: "港股研究", slug: "project-hk", status: "active",
      bindingCount: 0, candidateCount: 0, sharedAssetCount: 0, updatedAt: 1 }], total: 1 }
  } });
  await page.getByRole("button", { name: "选择工作区" }).click();
  const modes = page.getByRole("group", { name: "工作模式" });
  await modes.getByRole("button", { name: "聊天" }).click();
  await signIn(page);

  await page.getByTestId("team-chat-navigation").getByRole("button", { name: "李若溪" }).click();
  const card = page.getByTestId("team-chat-work-card");
  await expect(card.getByRole("heading", { name: "港股口径对齐" })).toBeVisible();
  await expect(card).toContainText("待接手");
  await expect(card).toContainText("指派给 我");
  await card.getByRole("button", { name: "接手" }).click();
  await expect(card).toContainText("进行中");

  const dialog = page.getByRole("dialog", { name: "在工作中开始" });
  await expect(dialog).toContainText("不会写入私人记忆");
  await expect(dialog.getByLabel("团队项目")).toHaveValue("project-hk");
  await expect(dialog.getByLabel("起始内容")).toHaveValue(/^任务：港股口径对齐\n\n目标：\n统一三家港股公司的营收口径/u);
  await dialog.getByRole("button", { name: "创建草稿" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(modes.getByRole("button", { name: "工作" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox", { name: "给 Pi 发送消息" })).toHaveValue(/任务：港股口径对齐/u);
});

test("hands a Work conversation to a teammate as a Work Card without its transcript", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await installSessionCatalogFixture(page, { items: [{
    id: "catalog-session-1", fileIdentity: "session-file-fixture-1", path: "/sessions/catalog-001.jsonl",
    cwd: "/workspace/catalog", name: "登录回跳修复", modifiedAt: 1_753_000_000_000, messageCount: 4
  }] });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("group", { name: "工作模式" }).getByRole("button", { name: "聊天" }).click();
  await signIn(page);
  await page.getByRole("group", { name: "工作模式" }).getByRole("button", { name: "工作" }).click();

  await page.getByRole("button", { name: "登录回跳修复 对话菜单" }).click();
  await page.getByRole("menuitem", { name: "交给同事…" }).click();
  const dialog = page.getByRole("dialog", { name: "交给同事或频道" });
  await expect(dialog).toContainText("不会上传对话记录、提示词、代码或私人记忆");
  await expect(dialog.getByLabel("标题")).toHaveValue("登录回跳修复");
  await dialog.getByLabel("发送到").selectOption({ label: "王一凡" });
  await dialog.getByLabel("目标").fill("三种入口登录后都回到原页面");
  await dialog.getByLabel("PR 或链接（可选，仅 https）").fill("http://insecure.example");
  await expect(dialog.getByRole("button", { name: "发送任务卡" })).toBeDisabled();
  await dialog.getByLabel("PR 或链接（可选，仅 https）").fill("https://github.com/example/app/pull/42");
  await dialog.getByRole("button", { name: "发送任务卡" }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("group", { name: "工作模式" }).getByRole("button", { name: "聊天" }).click();
  await page.getByTestId("team-chat-navigation").getByRole("button", { name: "王一凡" }).click();
  const card = page.getByTestId("team-chat-work-card");
  await expect(card.getByRole("heading", { name: "登录回跳修复" })).toBeVisible();
  await expect(card).toContainText("指派给 王一凡");
  await expect(card).toContainText("三种入口登录后都回到原页面");
  await expect(card.getByRole("link", { name: "https://github.com/example/app/pull/42" })).toBeVisible();
  await expect(card.getByRole("button", { name: "接手" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "关闭" })).toBeVisible();
});

test("virtualizes long history, opens at the newest message and pages older history at the top", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.evaluate(() => {
    const chat = (window as unknown as { __pi67MockTeamChat: MockTeamChatState }).__pi67MockTeamChat;
    const channel = chat.directory.conversations.find((conversation) => conversation.id === "conv-ops")!;
    const base = Date.now() - 30 * 3_600_000;
    chat.messages["conv-ops"] = Array.from({ length: 160 }, (_, index) => ({
      id: `ops-${index + 1}`, conversationId: "conv-ops", seq: index + 1,
      senderUserId: index % 2 === 0 ? "user-wang" : "user-li", body: `复盘记录 ${index + 1}`,
      clientKey: `ops-key-${String(index + 1).padStart(4, "0")}`, createdAt: base + index * 600_000
    }));
    Object.assign(channel, { joined: true, lastSeq: 160, lastReadSeq: 160, lastMessageAt: base + 159 * 600_000 });
  });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("group", { name: "工作模式" }).getByRole("button", { name: "聊天" }).click();
  await signIn(page);
  await page.getByTestId("team-chat-navigation").getByRole("button", { name: "交易复盘" }).click();

  const log = page.getByRole("log", { name: "#交易复盘" });
  await expect(log.getByText("复盘记录 160", { exact: true })).toBeInViewport();
  expect(await log.locator("article").count()).toBeLessThan(50);
  await expect(log.getByText("复盘记录 110", { exact: true })).toHaveCount(0);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await log.evaluate((element) => { element.scrollTop = 0; });
    if (await log.getByText("复盘记录 110", { exact: true }).count()) break;
    await page.waitForTimeout(100);
  }
  await expect(log.getByText("复盘记录 110", { exact: true })).toHaveCount(1);
  expect(await log.locator("article").count()).toBeLessThan(80);
});
