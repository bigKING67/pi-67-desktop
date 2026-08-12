import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  installMockDesktopBridge,
  recordedCommandDetails,
  recordedCommands,
  replaceMockAgentHost,
  setMockAgentResponseDelay,
  setMockAgentResponseResult
} from "./pi67-renderer-fixture.js";
import type { FixtureMessage } from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("finds current Pi JSONL text, locates an older window, and restores focus", async ({ page }) => {
  const messages = Array.from({ length: 130 }, (_, index) => message(
    `entry-${index}`,
    index === 4 ? "Historical release marker" : `Message ${index}`,
    index % 2 === 0 ? "user" : "assistant"
  ));
  await page.goto("/");
  await attachMockAgent(page, messages);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  const composer = page.getByLabel("给 Pi 发送消息");
  await composer.focus();
  await page.keyboard.press("Control+f");
  const find = page.getByTestId("conversation-find-bar");
  const input = page.getByLabel("在当前对话中查找");
  await expect(find).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill("release marker");

  await expect.poll(async () => (await recordedCommands(page)).filter((type) => (
    type === "message.search" || type === "message.locate"
  ))).toEqual(["message.search", "message.locate"]);
  await expect(find).toContainText("1 / 1");
  await expect(page.locator('[data-message-id="entry-4"]')).toContainText("Historical release marker");
  await expect(input).toBeFocused();
  const [search, locate] = (await recordedCommandDetails(page)).filter((command) => (
    command.type === "message.search" || command.type === "message.locate"
  ));
  expect(search).toMatchObject({ type: "message.search", payload: { query: "release marker" } });
  expect(locate).toMatchObject({ type: "message.locate", payload: { id: "entry-4" } });

  await input.press("Escape");
  await expect(find).toHaveCount(0);
  await expect(composer).toBeFocused();
});

test("does not treat Windows IME confirmation as find navigation or dismissal", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [message("entry-1", "中文结果", "assistant")]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByLabel("给 Pi 发送消息").focus();
  await page.keyboard.press("Control+f");

  const input = page.getByLabel("在当前对话中查找");
  await input.fill("中文");
  await expect(page.getByTestId("conversation-find-bar")).toContainText("1 / 1");
  await input.evaluate((element) => {
    element.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
      isComposing: true
    }));
  });
  await expect(page.getByTestId("conversation-find-bar")).toBeVisible();
  await expect(input).toHaveValue("中文");
});

test("closes Runtime-bound find on Host replacement and ignores its late response", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [message("entry-1", "late result", "assistant")]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  const composer = page.getByLabel("给 Pi 发送消息");
  await composer.focus();
  await setMockAgentResponseDelay(page, "message.search", 800);
  await clearRecordedCommands(page);
  await page.keyboard.press("Control+f");
  await page.getByLabel("在当前对话中查找").fill("late result");
  await expect.poll(async () => (await recordedCommands(page)).includes("message.search")).toBe(true);

  await replaceMockAgentHost(page);
  await expect(page.getByTestId("conversation-find-bar")).toHaveCount(0);
  await page.waitForTimeout(900);
  await expect(page.getByTestId("conversation-find-bar")).toHaveCount(0);
});

test("searches Workspace conversation text and opens the exact Session result", async ({ page }) => {
  const sessionPath = "/Users/test/.pi/agent/sessions/release.jsonl";
  const sessionFileIdentity = "session-file-release";
  await page.goto("/");
  await attachMockAgent(page, [], {}, {
    sessionCatalogItems: [{
      id: "catalog-current",
      fileIdentity: "session-file-current",
      path: "/Users/test/.pi/agent/sessions/current.jsonl",
      cwd: "/Users/test/Projects/pi-demo",
      name: "Current conversation",
      modifiedAt: 20,
      messageCount: 2
    }, {
      id: "catalog-release",
      fileIdentity: sessionFileIdentity,
      path: sessionPath,
      cwd: "/Users/test/Projects/pi-demo",
      name: "Release verification",
      modifiedAt: 10,
      messageCount: 4
    }],
    sessionMessagesByPath: {
      [sessionPath]: [message("release-message-1", "installer marker verified", "assistant")]
    }
  });
  await page.getByRole("button", { name: "选择工作区" }).click();
  const workspaceId = await page.evaluate(() => (
    window as unknown as { __pi67TestAgent: { workspaceId: string } }
  ).__pi67TestAgent.workspaceId);
  await setMockAgentResponseResult(page, "session.catalog.contentSearch", {
    workspaceId,
    query: "installer marker",
    items: [{
      sessionFileIdentity,
      sessionPath,
      sessionName: "Release verification",
      messageId: "release-message-1",
      role: "assistant",
      snippet: "installer marker verified"
    }],
    sessionsVisited: 2,
    entriesVisited: 4,
    skippedCount: 0,
    incomplete: false,
    truncated: false
  });
  await clearRecordedCommands(page);

  await page.getByLabel("给 Pi 发送消息").focus();
  await page.keyboard.press("Control+Shift+f");
  const dialog = page.getByRole("dialog", { name: "搜索工作区对话正文" });
  await expect(dialog).toBeVisible();
  await page.getByLabel("搜索当前工作区的对话正文").fill("installer marker");
  await dialog.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(dialog.getByText("installer marker verified", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("已扫描 2 个对话、4 条事件");

  await dialog.getByRole("button", { name: /Release verification/u }).click();
  await expect.poll(async () => (await recordedCommands(page)).includes("session.open")).toBe(true);
  expect(await page.evaluate(() => {
    const state = (window as unknown as {
      __pi67TestAgent: { conversationMessages: FixtureMessage[]; snapshot: Record<string, unknown> };
    }).__pi67TestAgent;
    return { messages: state.conversationMessages, snapshot: state.snapshot };
  })).toMatchObject({
    messages: [{ id: "release-message-1" }],
    snapshot: { sessionFileIdentity }
  });
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await recordedCommands(page)).filter((type) => (
    type === "session.open" || type === "message.locate"
  ))).toEqual(["session.open", "message.locate"]);
  await expect(page.locator('[data-message-id="release-message-1"]')).toBeFocused();
  const commands = await recordedCommandDetails(page);
  expect(commands.find((command) => command.type === "session.open")?.payload).toEqual({
    path: sessionPath,
    cwdOverride: "/Users/test/Projects/pi-demo"
  });
  expect(commands.find((command) => command.type === "message.locate")?.payload).toEqual({
    id: "release-message-1"
  });
});

function message(id: string, text: string, role: "user" | "assistant"): FixtureMessage {
  return { id, role, createdAt: Number(id.replace(/\D/gu, "")) || 1, parts: [{ type: "text", text }] };
}
