import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  emitMockAgentEvent,
  installMockDesktopBridge,
  recordedCommandDetails
} from "./pi67-renderer-fixture.js";
import {
  DEFAULT_MOCK_WORKSPACE,
  type MockDesktopBridgeOptions,
  type MockWorkspaceDescriptor
} from "./pi67-renderer-desktop-bridge.js";
import type { FixtureSessionSummary } from "./pi67-session-catalog-fixture.js";
import type { MockAgentOptions } from "./pi67-renderer-fixture-types.js";

const PRIMARY_MODIFIER = process.platform === "darwin" ? "Meta" : "Control";
const EXPECTED_MAX_RUNNING_TASKS = 8;

async function openWorkbench(
  page: Page,
  bridgeOptions: MockDesktopBridgeOptions = {},
  agentOptions: MockAgentOptions = {}
): Promise<void> {
  await installMockDesktopBridge(page, bridgeOptions);
  await page.goto("/");
  await attachMockAgent(page, [], {}, {
    isolateTaskSnapshots: true,
    rotateSessionOnCreate: true,
    ...agentOptions
  });
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect.poll(async () => (
    await recordedCommandDetails(page)
  ).map((command) => command.type)).toContain("workspace.open");
  await expect(page.getByLabel("Pi conversation")).toBeVisible();
  await expect(page.getByRole("list", { name: "工作区与会话" })).toBeVisible();
}

test("restores persisted Workspace authority without asking for the Workspace again", async ({ page }, testInfo) => {
  const sessionPath = "/Users/test/.pi/agent/sessions/persisted.jsonl";
  const sessionFileIdentity = "session-file-fixture-persisted";
  await installMockDesktopBridge(page, {
    initialWorkspaces: [DEFAULT_MOCK_WORKSPACE],
    expandedWorkspaceIds: [DEFAULT_MOCK_WORKSPACE.id],
    currentWorkspaceId: DEFAULT_MOCK_WORKSPACE.id,
    selectedSurface: {
      kind: "conversation",
      conversation: {
        kind: "session",
        workspaceId: DEFAULT_MOCK_WORKSPACE.id,
        sessionFileIdentity,
        sessionPath
      }
    }
  });
  await page.goto("/");
  await attachMockAgent(page, [], {}, {
    sessionCatalogItemsByWorkspace: {
      [DEFAULT_MOCK_WORKSPACE.id]: [{
        id: "session-persisted",
        fileIdentity: sessionFileIdentity,
        path: sessionPath,
        cwd: DEFAULT_MOCK_WORKSPACE.identity.canonicalPath,
        name: "已保存的会话",
        modifiedAt: 1_800_000_000_000,
        messageCount: 8
      }]
    }
  });

  await expect(page.getByText("等待选择工作区", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("当前状态：会话待打开")).toBeVisible();
  await expect(page.getByRole("list", { name: "工作区与会话" })).toBeVisible();
  await expect(page.getByTestId("conversation-row").filter({ hasText: "已保存的会话" })).toBeVisible();
  await expect(page.getByLabel("Pi conversation")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开会话", exact: true })).toBeVisible();
  await expect(page.getByTestId("title-context-current")).toHaveText("已保存的会话");
  await expect(page.getByTestId("title-context-workspace")).toHaveCount(0);
  await expect(page.getByTestId("title-brand-mark")).toHaveCount(0);
  await expect.poll(async () => {
    const commands = await recordedCommandDetails(page);
    return commands.filter((command) => command.type === "workspace.register").length;
  }).toBe(1);
  await expect.poll(async () => {
    const commands = await recordedCommandDetails(page);
    return commands.filter((command) => command.type === "session.catalog.query").length;
  }).toBeGreaterThanOrEqual(1);

  await page.getByRole("button", { name: "隐藏会话导航" }).click();
  await expect(page.getByTestId("title-context-workspace")).toHaveText(DEFAULT_MOCK_WORKSPACE.displayName);
  await expect(page.getByTestId("title-context-current")).toHaveText("已保存的会话");
  await page.screenshot({ path: testInfo.outputPath("title-context-collapsed.png"), animations: "disabled" });
  await page.getByRole("button", { name: "显示会话导航" }).click();
  await page.screenshot({ path: testInfo.outputPath("title-context-expanded.png"), animations: "disabled" });

  await page.getByRole("button", { name: "打开会话", exact: true }).click();
  await expect(page.getByLabel("Pi conversation")).toBeVisible();
  await expect(page.getByLabel("给 Pi 发送消息")).toBeVisible();
  await expect(page.getByLabel("当前状态：Pi SDK 已就绪")).toBeVisible();
  await expect.poll(async () => {
    const commands = await recordedCommandDetails(page);
    return commands.filter((command) => command.type === "runtime.initialize").length;
  }).toBe(1);
});

test("uses the left workspace conversation list instead of horizontal task tabs", async ({ page }) => {
  await openWorkbench(page);

  await expect(page.getByLabel("π 工作台")).toBeVisible();
  await expect(page.getByRole("tablist", { name: "已打开的任务" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /关闭任务/u })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /未登录\s*本地模式/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "帮助与设置" })).toBeVisible();

  const titleActions = page.locator(".title-actions");
  await expect(titleActions.locator("button").last()).toHaveAttribute("data-testid", "inspector-toggle");

  await page.getByRole("button", { name: /未登录\s*本地模式/u }).click();
  await expect(page.getByLabel("π 设置")).toBeVisible();
  await expect(page.getByRole("heading", { name: "账户与本地数据", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("group", { name: "设置作用域" })).toHaveCount(0);
  await expect(page.getByLabel("Pi conversation")).toHaveCount(0);
  await expect(page.getByTestId("inspector-toggle")).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "会话导航" })).toHaveCount(0);
  await expect(page.getByTestId("title-context-current")).toHaveText("设置");
  await expect(page.getByTestId("title-brand-mark")).toHaveCount(0);

  const settingsColumns = await page.getByTestId("settings-workbench").evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    columns: getComputedStyle(element).gridTemplateColumns
  }));
  expect(settingsColumns.width).toBe(1440);
  expect(settingsColumns.columns.split(" ")).toHaveLength(2);

  await page.getByRole("button", { name: "返回工作台" }).click();
  await expect(page.getByRole("complementary", { name: "会话导航" })).toBeVisible();
  await expect(page.getByLabel("Pi conversation")).toBeVisible();
});

