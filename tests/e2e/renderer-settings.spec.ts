import { expect, test, type Page } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  emitMockAgentEvent,
  installMockDesktopBridge,
  recordedCommandDetails,
  setMockAgentResponseFailure,
  setMockAgentResponseResult
} from "./pi67-renderer-fixture.js";
import { DEFAULT_MOCK_WORKSPACE } from "./pi67-renderer-desktop-bridge.js";

interface PackageEntry {
  source: string;
  scope: "global" | "project";
  enabled: boolean;
  filtered: boolean;
  installed: boolean;
}

async function openExtensionSettings(page: Page, items: PackageEntry[]): Promise<void> {
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await setMockAgentResponseResult(page, "extension.package.list", {
    items,
    total: items.length
  });
  await page.getByRole("button", { name: "帮助与设置" }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "Extensions", exact: true }).click();
  await expect.poll(async () => (
    await recordedCommandDetails(page)
  ).filter((command) => command.type === "extension.package.list").length).toBeGreaterThan(0);
}

test("lists package sources and keeps update eligibility bounded to npm and git", async ({ page }) => {
  const npmSource = "npm:@example/pi-extension";
  const pathSource = "/Users/test/Extensions/local-extension";
  await openExtensionSettings(page, [
    packageEntry(npmSource, "global"),
    packageEntry(pathSource, "global")
  ]);
  await expect(page.getByText(npmSource, { exact: true })).toBeVisible();
  await expect(page.getByText(pathSource, { exact: true })).toBeVisible();

  await setMockAgentResponseResult(page, "extension.package.checkUpdates", {
    items: [{
      source: npmSource,
      scope: "global",
      type: "npm",
      displayName: "@example/pi-extension"
    }],
    total: 1
  });
  await clearRecordedCommands(page);
  await page.getByRole("button", { name: "检查更新" }).click();

  await expect(page.getByRole("button", { name: `更新 ${npmSource}` })).toBeVisible();
  await expect(page.getByRole("button", { name: `更新 ${pathSource}` })).toHaveCount(0);
  expect((await recordedCommandDetails(page)).find((command) => (
    command.type === "extension.package.checkUpdates"
  ))).toMatchObject({
    payload: {},
    context: { scope: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id }
  });
});

test("confirms install and path uninstall with scoped Host mutations", async ({ page }) => {
  const pathSource = "/Users/test/Extensions/local-extension";
  const npmSource = "npm:@example/new-extension";
  const pathEntry = packageEntry(pathSource, "global");
  await openExtensionSettings(page, [pathEntry]);
  await clearRecordedCommands(page);

  await page.getByRole("textbox", { name: "npm、git 或本地 path" }).fill(npmSource);
  await page.getByRole("button", { name: "安装到全局" }).click();
  let dialog = page.getByRole("dialog", { name: "安装 Extension 包？" });
  await expect(dialog).toContainText(npmSource);
  await expect(dialog).toContainText("该操作可能访问网络并加载 Extension 代码");
  await setMockAgentResponseResult(page, "extension.package.install", {
    changed: true,
    items: [pathEntry, packageEntry(npmSource, "global")],
    total: 2
  });
  await dialog.getByRole("button", { name: "确认安装" }).click();

  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("π 设置").getByText(npmSource, { exact: true })).toBeVisible();
  expect((await recordedCommandDetails(page)).find((command) => (
    command.type === "extension.package.install"
  ))).toMatchObject({
    payload: { source: npmSource, scope: "global" },
    context: { scope: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id }
  });

  await page.getByRole("button", { name: `卸载 ${pathSource}` }).click();
  dialog = page.getByRole("dialog", { name: "卸载 Extension 包？" });
  await expect(dialog).toContainText("本地 path 只移除配置引用，不删除用户目录");
  await setMockAgentResponseResult(page, "extension.package.uninstall", {
    changed: true,
    items: [packageEntry(npmSource, "global")],
    total: 1
  });
  await dialog.getByRole("button", { name: "确认卸载" }).click();

  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(pathSource, { exact: true })).toHaveCount(0);
  expect((await recordedCommandDetails(page)).find((command) => (
    command.type === "extension.package.uninstall"
  ))).toMatchObject({ payload: { source: pathSource, scope: "global" } });
});

