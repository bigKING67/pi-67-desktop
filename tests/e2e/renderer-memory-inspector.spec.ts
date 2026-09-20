import { expect, test } from "@playwright/test";
import { DEFAULT_CONTEXT_MEMORY_CONFIGURATION, summarizeRecallMetrics } from "../../packages/domain/src/index.js";
import { attachMockAgent, installMockDesktopBridge, replaceMockSessionProjection,
  emitMockAgentEvent, setMockAgentResponseResult, setMockAgentResponseFailure } from "./pi67-renderer-fixture.js";

test("memory inspector shows owner metadata and clears stale counts on Session replacement", async ({ page }) => {
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page, [], {}, { responseResults: {
    "context.config.get": { ...DEFAULT_CONTEXT_MEMORY_CONFIGURATION, revision: "fixture-1" },
    "enterprise.identity.get": { state: "signed-out" },
    "context.recall.list": { items: [], total: 0 },
    "context.recall.metrics": summarizeRecallMetrics([]),
    "context.status.get": { provider: "openviking", health: "healthy", owner: "pi67-openviking",
      effectivePrivacyMode: "private-learning", endpoint: "managed:private", configured: true,
      conflictExtensions: [], lastCheckedAt: 1 },
    "context.session.get": { sessionId: "session-test", owner: "pi67-openviking", privacyMode: "private-learning",
      capturedTurns: 7, pendingTokens: 125, liveTailTurns: 3, takeoverActive: true }
  } });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.getByRole("tab", { name: "上下文", exact: true }).click();
  await page.getByRole("tab", { name: "记忆", exact: true }).click();
  const panel = page.getByTestId("memory-inspector");
  const metric = (name: string) => panel.locator("dl > div").filter({ has: page.getByText(name, { exact: true }) }).locator("dd");
  await expect(metric("已捕获消息数")).toHaveText("7");
  await expect(metric("Pending Tokens")).toHaveText("125");
  await expect(metric("Takeover")).toHaveText("Active");
  await expect(panel.getByText(/当前会话的捕获情况以已读取的统计为准/u)).toBeVisible();
  await setMockAgentResponseResult(page, "context.session.get", {
    sessionId: "session-test", owner: "pi67-openviking", privacyMode: "private-learning",
    capturedTurns: 9, pendingTokens: 200, liveTailTurns: 3, takeoverActive: true
  });
  await setMockAgentResponseResult(page, "context.recall.metrics", summarizeRecallMetrics([
    { durationMs: 6967, route: "prompt-context", selectedCount: 1 }
  ]));
  await emitMockAgentEvent(page, { type: "conversation.changed", payload: { sessionId: "session-test", reason: "settled" } });
  await expect(metric("已捕获消息数")).toHaveText("9");
  await expect(metric("Pending Tokens")).toHaveText("200");
  await expect(panel.getByText("1 个样本", { exact: true })).toBeVisible();
  await expect(metric("p50")).toHaveText("6,967 ms");
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await panel.screenshot({ path: `artifacts/visual-review/memory-inspector-refresh-${theme}.png`, animations: "disabled" });
  }
  await setMockAgentResponseResult(page, "context.session.get", {
    sessionId: "session-test", owner: "pi67-openviking", privacyMode: "private-learning",
    capturedTurns: 9, pendingTokens: 0, liveTailTurns: 3, takeoverActive: true
  });
  await emitMockAgentEvent(page, { type: "context.commitCompleted", payload: {
    sessionId: "session-test", operationId: "fixture-archive", outcome: "retained"
  } }, { context: "workspace" });
  await expect(metric("Pending Tokens")).toHaveText("0");
  await setMockAgentResponseFailure(page, "context.session.get", {
    code: "RUNTIME_NOT_READY", message: "Private memory Session metadata is unavailable.", recoverable: true
  });
  await replaceMockSessionProjection(page, "replacement-session", []);
  await expect(metric("已捕获消息数")).toHaveText("未知");
  await expect(metric("Pending Tokens")).toHaveText("未知");
  await expect(metric("Takeover")).toHaveText("未知");
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await expect(panel.getByText("Private memory Session metadata is unavailable.", { exact: true })).toBeVisible();
    await page.screenshot({ path: `artifacts/visual-review/managed-memory-inspector-${theme}.png`, animations: "disabled" });
  }
});
