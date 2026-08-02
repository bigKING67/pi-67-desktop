import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  emitMockAgentEvent,
  installMockDesktopBridge,
  recordedCommandDetails,
  recordedCommands,
  replaceMockSessionProjection,
  setMockConversationMessages,
  setMockWorkspaceChanges,
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

test("throttles assistant stream announcements and clears them when the turn settles", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [message("settled-message", "Settled response")]);
  await page.getByRole("button", { name: "选择工作区" }).click();

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
  await expect(announcer).toHaveText("第一句。");
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
  await clearRecordedCommands(page);

  const messages = Array.from({ length: 1_000 }, (_, index) => message(`entry-${index}`, `Message ${index}`));
  await replaceMockSessionProjection(page, "session-imported", messages);

  const transcript = page.locator('[data-transcript-region="true"]');
  await expect(transcript).toHaveAttribute("data-message-count", "100");
  await expect(page.getByText("Message 999", { exact: true })).toBeVisible();
  await page.waitForTimeout(250);
  expect((await recordedCommands(page)).filter((command) => command === "message.page")).toEqual([]);
});

test("applies narrow conversation, queue, metadata, tree and usage projections", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [message("entry-0", "Before")]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);

  await setMockConversationMessages(page, [
    message("entry-0", "Before"),
    message("entry-1", "After narrow refresh")
  ]);
  await emitMockAgentEvent(page, {
    type: "turn.streamBatch",
    payload: { events: [{ assistantMessageEvent: { type: "text_delta", delta: "temporary live text" } }] }
  }, { operationId: "operation-settled" });
  await emitMockAgentEvent(page, {
    type: "conversation.changed",
    payload: { sessionId: "session-test", reason: "settled" }
  }, { operationId: "operation-settled" });
  await expect(page.locator('[data-transcript-region="true"]')).toHaveAttribute("data-message-count", "2");
  await expect(page.getByText("After narrow refresh")).toBeVisible();
  await expect(page.getByText("temporary live text")).toHaveCount(0);

  await emitMockAgentEvent(page, {
    type: "queue.changed",
    payload: { steeringQueue: ["correct now"], followUpQueue: ["run tests", "write summary"] }
  });
  await expect(page.getByText("1 条立即纠偏 · 2 条完成后执行")).toBeVisible();
  await page.getByRole("button", { name: /1 条立即纠偏 · 2 条完成后执行/u }).click();
  await expect(page.getByText("correct now", { exact: true })).toBeVisible();
  await expect(page.getByText("run tests", { exact: true })).toBeVisible();
  await expect(page.getByText("write summary", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "清空全部" }).click();
  await page.getByRole("button", { name: "确认清空" }).click();
  await expect(page.getByText("1 条立即纠偏 · 2 条完成后执行")).toHaveCount(0);
  await expect.poll(async () => (await recordedCommands(page)).filter((command) => command === "queue.clear")).toEqual(["queue.clear"]);

  await emitMockAgentEvent(page, {
    type: "session.metaChanged",
    payload: {
      streaming: false,
      sessionName: "增量投影会话",
      thinkingLevel: "high",
      selectedModel: { provider: "openai", id: "gpt-test" }
    }
  });
  await expect(page.locator(".brand-lockup").getByText("增量投影会话", { exact: true })).toBeVisible();
  await expect(page.getByTestId("conversation-row").filter({ hasText: "增量投影会话" })).toBeVisible();
  await expect(page.getByLabel("Pi 思考级别")).toHaveValue("high");

  await emitMockAgentEvent(page, {
    type: "usage.changed",
    payload: { tokens: 1234, cost: 0.5, contextPercent: 25 }
  });
  await page.getByRole("tab", { name: "上下文" }).click();
  await expect(page.getByText("1,234", { exact: true })).toBeVisible();
  await expect(page.getByText("25.0%", { exact: true })).toBeVisible();

  await emitMockAgentEvent(page, { type: "tree.changed", payload: { reason: "session-entry" } });
  await expect.poll(async () => (await recordedCommands(page)).filter((command) => command === "session.tree")).toEqual(["session.tree"]);
  await expect(page.getByText(/等待同步/u)).toHaveCount(0);
  expect(await recordedCommands(page)).not.toContain("projection.resync");
});

test("discards a delayed conversation page after the session generation changes", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [message("old-0", "Old session")], { "message.page": 200 });
  await page.getByRole("button", { name: "选择工作区" }).click();

  await setMockConversationMessages(page, [
    message("old-0", "Old session"),
    message("old-1", "Stale delayed result")
  ]);
  await emitMockAgentEvent(page, {
    type: "conversation.changed",
    payload: { sessionId: "session-test", reason: "settled" }
  });
  await replaceMockSessionProjection(page, "session-new", [message("new-0", "New session only")]);

  await expect(page.getByText("New session only")).toBeVisible();
  await page.waitForTimeout(250);
  await expect(page.getByText("Stale delayed result")).toHaveCount(0);
  await expect(page.locator('[data-transcript-region="true"]')).toHaveAttribute("data-message-count", "1");
});