test("uses the latest accepted user message as the current in-memory conversation title", async ({ page }) => {
  await openWorkbench(page);
  const composer = page.getByRole("textbox", { name: "给 Pi 发送消息" });

  await composer.fill("重新检查双栏设置的响应式问题");
  await page.getByRole("button", { name: "发送", exact: true }).click();

  const currentRow = page.getByTestId("conversation-row").filter({
    hasText: "重新检查双栏设置的响应式问题"
  });
  await expect(currentRow).toContainText("重新检查双栏设置的响应式问题");
  await expect(currentRow).toContainText("未命名会话");
  await expect(page.locator(".brand-lockup")).toContainText("重新检查双栏设置的响应式问题");
});

test("shows six recent sessions first and expands beyond the former 20-tab limit", async ({ page }) => {
  const sessions = Array.from({ length: 25 }, (_, index) => sessionSummary(
    DEFAULT_MOCK_WORKSPACE,
    index + 1,
    `会话 ${String(index + 1).padStart(2, "0")}`
  ));
  await openWorkbench(page, {}, {
    sessionCatalogItemsByWorkspace: { [DEFAULT_MOCK_WORKSPACE.id]: sessions }
  });

  const group = workspaceGroup(page, DEFAULT_MOCK_WORKSPACE.displayName);
  const catalogRows = group.getByTestId("conversation-row").filter({ hasText: /会话 \d{2}/u });
  await expect(catalogRows).toHaveCount(6);
  await expect(group.getByRole("button", { name: "显示更多" })).toBeVisible();

  await group.getByRole("button", { name: "显示更多" }).click();

  await expect(catalogRows).toHaveCount(25);
  await expect(group.getByRole("button", { name: "收起" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "已打开的任务" })).toHaveCount(0);

  await page.getByRole("button", { name: `${DEFAULT_MOCK_WORKSPACE.displayName} 工作区菜单` }).click();
  const workspaceMenu = page.getByRole("menu", { name: `${DEFAULT_MOCK_WORKSPACE.displayName} 工作区菜单` });
  await expect(workspaceMenu.getByRole("menuitem", { name: "刷新会话" })).toBeVisible();
  await expect(workspaceMenu.getByRole("menuitem", { name: "导入 Pi Session" })).toBeVisible();
  await expect(workspaceMenu.getByRole("menuitem", { name: "已归档对话" })).toBeVisible();
});

