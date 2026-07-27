import { expect, test, type Page } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  emitMockAgentEvent,
  installMockDesktopBridge,
  recordedCommandDetails,
  recordedCommands,
  setMockAgentResponseResult
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("renders one-tool approvals and refuses stale authority context", async ({ page }) => {
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);
  const operationId = "operation-approval-context";
  await startApprovalOperation(page, operationId);

  await emitMockAgentEvent(page, approvalRequest(operationId, "approval-reject", "git push origin main"), { operationId });
  await expect(page.getByRole("heading", { name: "需要单次授权" })).toBeVisible();
  await expect(page.getByText("git push origin main", { exact: true })).toBeVisible();
  await expect(page.getByText("/Users/test/Projects/pi-demo", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "拒绝" }).click();
  await expect.poll(async () => (
    await recordedCommandDetails(page)
  ).find((command) => command.type === "approval.respond")?.payload).toEqual({
    requestId: "approval-reject",
    toolCallId: "tool-approval-reject",
    sessionId: "session-test",
    sessionGeneration: 1,
    operationId,
    allowed: false
  });

  await emitMockAgentEvent(page, approvalRequest(operationId, "approval-allow", "git fetch origin"), { operationId });
  await page.getByRole("button", { name: "仅允许本次" }).click();
  await expect.poll(async () => (
    await recordedCommandDetails(page)
  ).find((command) => command.type === "approval.respond"
    && (command.payload as { requestId?: string }).requestId === "approval-allow")?.payload).toEqual({
    requestId: "approval-allow",
    toolCallId: "tool-approval-allow",
    sessionId: "session-test",
    sessionGeneration: 1,
    operationId,
    allowed: true
  });

  const stale = approvalRequest(operationId, "approval-stale", "git push stale");
  await emitMockAgentEvent(page, {
    ...stale,
    payload: { ...stale.payload, hostEpoch: 0 }
  }, { hostEpoch: 0, operationId });
  await expect(page.getByText("git push stale", { exact: true })).toHaveCount(0);

  await emitMockAgentEvent(page, approvalRequest(operationId, "approval-cancelled", "git push cancelled"), { operationId });
  await expect(page.getByText("git push cancelled", { exact: true })).toBeVisible();
  await emitMockAgentEvent(page, {
    type: "approval.cancelled",
    payload: {
      requests: [{ requestId: "approval-cancelled", toolCallId: "tool-approval-cancelled" }],
      reason: "connection-close"
    }
  }, { operationId });
  await expect(page.getByRole("heading", { name: "需要单次授权" })).toHaveCount(0);

  await setMockAgentResponseResult(page, "approval.respond", { resolved: false });
  await emitMockAgentEvent(page, approvalRequest(operationId, "approval-expired", "git push expired"), { operationId });
  await page.getByRole("button", { name: "仅允许本次" }).click();
  await expect(page.getByRole("heading", { name: "需要单次授权" })).toHaveCount(0);
  await expect(page.getByText("工具授权请求已过期", { exact: true })).toBeVisible();
  await expect(page.getByText("Agent Host 未接受这次授权响应，工具将保持阻止状态。", { exact: true })).toBeVisible();
});

