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
  waitForMockWorkspaceReady,
  type FixtureMessage
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("applies narrow conversation, queue, metadata, tree and usage projections", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page, [message("entry-0", "Before")]);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);
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
  await expect(page.getByRole("button", { name: "Pi 思考级别", exact: true }))
    .toContainText("思考：high");

  await emitMockAgentEvent(page, {
    type: "usage.changed",
    payload: { tokens: 1234, cost: 0.5, contextPercent: 25 }
  });
  await page.getByRole("tab", { name: "上下文" }).click();
  await expect(page.getByText("1,234", { exact: true })).toBeVisible();
  await expect(page.getByText("25.0%", { exact: true })).toBeVisible();
  const metricList = page.locator(".metric-list");
  await expect(metricList.locator("dt").first()).toHaveCSS("font-size", "12px");
  await expect(metricList.locator("dt").first()).toHaveCSS("font-weight", "500");
  await expect(metricList.locator("dd").first()).toHaveCSS("font-size", "12px");

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
  await waitForMockWorkspaceReady(page);
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
        sessionFileIdentity: "session-file-fixture-demo",
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
