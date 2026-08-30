import { expect, test, type Page } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  emitMockAgentEvent,
  installMockDesktopBridge,
  recordedCommandDetails,
  recordedCommands,
  replaceMockSessionProjection,
  setMockConversationMessages,
  waitForMockWorkspaceReady,
  type FixtureMessage
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("keeps live turns in the Virtuoso footer and defers code highlighting until settled", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [message("settled-message", "Settled response")]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const transcript = page.locator('[data-transcript-region="true"]');
  await expect(transcript).toHaveAttribute("data-message-count", "1");
  await expect(transcript).toHaveAttribute("data-has-live-turn", "false");

  const operationId = "operation-streaming-projection";
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
        startedAt: Date.now()
      }
    }
  }, { operationId });
  await emitMockAgentEvent(page, {
    type: "turn.streamBatch",
    payload: {
      events: [{
        assistantMessageEvent: {
          type: "text_delta",
          delta: "```typescript\nconst streaming = true;\n```"
        }
      }]
    }
  }, { operationId });

  await expect(transcript).toHaveAttribute("data-message-count", "1");
  await expect(transcript).toHaveAttribute("data-has-live-turn", "true");
  await expect(transcript.locator('[data-render-mode="settled"]')).toHaveCount(1);
  const liveTurn = transcript.locator('[data-render-mode="streaming"]');
  await expect(liveTurn).toHaveCount(1);
  await expect(liveTurn).toHaveAttribute("aria-busy", "true");
  await expect(liveTurn.locator('[data-markdown-mode="streaming"]')).toBeVisible();
  await expect(liveTurn.locator('[data-highlight-state="streaming"]')).toBeVisible();
  await expect(liveTurn.locator('[data-highlight-state="loading"]')).toHaveCount(0);
  await expect(liveTurn.locator('[data-highlight-state="ready"]')).toHaveCount(0);

  const loadedResources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
  expect(loadedResources.some(isHighlightResource)).toBe(false);
});

test("follows a growing live turn until the user scrolls away and resumes after returning", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, Array.from({ length: 24 }, (_, index) => (
    message(`history-${index}`, `Historical response ${index}. ${"context ".repeat(18)}`)
  )));
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);

  const transcript = page.locator('[data-transcript-region="true"]');
  const scroller = transcript.getByTestId("virtuoso-scroller");
  const latestButton = transcript.getByRole("button", { name: /^回到最新/u });
  const bottomGap = () => scroller.evaluate((element) => (
    element.scrollHeight - element.clientHeight - element.scrollTop
  ));
  const operationId = "operation-streaming-follow-output";
  const emitStreamDelta = (delta: string) => emitMockAgentEvent(page, {
    type: "turn.streamBatch",
    payload: { events: [{ assistantMessageEvent: { type: "text_delta", delta } }] }
  }, { operationId });

  await expect.poll(bottomGap).toBeLessThanOrEqual(4);
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
        startedAt: Date.now()
      }
    }
  }, { operationId });
  await emitStreamDelta(Array.from({ length: 28 }, (_, index) => (
    `Streaming paragraph ${index}. ${"new output ".repeat(16)}`
  )).join("\n\n"));

  await expect(transcript.locator('[data-render-mode="streaming"]')).toBeVisible();
  await expect(latestButton).toHaveCount(0);
  await expect.poll(bottomGap).toBeLessThanOrEqual(4);

  await scroller.hover();
  await page.mouse.wheel(0, -500);
  await expect(latestButton).toBeVisible();
  const readingPosition = await scroller.evaluate((element) => element.scrollTop);
  await emitStreamDelta(Array.from({ length: 12 }, (_, index) => (
    `Deferred paragraph ${index}. ${"stay anchored ".repeat(14)}`
  )).join("\n\n"));

  await expect.poll(async () => Math.abs(
    await scroller.evaluate((element) => element.scrollTop) - readingPosition
  )).toBeLessThanOrEqual(2);
  await expect(latestButton).toBeVisible();

  await latestButton.click();
  await expect(latestButton).toHaveCount(0);
  await expect.poll(bottomGap).toBeLessThanOrEqual(4);
  await emitStreamDelta(`\n\nFinal streamed paragraph. ${"latest output ".repeat(20)}`);
  await expect(latestButton).toHaveCount(0);
  await expect.poll(bottomGap).toBeLessThanOrEqual(4);
});