test("keeps independent session catalogs for multiple workspaces and switches the center surface", async ({ page }) => {
  const docsWorkspace = secondWorkspace();
  const piSession = sessionSummary(DEFAULT_MOCK_WORKSPACE, 1, "Pi 工作台方案");
  const docsSession = sessionSummary(docsWorkspace, 1, "Docs 发布说明");
  await openWorkbench(page, {
    pickerQueue: [DEFAULT_MOCK_WORKSPACE, docsWorkspace]
  }, {
    sessionCatalogItemsByWorkspace: {
      [DEFAULT_MOCK_WORKSPACE.id]: [piSession],
      [docsWorkspace.id]: [docsSession]
    }
  });

  await page.getByRole("button", { name: "添加或创建工作区" }).click();

  const piGroup = workspaceGroup(page, DEFAULT_MOCK_WORKSPACE.displayName);
  const docsGroup = workspaceGroup(page, docsWorkspace.displayName);
  await expect(piGroup.getByTestId("conversation-row").filter({ hasText: "Pi 工作台方案" })).toBeVisible();
  await expect(piGroup.getByTestId("conversation-row").filter({ hasText: "Docs 发布说明" })).toHaveCount(0);
  await expect(docsGroup.getByTestId("conversation-row").filter({ hasText: "Docs 发布说明" })).toBeVisible();
  await expect(docsGroup.getByTestId("conversation-row").filter({ hasText: "Pi 工作台方案" })).toHaveCount(0);

  const catalogContexts = (await recordedCommandDetails(page))
    .filter((command) => command.type === "session.catalog.query")
    .map((command) => command.context);
  expect(catalogContexts).toEqual(expect.arrayContaining([
    { scope: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id },
    { scope: "workspace", workspaceId: docsWorkspace.id }
  ]));

  await piGroup.getByTestId("conversation-row").filter({ hasText: "Pi 工作台方案" }).click();
  await expect(page.getByTestId("title-context-current")).toHaveText("Pi 工作台方案");
  await expect(page.getByTestId("title-context-workspace")).toHaveCount(0);
  await expect(page.getByLabel("Pi conversation")).toBeVisible();

  await docsGroup.getByTestId("conversation-row").filter({ hasText: "Docs 发布说明" }).click();
  await expect(page.getByTestId("title-context-current")).toHaveText("Docs 发布说明");
  await expect(page.getByTestId("title-context-workspace")).toHaveCount(0);
  await expect(page.getByLabel("Pi conversation")).toBeVisible();
  await expect.poll(async () => (
    await recordedCommandDetails(page)
  ).filter((command) => command.type === "runtime.initialize").map((command) => command.payload))
    .toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionPath: piSession.path }),
      expect.objectContaining({ sessionPath: docsSession.path })
    ]));
  expect((await recordedCommandDetails(page)).filter((command) => command.type === "session.open"))
    .toHaveLength(0);
});