test("manages project overrides and restores global inheritance", async ({ page }) => {
  const source = "npm:@example/inherited-extension";
  const globalEntry = packageEntry(source, "global");
  const projectEntry = packageEntry(source, "project", false);
  await openExtensionSettings(page, [globalEntry, projectEntry]);
  await page.getByRole("button", { name: DEFAULT_MOCK_WORKSPACE.displayName, exact: true }).click();
  await expect(page.getByText("当前项目", { exact: true })).toBeVisible();
  await clearRecordedCommands(page);

  await setMockAgentResponseResult(page, "extension.package.setEnabled", {
    changed: true,
    items: [globalEntry, { ...projectEntry, enabled: true }],
    total: 2
  });
  await page.getByRole("button", { name: `启用 ${source}` }).click();
  await expect(page.getByRole("button", { name: `停用 ${source}` })).toBeVisible();
  expect((await recordedCommandDetails(page)).find((command) => (
    command.type === "extension.package.setEnabled"
  ))).toMatchObject({ payload: { source, scope: "project", enabled: true } });

  await setMockAgentResponseResult(page, "extension.package.restoreInheritance", {
    changed: true,
    items: [globalEntry],
    total: 1
  });
  await page.getByRole("button", { name: `恢复继承 ${source}` }).click();
  await expect(page.getByText("继承自全局", { exact: true })).toBeVisible();
  expect((await recordedCommandDetails(page)).find((command) => (
    command.type === "extension.package.restoreInheritance"
  ))).toMatchObject({ payload: { source } });
});

test("keeps a failed package mutation visible instead of reporting success", async ({ page }) => {
  const source = "npm:@example/failing-extension";
  await openExtensionSettings(page, []);
  await setMockAgentResponseFailure(page, "extension.package.install", {
    code: "INTERNAL",
    message: "模拟安装失败",
    recoverable: true
  });
  await clearRecordedCommands(page);

  await page.getByRole("textbox", { name: "npm、git 或本地 path" }).fill(source);
  await page.getByRole("button", { name: "安装到全局" }).click();
  await page.getByRole("dialog", { name: "安装 Extension 包？" })
    .getByRole("button", { name: "确认安装" }).click();

  await expect(page.getByText("模拟安装失败").first()).toBeVisible();
  await expect(page.getByText("Extension 已安装", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "安装 Extension 包？" })).toBeVisible();
  await expect.poll(async () => (
    await recordedCommandDetails(page)
  ).filter((command) => command.type === "extension.package.install")).toHaveLength(1);
});

test("blocks global package mutations while any task is running", async ({ page }) => {
  const source = "npm:@example/busy-extension";
  await openExtensionSettings(page, []);
  await emitMockAgentEvent(page, {
    type: "operation.started",
    payload: {
      operation: {
        operationId: "operation-extension-busy",
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-test",
        sessionGeneration: 1,
        startedAt: Date.now()
      }
    }
  }, { operationId: "operation-extension-busy" });
  await clearRecordedCommands(page);

  await page.getByRole("textbox", { name: "npm、git 或本地 path" }).fill(source);
  await page.getByRole("button", { name: "安装到全局" }).click();
  await page.getByRole("dialog", { name: "安装 Extension 包？" })
    .getByRole("button", { name: "确认安装" }).click();

  await expect(page.getByText("请先完成或停止所有正在运行或等待输入的任务。"))
    .toBeVisible();
  expect((await recordedCommandDetails(page)).filter((command) => (
    command.type === "extension.package.install"
  ))).toHaveLength(0);
});