test("keeps following a live turn when a width reflow moves the scroller", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto("/");
  await attachMockAgent(page, Array.from({ length: 24 }, (_, index) => (
    message(`reflow-history-${index}`, `Historical response ${index}. ${"context ".repeat(18)}`)
  )));
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);

  const transcript = page.locator('[data-transcript-region="true"]');
  const scroller = transcript.getByTestId("virtuoso-scroller");
  const latestButton = transcript.getByRole("button", { name: /^回到最新/u });
  const bottomGap = () => scroller.evaluate((element) => (
    element.scrollHeight - element.clientHeight - element.scrollTop
  ));
  const operationId = "operation-streaming-width-reflow";
  await startStreamingOperation(page, operationId);
  await emitStreamText(page, operationId, Array.from({ length: 32 }, (_, index) => (
    `Streaming paragraph ${index}. ${"reflow-sensitive output ".repeat(16)}`
  )).join("\n\n"));
  await expect.poll(bottomGap).toBeLessThanOrEqual(4);

  await page.setViewportSize({ width: 1_280, height: 480 });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1_280);
  await emitStreamText(page, operationId, `\n\nPost-resize paragraph. ${"newest output ".repeat(60)}`);

  await expect.poll(bottomGap).toBeLessThanOrEqual(4);
  await expect(latestButton).toHaveCount(0);
});

test("preserves the reading anchor after fine-grained upward wheel input", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, Array.from({ length: 24 }, (_, index) => (
    message(`fine-wheel-history-${index}`, `Historical response ${index}. ${"context ".repeat(18)}`)
  )));
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);

  const transcript = page.locator('[data-transcript-region="true"]');
  const scroller = transcript.getByTestId("virtuoso-scroller");
  const latestButton = transcript.getByRole("button", { name: /^回到最新/u });
  const operationId = "operation-streaming-fine-wheel";
  await startStreamingOperation(page, operationId);
  await emitStreamText(page, operationId, Array.from({ length: 32 }, (_, index) => (
    `Streaming paragraph ${index}. ${"fine-wheel output ".repeat(16)}`
  )).join("\n\n"));

  await scroller.hover();
  let previousPosition = await scroller.evaluate((element) => element.scrollTop);
  for (let step = 0; step < 8; step += 1) {
    await page.mouse.wheel(0, -1);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBeLessThan(previousPosition);
    previousPosition = await scroller.evaluate((element) => element.scrollTop);
  }
  const readingPosition = previousPosition;
  await expect(latestButton).toBeVisible();

  await emitStreamText(page, operationId, `\n\nPost-scroll paragraph. ${"newest output ".repeat(60)}`);
  await expect.poll(async () => Math.abs(
    await scroller.evaluate((element) => element.scrollTop) - readingPosition
  )).toBeLessThanOrEqual(2);
  await expect(latestButton).toBeVisible();

  await latestButton.click();
  await expect(latestButton).toHaveCount(0);
  const beforeKeyboardScroll = await scroller.evaluate((element) => element.scrollTop);
  await transcript.locator('[data-render-mode="streaming"]').focus();
  await page.keyboard.press("PageUp");
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop))
    .toBeLessThan(beforeKeyboardScroll);
  await expect(latestButton).toBeVisible();
  await expect.poll(async () => {
    const before = await scroller.evaluate((element) => element.scrollTop);
    await page.waitForTimeout(50);
    const after = await scroller.evaluate((element) => element.scrollTop);
    return Math.abs(after - before);
  }).toBeLessThanOrEqual(1);
  const keyboardReadingPosition = await scroller.evaluate((element) => element.scrollTop);
  await emitStreamText(page, operationId, `\n\nPost-keyboard paragraph. ${"keyboard output ".repeat(60)}`);
  await expect.poll(async () => Math.abs(
    await scroller.evaluate((element) => element.scrollTop) - keyboardReadingPosition
  )).toBeLessThanOrEqual(2);
  await expect(latestButton).toBeVisible();
});

test("keeps the committed transcript visible across a Settings round trip", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [message("settings-round-trip", "Settings round-trip transcript")]);
  await page.getByRole("button", { name: "选择工作区" }).click();

  await expect(page.getByText("Settings round-trip transcript", { exact: true })).toBeVisible();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
  await expect(page.getByLabel("π 设置")).toBeVisible();
  await page.getByRole("button", { name: "返回工作台" }).click();

  const transcript = page.locator('[data-transcript-region="true"]');
  await expect(transcript).toHaveAttribute("data-message-count", "1");
  await expect(page.getByText("Settings round-trip transcript", { exact: true })).toBeVisible();
});

