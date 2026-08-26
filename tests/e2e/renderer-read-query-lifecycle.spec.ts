import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  installMockDesktopBridge,
  recordedCommands,
  replaceMockAgentHost,
  setMockAgentResponseDelay,
  setMockAgentResponseResult,
  waitForMockWorkspaceReady
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("shares a read key across Navigation and Palette and retains success during Host refresh", async ({ page }) => {
  const sessionPath = "/Users/test/.pi/agent/sessions/query-lifecycle.jsonl";
  const sessionFileIdentity = "session-file-query-lifecycle";
  await page.goto("/");
  await attachMockAgent(page, [], {}, {
    sessionCatalogItems: [{
      id: "catalog-query-lifecycle",
      fileIdentity: sessionFileIdentity,
      path: sessionPath,
      cwd: "/Users/test/Projects/pi-demo",
      name: "Query lifecycle",
      modifiedAt: 10,
      messageCount: 1
    }]
  });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);
  const workspaceId = await page.evaluate(() => (
    window as unknown as { __pi67TestAgent: { workspaceId: string } }
  ).__pi67TestAgent.workspaceId);
  await setMockAgentResponseResult(page, "session.catalog.contentSearch", {
    workspaceId,
    query: "query marker",
    items: [{
      sessionFileIdentity,
      sessionPath,
      sessionName: "Query lifecycle",
      messageId: "query-message-1",
      role: "assistant",
      snippet: "query marker remains visible"
    }],
    sessionsVisited: 1,
    entriesVisited: 1,
    skippedCount: 0,
    incomplete: false,
    truncated: false
  });
  await clearRecordedCommands(page);

  await page.getByRole("searchbox", { name: "搜索对话" }).fill("query marker");
  const navigationResult = page.getByRole("button", {
    name: /Query lifecycle.*query marker remains visible/u
  });
  await expect(navigationResult).toBeVisible();
  await expect.poll(() => commandCount(page, "session.catalog.contentSearch")).toBe(1);

  await page.getByLabel("给 Pi 发送消息").focus();
  await page.keyboard.press("Control+k");
  const paletteSearch = page.getByLabel("搜索对话标题、正文、扩展命令和应用操作");
  await paletteSearch.fill("query marker");
  await expect(page.getByRole("option", {
    name: /Query lifecycle.*query marker remains visible/u
  })).toBeVisible();
  await page.waitForTimeout(250);
  expect(await commandCount(page, "session.catalog.contentSearch")).toBe(1);

  await setMockAgentResponseDelay(page, "session.catalog.contentSearch", 800);
  await clearRecordedCommands(page);
  await replaceMockAgentHost(page);

  await expect(navigationResult).toBeVisible();
  await expect(page.getByRole("option", {
    name: /Query lifecycle.*query marker remains visible/u
  })).toBeVisible();
  const paletteStatus = page.getByRole("dialog", { name: "命令面板" }).getByRole("status");
  await expect(paletteStatus).toContainText("正在建立或查询对话内容索引");
  await expect.poll(() => commandCount(page, "session.catalog.contentSearch")).toBe(1);
  await expect.poll(() => commandCount(page, "workspace.register")).toBe(1);
  await expect(paletteStatus).not.toContainText(
    "正在建立或查询对话内容索引",
    { timeout: 2_000 }
  );
  await expect(navigationResult).toBeVisible();
});

async function commandCount(page: import("@playwright/test").Page, command: string): Promise<number> {
  return (await recordedCommands(page)).filter((candidate) => candidate === command).length;
}