test("uses compact grouped navigation and real Settings search", async ({ page }) => {
  await page.setViewportSize({ width: 1040, height: 800 });
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");

  const settings = page.getByLabel("π 设置");
  const navigation = settings.getByRole("navigation", { name: "设置分类" });
  const search = settings.getByRole("searchbox", { name: "搜索设置" });

  for (const group of ["个人", "应用", "Pi", "支持"]) {
    await expect(navigation.getByRole("group", { name: group, exact: true })).toBeVisible();
  }
  await expect(settings.locator("aside img")).toHaveCount(0);
  await expect(navigation.locator("small")).toHaveCount(0);

  await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");
  await expect(search).toBeFocused();
  await search.fill("主题");
  await expect(navigation.getByRole("button", { name: "通用", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "账户", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Extensions", exact: true })).toHaveCount(0);

  await search.fill("卸载");
  await navigation.getByRole("button", { name: "Extensions", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "Extensions", exact: true })).toBeVisible();

  await settings.getByRole("button", { name: "清除设置搜索" }).click();
  await expect(navigation.getByRole("button", { name: "账户", exact: true })).toBeVisible();
  await search.fill("不存在的设置");
  await expect(navigation.getByText("没有匹配的设置", { exact: true })).toBeVisible();
  await navigation.getByRole("button", { name: "清除搜索", exact: true }).click();
  await expect(navigation.getByRole("button", { name: "通用", exact: true })).toBeVisible();
});

test("keeps Settings navigation and primary actions reachable at a 200 percent zoom equivalent viewport", async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 400 });
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  const navigation = page.getByRole("navigation", { name: "设置分类" });
  const contentHeader = page.getByRole("heading", { name: "通用", exact: true }).locator("..");
  const layout = await settings.evaluate((element) => {
    const navigationElement = element.querySelector<HTMLElement>('[aria-label="设置分类"]');
    const contentElement = navigationElement?.parentElement?.nextElementSibling;
    const navigationRect = navigationElement?.getBoundingClientRect();
    const contentRect = contentElement?.getBoundingClientRect();
    return {
      columns: getComputedStyle(element).gridTemplateColumns,
      navigationBottom: navigationRect?.bottom,
      contentTop: contentRect?.top
    };
  });
  expect(layout.columns).toBe("520px");
  expect(layout.navigationBottom).toBeLessThanOrEqual((layout.contentTop ?? 0) + 1);
  await expect(navigation).toBeVisible();
  await expect(contentHeader).toBeVisible();
  await expect(page.getByRole("group", { name: "设置作用域" })).toHaveCount(0);

  await navigation.getByRole("button", { name: /Extensions/u }).click();
  await expect(page.getByRole("button", { name: DEFAULT_MOCK_WORKSPACE.displayName, exact: true })).toBeVisible();

  await navigation.getByRole("button", { name: /更新与诊断/u }).click();
  await expect(page.getByRole("button", { name: /^检查更新/u })).toBeVisible();
  await expect(page.getByRole("button", { name: /^导出脱敏诊断/u })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "已打开的任务" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "显示会话导航" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "返回工作台" })).toBeVisible();
  await expect(page.getByRole("button", { name: /上下文/u })).toHaveCount(0);
  expect(await page.locator(".title-bar").evaluate((element) => ({
    columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
    brandDisplay: getComputedStyle(element.querySelector<HTMLElement>(".brand-lockup")!).display
  }))).toEqual({ columns: 2, brandDisplay: "none" });
  expect(await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    height: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight
  }))).toEqual({ width: 520, scrollWidth: 520, height: 400, scrollHeight: 400 });
});

test("keeps long Workspace scope and Provider actions inside a 1040 pixel Settings surface", async ({ page }) => {
  const longWorkspace = {
    ...DEFAULT_MOCK_WORKSPACE,
    displayName: "pi-runtime-and-session-workbench-with-a-deliberately-long-workspace-name",
    identity: {
      ...DEFAULT_MOCK_WORKSPACE.identity,
      canonicalPath: "/Users/test/Projects/pi-runtime-and-session-workbench-with-a-deliberately-long-workspace-name"
    }
  };
  await page.setViewportSize({ width: 1040, height: 800 });
  await installMockDesktopBridge(page, { pickerQueue: [longWorkspace] });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  const navigation = settings.getByRole("navigation", { name: "设置分类" });
  await navigation.getByRole("button", { name: /^Provider 与模型/u }).click();
  const scope = page.getByRole("group", { name: "设置作用域" });
  const manageCredentials = page.getByRole("button", { name: "管理凭据" });
  await expect(scope).toBeVisible();
  await expect(manageCredentials).toBeVisible();

  expect(await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }))).toEqual({ clientWidth: 1040, scrollWidth: 1040 });
  for (const locator of [scope, manageCredentials]) {
    const bounds = await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(1040);
    expect(bounds.width).toBeGreaterThan(0);
  }

  await navigation.getByRole("button", { name: /^Extensions/u }).click();
  for (const locator of [
    settings.getByRole("button", { name: "检查更新", exact: true }),
    settings.getByRole("button", { name: "安装到全局", exact: true })
  ]) {
    await expect(locator).toBeVisible();
    const bounds = await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(1040);
    expect(bounds.width).toBeGreaterThan(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1040);
});

function packageEntry(
  source: string,
  scope: "global" | "project",
  enabled = true
): PackageEntry {
  return { source, scope, enabled, filtered: false, installed: true };
}
