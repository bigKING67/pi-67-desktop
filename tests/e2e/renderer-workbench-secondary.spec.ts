import { expect, test } from "@playwright/test";
import {
  clearRecordedCommands,
  recordedCommandDetails
} from "./pi67-renderer-fixture.js";
import {
  DEFAULT_MOCK_WORKSPACE,
  type MockWorkspaceDescriptor
} from "./pi67-renderer-desktop-bridge.js";
import {
  markCurrentTaskRunning,
  openWorkbench,
  sessionSummary,
  workspaceGroup
} from "./renderer-workbench-test-fixture.js";

test("emits privacy-bounded native notification metadata for a hidden completed Session", async ({ page }) => {
  await openWorkbench(page, {}, { terminalDelayMs: 250 });
  await page.evaluate(() => {
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => false
    });
  });

  const composer = page.getByRole("textbox", { name: "给 Pi 发送消息" });
  await composer.fill("系统通知中不能出现这段 Prompt");
  await page.getByRole("button", { name: "发送", exact: true }).click();

  await expect.poll(() => page.evaluate(() => (
    (window as unknown as {
      __pi67NativeNotificationTest: { requests: Array<Record<string, unknown>> };
    }).__pi67NativeNotificationTest.requests[0]
  ))).toMatchObject({
    notificationId: expect.stringMatching(/^native:1:operation-\d+:completed$/u),
    kind: "completed",
    workspaceId: DEFAULT_MOCK_WORKSPACE.id,
    sessionFileIdentity: "session-file-fixture-demo"
  });
  const request = await page.evaluate(() => (
    (window as unknown as {
      __pi67NativeNotificationTest: { requests: Array<Record<string, unknown>> };
    }).__pi67NativeNotificationTest.requests[0]!
  ));
  expect(request).not.toHaveProperty("title");
  expect(request).not.toHaveProperty("body");
  expect(JSON.stringify(request)).not.toContain("系统通知中不能出现这段 Prompt");

  await page.evaluate(() => {
    const test = (window as unknown as {
      __pi67NativeNotificationTest: {
        requests: Array<Record<string, unknown>>;
        activate(activation: Record<string, unknown>): void;
      };
    }).__pi67NativeNotificationTest;
    test.activate(test.requests[0]!);
  });
  await expect.poll(() => page.evaluate(() => (
    (window as unknown as {
      __pi67NativeNotificationTest: { dismissed: string[] };
    }).__pi67NativeNotificationTest.dismissed.length
  ))).toBeGreaterThan(0);
});

test("stops a running task from its conversation row without deleting Pi JSONL history", async ({ page }) => {
  await openWorkbench(page);
  await markCurrentTaskRunning(page, 1, "session-test", "session-file-fixture-demo", 1);
  await clearRecordedCommands(page);

  await page.getByRole("button", { name: /未命名会话 对话菜单/u }).click();
  await page.getByRole("menuitem", { name: "停止任务" }).click();

  await expect.poll(async () => (
    await recordedCommandDetails(page)
  ).filter((command) => command.type === "task.close")).toHaveLength(1);
  expect((await recordedCommandDetails(page)).find((command) => command.type === "task.close"))
    .toMatchObject({ payload: { mode: "stop" } });
  expect((await recordedCommandDetails(page)).filter((command) => command.type === "conversation.archive"))
    .toHaveLength(0);
  await expect(page.getByRole("heading", { name: "Pi 会话", exact: true })).toBeVisible();
  await expect(page.getByText("会话未在运行，打开后可继续。", {
    exact: true
  })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开会话", exact: true })).toBeVisible();
});

test("opens Settings, update, and help from the lower-left help menu", async ({ page }) => {
  await openWorkbench(page);
  const helpButton = page.getByRole("button", { name: "帮助与设置" });

  await helpButton.click();
  await page.getByRole("menuitem", { name: "检查更新" }).click();
  await expect(page.getByRole("dialog", { name: "Pi-67 更新" })).toBeVisible();
  await page.getByRole("dialog", { name: "Pi-67 更新" })
    .getByRole("button", { name: "关闭" }).click();

  await helpButton.click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await expect(page.getByLabel("π 设置")).toBeVisible();
  await expect(page.getByRole("heading", { name: "外观", exact: true, level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "返回工作台" }).click();
  await expect(helpButton).toBeVisible();

  await helpButton.click();
  await page.getByRole("menuitem", { name: "关于", exact: true }).click();
  await expect(page.getByRole("heading", { name: "关于", exact: true })).toBeVisible();
  await expect(page.getByText("Pi-first Desktop Workbench", { exact: true })).toBeVisible();
});

test("keeps long workspace and session names inside the navigation column", async ({ page }) => {
  const longWorkspace: MockWorkspaceDescriptor = {
    ...DEFAULT_MOCK_WORKSPACE,
    id: "workspace-long-name",
    displayName: "pi-enterprise-platform-with-a-very-long-workspace-name",
    identity: {
      ...DEFAULT_MOCK_WORKSPACE.identity,
      canonicalPath: "/Users/test/Projects/pi-enterprise-platform-with-a-very-long-workspace-name",
      inode: "99"
    }
  };
  const longSession = sessionSummary(
    longWorkspace,
    1,
    "重构跨工作区后台任务恢复协议并完成完整视觉验证的超长会话名称"
  );
  await openWorkbench(page, { pickerQueue: [longWorkspace] }, {
    sessionCatalogItemsByWorkspace: { [longWorkspace.id]: [longSession] }
  });

  const navigation = page.getByRole("complementary", { name: "会话导航" });
  const metrics = await navigation.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    documentWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.documentScrollWidth).toBe(metrics.documentWidth);
  await expect(workspaceGroup(page, longWorkspace.displayName).getByTestId("conversation-row").filter({
    hasText: "重构跨工作区"
  })).toBeVisible();
});
