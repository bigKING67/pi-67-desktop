import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  installMockDesktopBridge,
  recordedCommandDetails,
  recordedCommands,
  replaceMockAgentHost,
  setMockAgentResponseDelay,
  setMockAgentResponseFailure,
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

  const transcript = page.locator('[data-transcript-region="true"]');
  const scroller = transcript.getByTestId("virtuoso-scroller");
  await composer.fill("Continue from the current end");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(transcript).toHaveAttribute("data-historical-window", "false");
  await expect(transcript.getByRole("button", { name: /^回到最新/u })).toHaveCount(0);
  await expect(transcript.locator('[data-message-id^="pending-user:"]'))
    .toContainText("Continue from the current end");
  await expect.poll(() => scroller.evaluate((element) => (
    element.scrollHeight - element.clientHeight - element.scrollTop
  ))).toBeLessThanOrEqual(4);
});

test("reveals Assistant narration that belongs to a process group", async ({ page }) => {
  const messages = Array.from({ length: 150 }, (_, index): FixtureMessage => {
    if (index === 70) {
      return {
        id: "process-narration-target",
        role: "assistant",
        createdAt: index + 1,
        parts: [{ type: "text", text: "Unique searchable process narration" }, {
          type: "tool-call",
          id: "process-search-tool",
          name: "web_search",
          status: "completed"
        }]
      };
    }
    return message(`entry-${index}`, `Message ${index}`, index % 2 === 0 ? "user" : "assistant");
  });
  await page.goto("/");
  await attachMockAgent(page, messages);
  await page.getByRole("button", { name: "选择工作区" }).click();

  await page.getByLabel("给 Pi 发送消息").focus();
  await page.keyboard.press("Control+f");
  const find = page.getByTestId("conversation-find-bar");
  const input = page.getByLabel("在当前对话中查找");
  await input.fill("Unique searchable process narration");

  await expect(find).toContainText("1 / 1");
  const transcript = page.locator('[data-transcript-region="true"]');
  await expect(transcript).toHaveAttribute("data-historical-window", "true");
  const group = transcript.locator('[data-testid="transcript-process-group"][data-highlighted="true"]');
  await expect(group).toBeVisible();
  await expect(group).toHaveAttribute("open", "");
  await expect(group.getByText("Unique searchable process narration", { exact: true })).toBeVisible();
  await expect(input).toBeFocused();
});

test("surfaces a current-conversation locate failure", async ({ page }) => {
  const messages = Array.from({ length: 130 }, (_, index) => message(
    `entry-${index}`,
    index === 4 ? "Locate failure marker" : `Message ${index}`,
    index % 2 === 0 ? "user" : "assistant"
  ));
  await page.goto("/");
  await attachMockAgent(page, messages);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await setMockAgentResponseFailure(page, "message.locate", {
    code: "RESOURCE_CHANGED_EXTERNALLY",
    message: "Target message changed before it could be located.",
    recoverable: true
  });

  await page.getByLabel("给 Pi 发送消息").focus();
  await page.keyboard.press("Control+f");
  const find = page.getByTestId("conversation-find-bar");
  await page.getByLabel("在当前对话中查找").fill("Locate failure marker");

  await expect(find).toContainText("Target message changed before it could be located.");
  await expect(find).not.toContainText("1 / 1");
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

  const navigationSearch = page.getByRole("searchbox", { name: "搜索对话" });
  await navigationSearch.fill("installer marker");
  await expect.poll(async () => (await recordedCommands(page)).filter((command) => (
    command === "session.catalog.contentSearch"
  ))).toEqual(["session.catalog.contentSearch"]);
  await expect(page.getByText("对话内容", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Release verification.*installer marker verified/u })).toBeVisible();
  await expect(page.locator('[data-content-search-visible-count="1"]')).toBeVisible();
  await page.getByRole("button", { name: "清除对话搜索" }).click();

  await page.getByLabel("给 Pi 发送消息").focus();
  await page.keyboard.press("Control+Shift+f");
  const dialog = page.getByRole("dialog", { name: "搜索工作区对话正文" });
  await expect(dialog).toBeVisible();
  await page.getByLabel("搜索当前工作区的对话正文").fill("installer marker");
  await dialog.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(dialog.getByText("installer marker verified", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("已索引 2 个对话、4 条消息");

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