test("renders suspicious approval bytes safely and keeps decisions reachable at constrained height", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await clearRecordedCommands(page);
  const operationId = "operation-approval-security-literal";
  await startApprovalOperation(page, operationId);

  const rawTarget = `printf 'safe\u202Etxt'\u200B\u001B[31m\nnext\u2028line\u009B32m\n${"long output ".repeat(60)}`;
  const rawCwd = `C:\\Users\\demo\u200D\\project`;
  const request = approvalRequest(operationId, "approval-security-literal", rawTarget);
  await emitMockAgentEvent(page, {
    ...request,
    payload: {
      ...request.payload,
      category: "ambiguous-command",
      reason: "命令包含需要人工核对的内容",
      cwd: rawCwd
    }
  }, { operationId });

  await expect(page.getByRole("alert")).toContainText("检测到危险或不可见字符");
  await expect(page.getByRole("alert")).toContainText("双向文本控制符、零宽字符、ANSI 控制序列、控制字符、非标准行分隔符");
  await expect(page.locator('[data-security-literal="target"]')).toContainText(
    String.raw`printf 'safe\u{202E}txt'\u{200B}\x1B[31m\x0A`
  );
  await expect(page.locator('[data-security-literal="target"]')).toContainText(String.raw`next\u{2028}line\x9B32m\x0A`);
  await expect(page.locator('[data-security-literal="cwd"]')).toHaveText(
    String.raw`C:\\Users\\demo\u{200D}\\project`
  );
  const renderedTarget = await page.locator('[data-security-literal="target"]').textContent();
  expect(renderedTarget).not.toContain("\u202E");
  expect(renderedTarget).not.toContain("\u200B");
  expect(renderedTarget).not.toContain("\u001B");
  expect(renderedTarget).not.toContain("\u009B");
  expect(renderedTarget).not.toContain("\u2028");

  const reject = page.getByRole("button", { name: "拒绝" });
  const allow = page.getByRole("button", { name: "仅允许本次" });
  await expect(reject).toBeFocused();
  await expect(reject).toBeVisible();
  await expect(allow).toBeVisible();
  const [rejectBox, allowBox, scrollMetrics] = await Promise.all([
    reject.boundingBox(),
    allow.boundingBox(),
    page.locator('[data-approval-scroll-region="true"]').evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }))
  ]);
  expect(rejectBox).not.toBeNull();
  expect(allowBox).not.toBeNull();
  expect((rejectBox?.y ?? 0) + (rejectBox?.height ?? 0)).toBeLessThanOrEqual(360);
  expect((allowBox?.y ?? 0) + (allowBox?.height ?? 0)).toBeLessThanOrEqual(360);
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);

  const scrollRegion = page.locator('[data-approval-scroll-region="true"]');
  await scrollRegion.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => scrollRegion.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const [scrolledRejectBox, scrolledAllowBox] = await Promise.all([
    reject.boundingBox(),
    allow.boundingBox()
  ]);
  expect(scrolledRejectBox).not.toBeNull();
  expect(scrolledAllowBox).not.toBeNull();
  expect(scrolledRejectBox?.y).toBeCloseTo(rejectBox?.y ?? 0, 0);
  expect(scrolledAllowBox?.y).toBeCloseTo(allowBox?.y ?? 0, 0);
  expect((scrolledRejectBox?.y ?? 0) + (scrolledRejectBox?.height ?? 0)).toBeLessThanOrEqual(360);
  expect((scrolledAllowBox?.y ?? 0) + (scrolledAllowBox?.height ?? 0)).toBeLessThanOrEqual(360);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "需要单次授权" })).toBeVisible();
  expect(await recordedCommands(page)).not.toContain("approval.respond");
  await page.keyboard.press("Tab");
  await expect(allow).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(reject).toBeFocused();
  await page.keyboard.press("Enter");

  await expect.poll(async () => (
    await recordedCommandDetails(page)
  ).find((command) => command.type === "approval.respond")?.payload).toEqual({
    requestId: "approval-security-literal",
    toolCallId: "tool-approval-security-literal",
    sessionId: "session-test",
    sessionGeneration: 1,
    operationId,
    allowed: false
  });
});

async function startApprovalOperation(page: Page, operationId: string): Promise<void> {
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
}

function approvalRequest(operationId: string, requestId: string, target: string) {
  return {
    type: "approval.requested",
    payload: {
      requestId,
      sessionId: "session-test",
      sessionGeneration: 1,
      operationId,
      hostEpoch: 1,
      toolCallId: `tool-${requestId}`,
      toolName: "bash",
      category: "git-external-action",
      reason: "访问或修改远程 Git 状态",
      targetKind: "command",
      target,
      targetTruncated: false,
      cwd: "/Users/test/Projects/pi-demo",
      cwdTruncated: false,
      scope: "single-tool-call"
    }
  } as const;
}