test("supports new-task aliases and leaves Cmd/Ctrl+W to the native window", async ({ page }) => {
  await openWorkbench(page);
  await clearRecordedCommands(page);

  await page.keyboard.press(`${PRIMARY_MODIFIER}+n`);
  await expect.poll(async () => (
    await recordedCommandDetails(page)
  ).filter((command) => command.type === "session.create")).toHaveLength(1);

  await page.keyboard.press(`${PRIMARY_MODIFIER}+t`);
  await expect.poll(async () => (
    await recordedCommandDetails(page)
  ).filter((command) => command.type === "session.create")).toHaveLength(2);

  await page.keyboard.press(`${PRIMARY_MODIFIER}+w`);
  expect((await recordedCommandDetails(page)).filter((command) => command.type === "task.close"))
    .toHaveLength(0);
  await expect(page.getByRole("tablist", { name: "已打开的任务" })).toHaveCount(0);

  await page.keyboard.press(`${PRIMARY_MODIFIER}+b`);
  await expect(page.getByRole("button", { name: "显示会话导航" })).toBeVisible();
  await page.keyboard.press(`${PRIMARY_MODIFIER}+b`);
  await expect(page.getByRole("button", { name: "隐藏会话导航" })).toBeVisible();

  await page.keyboard.press(`${PRIMARY_MODIFIER}+Shift+b`);
  await expect(page.getByTestId("inspector-toggle")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press(`${PRIMARY_MODIFIER}+Shift+b`);
  await expect(page.getByTestId("inspector-toggle")).toHaveAttribute("aria-expanded", "false");

  await page.keyboard.press(`${PRIMARY_MODIFIER}+,`);
  await expect(page.getByLabel("π 设置")).toBeVisible();
  await expect(page.getByRole("button", { name: "返回工作台" })).toBeVisible();
});

test("rejects a task above the shared running limit without discarding its draft", async ({ page }) => {
  await openWorkbench(page);
  await markCurrentTaskRunning(page, 0, "session-test", "session-file-fixture-demo", 1);

  for (let index = 1; index < EXPECTED_MAX_RUNNING_TASKS; index += 1) {
    await page.keyboard.press(`${PRIMARY_MODIFIER}+n`);
    await expect.poll(async () => (
      await recordedCommandDetails(page)
    ).filter((command) => command.type === "session.create")).toHaveLength(index);
    await markCurrentTaskRunning(
      page,
      index,
      `session-created-${index}`,
      `session-file-fixture-${index}`,
      index + 1
    );
  }

  await page.keyboard.press(`${PRIMARY_MODIFIER}+n`);
  await expect.poll(async () => (
    await recordedCommandDetails(page)
  ).filter((command) => command.type === "session.create")).toHaveLength(EXPECTED_MAX_RUNNING_TASKS);
  await clearRecordedCommands(page);

  const composer = page.getByRole("textbox", { name: "给 Pi 发送消息" });
  await composer.fill("保留这个超出并发上限任务的草稿");
  await composer.press("Enter");

  await expect(page.getByText(
    `已有 ${EXPECTED_MAX_RUNNING_TASKS} 个会话任务正在运行或等待交互。请先完成或停止一个任务。`,
    { exact: true }
  ))
    .toBeVisible();
  await expect(composer).toHaveValue("保留这个超出并发上限任务的草稿");
  expect((await recordedCommandDetails(page)).filter((command) => command.type === "prompt.submit"))
    .toHaveLength(0);
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
  await page.getByRole("menuitem", { name: /帮助/u }).click();
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
  await expect(workspaceGroup(page, longWorkspace.displayName).getByTestId("conversation-row").filter({ hasText: "重构跨工作区" }))
    .toBeVisible();
});

function workspaceGroup(page: Page, workspaceName: string): Locator {
  return page.getByRole("button", { name: `折叠工作区：${workspaceName}` })
    .locator("xpath=ancestor::section");
}

function sessionSummary(
  workspace: MockWorkspaceDescriptor,
  index: number,
  name: string
): FixtureSessionSummary {
  return {
    id: `${workspace.id}-session-${index}`,
    fileIdentity: `session-file-fixture-${workspace.id}-${index}`,
    path: `/Users/test/.pi/agent/sessions/${workspace.id}-${index}.jsonl`,
    cwd: workspace.identity.canonicalPath,
    name,
    modifiedAt: 1_800_000_000_000 - index * 60_000,
    messageCount: index
  };
}

function secondWorkspace(): MockWorkspaceDescriptor {
  return {
    ...DEFAULT_MOCK_WORKSPACE,
    id: "workspace-docs-demo",
    displayName: "docs-demo",
    identity: {
      ...DEFAULT_MOCK_WORKSPACE.identity,
      canonicalPath: "/Users/test/Projects/docs-demo",
      inode: "68"
    }
  };
}

async function markCurrentTaskRunning(
  page: Page,
  index: number,
  sessionId: string,
  sessionFileIdentity: string,
  sessionGeneration: number
): Promise<void> {
  const operationId = `operation-workbench-running-${index}`;
  await emitMockAgentEvent(page, {
    type: "operation.started",
    payload: {
      operation: {
        operationId,
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId,
        sessionFileIdentity,
        sessionGeneration,
        startedAt: Date.now()
      }
    }
  }, { operationId, sessionId, sessionFileIdentity, sessionGeneration });
}