test("projects assistant stream announcements without private reasoning and clears them when settled", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [message("settled-message", "Settled response")]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);

  const operationId = "operation-streaming-announcer";
  const announcer = page.locator('[data-streaming-announcer="true"]');
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
        startedAt: Date.now()
      }
    }
  }, { operationId });
  await emitMockAgentEvent(page, {
    type: "turn.streamBatch",
    payload: {
      events: [
        { assistantMessageEvent: { type: "thinking_delta", delta: "private reasoning" } },
        { assistantMessageEvent: { type: "text_delta", delta: "第一句。" } }
      ]
    }
  }, { operationId });

  await expect(announcer).toHaveText("第一句。");
  await expect(announcer).not.toContainText("private reasoning");
  const liveProcess = page.getByTestId("transcript-process-group");
  await expect(liveProcess).toHaveAttribute("open", "");
  await expect(liveProcess).toContainText("private reasoning");
  await expect(liveProcess).toContainText("分析");
  const liveMessage = page.getByRole("article", { name: "Pi 正在回复", exact: true });
  await expect(liveMessage).toBeVisible();
  await expect(liveMessage).not.toContainText("private reasoning");
  await expect(liveMessage.locator('[data-message-footer="assistant"]')).toHaveCount(0);
  await expect(liveMessage.getByRole("button", { name: "复制回答" })).toHaveCount(0);
  await emitMockAgentEvent(page, {
    type: "turn.streamBatch",
    payload: {
      events: [
        { assistantMessageEvent: { type: "thinking_delta", delta: "more private reasoning" } },
        { assistantMessageEvent: { type: "text_delta", delta: "第二句。" } }
      ]
    }
  }, { operationId });
  await expect(announcer).toHaveText("第二句。", { timeout: 3_000 });
  await expect(liveProcess).toContainText("more private reasoning");

  await setMockConversationMessages(page, [
    message("settled-message", "Settled response"),
    message("settled-stream", "第一句。第二句。")
  ]);
  await emitMockAgentEvent(page, {
    type: "conversation.changed",
    payload: { sessionId: "session-test", reason: "settled" }
  }, { operationId });
  await expect(announcer).toBeEmpty();
});

test("loads older messages by stable cursor without duplicating the recent projection", async ({ page }) => {
  const messages = Array.from({ length: 205 }, (_, index) => message(`entry-${index}`, `Message ${index}`));
  await page.goto("/");
  await attachMockAgent(page, messages);
  await page.getByRole("button", { name: "选择工作区" }).click();

  const transcript = page.locator('[data-transcript-region="true"]');
  await expect(transcript).toHaveAttribute("data-message-count", "100");
  await page.getByRole("button", { name: "加载更早消息" }).click();
  await expect(transcript).toHaveAttribute("data-message-count", "200");
  await page.getByRole("button", { name: "加载更早消息" }).click();
  await expect(transcript).toHaveAttribute("data-message-count", "205");
  await expect.poll(async () => (
    await recordedCommands(page)
  ).filter((command) => command === "message.page").length).toBe(2);

  const pages = (await recordedCommandDetails(page)).filter((command) => command.type === "message.page");
  expect(pages.map((command) => command.payload)).toEqual([
    { direction: "older", cursor: "entry-105", limit: 100 },
    { direction: "older", cursor: "entry-5", limit: 100 }
  ]);
  expect(await transcript.locator("[data-render-mode]").count()).toBeLessThan(205);
});

test("starts a bootstrapped session at the recent end without loading an older page", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [message("old-entry", "Previous session")]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);
  await clearRecordedCommands(page);

  const messages = Array.from({ length: 1_000 }, (_, index) => message(`entry-${index}`, `Message ${index}`));
  await replaceMockSessionProjection(page, "session-imported", messages);

  const transcript = page.locator('[data-transcript-region="true"]');
  await expect(transcript).toHaveAttribute("data-message-count", "100");
  await expect(page.getByText("Message 999", { exact: true })).toBeVisible();
  await page.waitForTimeout(250);
  expect((await recordedCommands(page)).filter((command) => command === "message.page")).toEqual([]);
});

function message(id: string, text: string): FixtureMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

async function startStreamingOperation(page: Page, operationId: string): Promise<void> {
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
        startedAt: Date.now()
      }
    }
  }, { operationId });
}

async function emitStreamText(page: Page, operationId: string, delta: string): Promise<void> {
  await emitMockAgentEvent(page, {
    type: "turn.streamBatch",
    payload: { events: [{ assistantMessageEvent: { type: "text_delta", delta } }] }
  }, { operationId });
}

function isHighlightResource(name: string): boolean {
  return /(?:code-highlighter|shiki_wasm|shiki_langs_typescript|\/wasm-[^/]+\.js$|\/typescript-[^/]+\.js$)/u.test(name);
}
