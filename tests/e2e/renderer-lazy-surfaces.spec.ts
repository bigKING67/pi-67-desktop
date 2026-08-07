import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  emitMockAgentEvent,
  installMockDesktopBridge,
  recordedCommands,
  waitForMockWorkspaceReady
} from "./pi67-renderer-fixture.js";

test.beforeEach(async ({ page }) => {
  await installMockDesktopBridge(page);
});

test("loads Settings only on first open and restores the workbench", async ({ page }) => {
  let settingsModuleRequests = 0;
  page.on("request", (request) => {
    if (/\/src\/settings\/SettingsWorkbench\.tsx(?:\?|$)/u.test(request.url())) {
      settingsModuleRequests += 1;
    }
  });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  expect(settingsModuleRequests).toBe(0);
  await page.keyboard.press("Control+,");
  await expect(page.getByLabel("π 设置")).toBeVisible();
  expect(settingsModuleRequests).toBe(1);

  await page.getByRole("button", { name: "返回工作台" }).click();
  await expect(page.getByLabel("Pi conversation")).toBeVisible();
  await page.keyboard.press("Control+,");
  await expect(page.getByLabel("π 设置")).toBeVisible();
  expect(settingsModuleRequests).toBe(1);
});

test("keeps Settings load failure recoverable without stopping the workspace", async ({ page }) => {
  await page.route(/\/src\/settings\/SettingsWorkbench\.tsx(?:\?|$)/u, (route) => route.abort("failed"));
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+,");

  const failure = page.getByRole("alert", { name: "设置界面未能加载" });
  await expect(failure).toBeVisible();
  await expect(failure).toContainText("后台任务仍会继续运行");
  await failure.getByRole("button", { name: "关闭" }).click();
  await expect(page.getByLabel("Pi conversation")).toBeVisible();
  await expect(page.locator('.application-shell[data-agent-connected="true"]')).toBeVisible();
});

test("keeps a failed lazy WorkspaceShell observable without tearing down the Agent connection", async ({ page }) => {
  await page.route(/\/src\/app\/WorkspaceShell\.tsx(?:\?|$)/u, (route) => route.abort("failed"));
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  await expect(page.getByRole("heading", { name: "工作区界面未能加载" })).toBeVisible();
  await expect(page.locator('[data-lazy-surface-error="workspace-shell"]')).toBeVisible();
  await expect(page.getByLabel("界面加载错误详情")).toContainText("RENDERER_SURFACE_LOAD_FAILED");
  await expect(page.getByRole("button", { name: "重新加载界面" })).toBeFocused();
  await expect(page.locator('.application-shell[data-agent-connected="true"]')).toBeVisible();
  await expect.poll(async () => (await recordedCommands(page)).includes("workspace.open")).toBe(true);
  await expect(page.getByLabel("给 Pi 发送消息")).toHaveCount(0);
});

test("keeps the workspace usable when the operation freshness monitor cannot load", async ({ page }) => {
  await page.route(/\/src\/operation\/operation-freshness-controller\.ts(?:\?|$)/u, (route) => route.abort("failed"));
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();

  await expect(page.getByText("任务状态监控未能加载", { exact: true })).toBeVisible();
  await expect(page.getByText("当前工作区仍可使用，但长任务心跳异常可能无法自动触发状态恢复。", { exact: true })).toBeVisible();
  await expect(page.getByLabel("给 Pi 发送消息")).toBeVisible();
  await expect(page.locator('.application-shell[data-agent-connected="true"]')).toBeVisible();
});

test("fails closed when the lazy approval surface cannot load", async ({ page }) => {
  await page.route(/\/src\/approval\/ApprovalDialog\.tsx(?:\?|$)/u, (route) => route.abort("failed"));
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await waitForMockWorkspaceReady(page);
  const operationId = "operation-lazy-approval";

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
    type: "approval.requested",
    payload: {
      requestId: "approval-lazy-failure",
      sessionId: "session-test",
      sessionGeneration: 1,
      operationId,
      hostEpoch: 1,
      toolCallId: "tool-lazy-failure",
      toolName: "bash",
      toolSource: "Pi 内置",
      category: "git-external-action",
      reason: "访问或修改远程 Git 状态",
      targetKind: "command",
      target: "git push origin main",
      targetTruncated: false,
      cwd: "/Users/test/Projects/pi-demo",
      cwdTruncated: false,
      scope: "single-tool-call"
    }
  }, { operationId });

  const failure = page.getByRole("alertdialog", { name: "授权界面未能加载" });
  await expect(failure).toBeVisible();
  await expect(failure).toContainText("工具仍保持阻止状态");
  await expect(failure.getByRole("button", { name: "重新加载界面" })).toBeFocused();
  expect(await recordedCommands(page)).not.toContain("approval.respond");
  await page.keyboard.press("Escape");
  await expect(failure).toBeVisible();
});

test("lets non-blocking lazy overlay failures close without blanking the workspace", async ({ page }) => {
  await page.route(/\/src\/command-palette\/CommandPalette\.tsx(?:\?|$)/u, (route) => route.abort("failed"));
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+k");

  const failure = page.getByRole("alertdialog", { name: "命令面板未能加载" });
  await expect(failure).toBeVisible();
  await expect(failure.getByRole("button", { name: "关闭" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(failure).toHaveCount(0);
  await expect(page.getByLabel("Pi conversation")).toBeVisible();
  await expect(page.getByLabel("给 Pi 发送消息")).toBeVisible();
});