test("projects live change facts into Tool cards and restores them on resync", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [
    {
      id: "edit-tool-message",
      role: "assistant",
      parts: [{
        type: "tool-call",
        id: "edit-live",
        name: "edit",
        status: "completed",
        summary: "Updated src/live.ts"
      }]
    },
    {
      id: "write-tool-message",
      role: "assistant",
      parts: [{
        type: "tool-call",
        id: "write-live",
        name: "write",
        status: "completed",
        summary: "Wrote src/generated.ts"
      }]
    }
  ]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect.poll(async () => (await recordedCommands(page)).includes("workspace.changes")).toBe(true);

  await emitMockAgentEvent(page, {
    type: "workspace.changeChanged",
    payload: {
      sessionId: "session-test",
      change: {
        kind: "edit",
        toolCallId: "edit-live",
        path: "src/live.ts",
        pathTruncated: false,
        status: "completed",
        patch: "@@ -1 +1 @@\n-old\n+new",
        patchTruncated: false,
        additions: 1,
        deletions: 1,
        firstChangedLine: 1
      }
    }
  });
  const editCard = page.locator('details[data-presenter="edit-write"]').filter({ hasText: "src/live.ts" });
  await expect(editCard).toBeVisible();
  await editCard.locator("summary").click();
  await expect(editCard).toContainText("+1 -1");
  await expect(editCard).toContainText("Pi Session 记录包含 Patch；它不等于当前 Git Diff。");

  await emitMockAgentEvent(page, {
    type: "workspace.changeChanged",
    payload: {
      sessionId: "session-test",
      change: {
        kind: "write",
        toolCallId: "write-live",
        path: "src/generated.ts",
        pathTruncated: false,
        status: "completed",
        writtenBytes: 67,
        writtenLines: 3,
        metricsTruncated: false
      }
    }
  });
  const writeCard = page.locator('details[data-presenter="edit-write"]').filter({ hasText: "src/generated.ts" });
  await expect(writeCard).toBeVisible();
  await writeCard.locator("summary").click();
  await expect(writeCard).toContainText("67 bytes");
  await expect(writeCard).toContainText("write Tool Result 不包含写入前版本");

  await replaceMockSessionProjection(page, "session-new", [{
    id: "resynced-tool-message",
    role: "assistant",
    parts: [{
      type: "tool-call",
      id: "edit-resynced",
      name: "edit",
      status: "completed",
      summary: "Updated src/resynced.ts"
    }]
  }]);
  await expect(editCard).toHaveCount(0);
  await expect(writeCard).toHaveCount(0);

  await setMockWorkspaceChanges(page, {
    sessionId: "session-new",
    items: [{
      kind: "edit",
      toolCallId: "edit-resynced",
      path: "src/resynced.ts",
      pathTruncated: false,
      status: "completed",
      patch: "@@ -2 +2 @@\n-before\n+after",
      patchTruncated: false,
      additions: 1,
      deletions: 1,
      firstChangedLine: 2
    }],
    truncated: false,
    total: 1
  });
  await clearRecordedCommands(page);
  await emitMockAgentEvent(page, {
    type: "resource.changed",
    payload: { reason: "force-sequence-gap" }
  }, { sequence: 100, sessionId: "session-new", sessionGeneration: 2 });
  await expect.poll(async () => (await recordedCommands(page)).includes("projection.resync")).toBe(true);
  const resyncedCard = page.locator('details[data-presenter="edit-write"]').filter({ hasText: "src/resynced.ts" });
  await expect(resyncedCard).toBeVisible();
  await resyncedCard.locator("summary").click();
  await expect(resyncedCard).toContainText("+1 -1");
});

test("returns extension input only with its authoritative session and operation context", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);
  const operationId = "operation-extension-context";

  await emitMockAgentEvent(page, {
    type: "operation.started",
    payload: {
      operation: {
        operationId,
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-test",
        sessionGeneration: 1,
        startedAt: Date.now()
      }
    }
  }, { operationId });
  await emitMockAgentEvent(page, {
    type: "extension.ui.requested",
    payload: {
      requestId: "extension-context-request",
      sessionId: "session-test",
      sessionGeneration: 1,
      operationId,
      hostEpoch: 1,
      kind: "confirm",
      title: "上下文确认",
      blocking: true
    }
  }, { operationId });
  await page.getByRole("button", { name: "确认" }).click();

  await expect.poll(async () => (
    await recordedCommandDetails(page)
  ).find((command) => command.type === "extension.ui.respond")?.payload).toEqual({
    requestId: "extension-context-request",
    sessionId: "session-test",
    sessionGeneration: 1,
    operationId,
    value: true
  });
});

function message(id: string, text: string): FixtureMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

function isHighlightResource(name: string): boolean {
  return /(?:code-highlighter|shiki_wasm|shiki_langs_typescript|\/wasm-[^/]+\.js$|\/typescript-[^/]+\.js$)/u.test(name);
}
