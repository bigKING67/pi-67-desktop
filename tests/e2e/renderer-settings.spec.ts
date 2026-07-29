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
  displayName?: string;
  version?: string;
  description?: string;
  resourceTypes?: Array<"extension" | "skill" | "prompt" | "theme">;
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
  await page.getByRole("button", { name: "扩展", exact: true }).click();
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

  await page.getByRole("button", { name: /@example\/pi-extension，npm:@example\/pi-extension/u }).click();
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

  await page.getByRole("button", { name: "安装扩展" }).click();
  let dialog = page.getByRole("dialog", { name: "安装 Extension" });
  const sourceInput = dialog.getByRole("textbox", { name: "npm 包、Git URL 或本地目录" });
  await sourceInput.fill(npmSource);
  await expect(sourceInput).toHaveValue(npmSource);
  await expect(dialog).toContainText("安装可能访问网络并加载代码");
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

  await page.getByRole("button", { name: `local-extension，${pathSource} · 全局` }).click();
  await page.getByRole("button", { name: `卸载 ${pathSource}` }).click();
  dialog = page.getByRole("dialog", { name: "卸载 Extension？" });
  await expect(dialog).toContainText("本地目录只移除配置引用，不删除用户目录");
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
  await page.getByRole("button", { name: `项目 · ${DEFAULT_MOCK_WORKSPACE.displayName}`, exact: true }).click();
  await expect(page.getByText(/当前项目/u).first()).toBeVisible();
  await page.getByRole("button", { name: /inherited-extension，npm:@example\/inherited-extension · 当前项目/u }).click();
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
  await expect(page.getByLabel("@example/inherited-extension 详情")).toContainText("继承自全局");
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

  await page.getByRole("button", { name: "安装扩展" }).click();
  const installDialog = page.getByRole("dialog", { name: "安装 Extension" });
  await installDialog.getByRole("textbox", { name: "npm 包、Git URL 或本地目录" }).fill(source);
  await installDialog.getByRole("button", { name: "确认安装" }).click();

  await expect(page.getByText("模拟安装失败").first()).toBeVisible();
  await expect(page.getByText("Extension 已安装", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "安装 Extension" })).toBeVisible();
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

  await page.getByRole("button", { name: "安装扩展" }).click();
  const installDialog = page.getByRole("dialog", { name: "安装 Extension" });
  await installDialog.getByRole("textbox", { name: "npm 包、Git URL 或本地目录" }).fill(source);
  await installDialog.getByRole("button", { name: "确认安装" }).click();

  await expect(page.getByText("请先完成或停止所有正在运行或等待输入的任务。"))
    .toBeVisible();
  expect((await recordedCommandDetails(page)).filter((command) => (
    command.type === "extension.package.install"
  ))).toHaveLength(0);
});

test("uses one Extension workbench for installed, discovery, and runtime states", async ({ page }) => {
  await openExtensionSettings(page, [
    packageEntry("npm:pi-subagents", "global"),
    packageEntry("npm:pi-disabled", "global", false)
  ]);

  const workspace = page.getByTestId("extension-management-workspace");
  const tabs = workspace.getByRole("tablist", { name: "Extension 管理视图" });
  await expect(tabs.getByRole("tab", { name: /已安装/u })).toHaveAttribute("aria-selected", "true");
  await expect(workspace.getByRole("list", { name: "已安装扩展" }).getByText("随应用提供", { exact: true })).toBeVisible();
  await expect(workspace.getByText("外部安装", { exact: true }).first()).toBeVisible();
  await expect(workspace.getByText("已启用", { exact: true }).first()).toBeVisible();
  await expect(workspace.getByText("已停用", { exact: true }).first()).toBeVisible();

  await tabs.getByRole("tab", { name: /发现/u }).click();
  await expect(workspace.getByRole("heading", { name: "推荐扩展" })).toBeVisible();
  await expect(workspace.getByText("npm:pi-subagents", { exact: true })).toBeVisible();

  await tabs.getByRole("tab", { name: /当前会话/u }).click();
  await expect(workspace.getByRole("heading", { name: "当前 Session 实际加载的能力" })).toBeVisible();
  await expect(workspace.getByText("不等同于已安装目录", { exact: false })).toBeVisible();
});

test("keeps a dense Extension catalog in the shared document scroll and explains the selected package", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const entries = Array.from({ length: 48 }, (_, index) => packageEntry(
    `npm:extension-${String(index).padStart(2, "0")}`,
    "global",
    index % 3 !== 0,
    {
      displayName: `Extension ${String(index).padStart(2, "0")}`,
      version: `1.${index}.0`,
      description: index === 0
        ? "把独立任务委派给受控子代理，并将结果汇总回当前 Pi 会话。"
        : `Extension ${index} 的本地包功能说明。`,
      resourceTypes: ["extension"]
    }
  ));
  await openExtensionSettings(page, entries);

  const settings = page.getByLabel("π 设置");
  const workspace = settings.getByTestId("extension-management-workspace");
  const list = workspace.getByTestId("extension-package-list-scroll");
  const detail = workspace.getByTestId("extension-package-detail-scroll");
  const settingsScroll = settings.getByTestId("settings-scroll-region");
  await expect(list).toBeVisible();
  await expect(detail).toBeHidden();
  expect(await list.evaluate((element) => getComputedStyle(element).overflowY)).toBe("visible");
  expect(await settingsScroll.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
    await settingsScroll.evaluate((element) => element.clientHeight)
  );
  await settingsScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(workspace.getByRole("button", {
    name: "Extension 47，npm:extension-47 · 全局"
  })).toBeInViewport();
  await settingsScroll.evaluate((element) => { element.scrollTop = 0; });
  await workspace.getByRole("button", { name: "Extension 00，npm:extension-00 · 全局" }).click();
  await expect(list).toBeHidden();
  await expect(detail).toBeVisible();
  await expect(workspace.getByText("把独立任务委派给受控子代理，并将结果汇总回当前 Pi 会话。"))
    .toBeVisible();
  await expect(workspace.getByText("1.0.0", { exact: true })).toBeVisible();
  await expect(workspace.getByLabel("扩展提供的资源类型")).toContainText("Extension");
  await expect(workspace.getByTestId("extension-danger-zone")).toBeVisible();
  await workspace.getByRole("button", { name: "返回扩展列表" }).click();
  await expect(list).toBeVisible();
  await expect(detail).toBeHidden();
  expect(await settingsScroll.evaluate((element) => element.scrollTop)).toBe(0);
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
  await expect(navigation.getByRole("button", { name: "扩展", exact: true })).toHaveCount(0);

  await search.fill("卸载");
  await navigation.getByRole("button", { name: "扩展", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "扩展", exact: true })).toBeVisible();

  await settings.getByRole("button", { name: "清除设置搜索" }).click();
  await expect(navigation.getByRole("button", { name: "账户", exact: true })).toBeVisible();
  await search.fill("不存在的设置");
  await expect(navigation.getByText("没有匹配的设置", { exact: true })).toBeVisible();
  await navigation.getByRole("button", { name: "清除搜索", exact: true }).click();
  await expect(navigation.getByRole("button", { name: "通用", exact: true })).toBeVisible();
});

test("separates skills, prompts, rules, integrations, and download-source diagnostics", async ({ page }) => {
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  const navigation = settings.getByRole("navigation", { name: "设置分类" });

  await navigation.getByRole("button", { name: "技能", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "技能", exact: true })).toBeVisible();
  await expect(settings.getByText("Pi-67 Core", { exact: true })).toBeVisible();
  await expect(settings.getByText("browser67", { exact: true })).toBeVisible();

  await navigation.getByRole("button", { name: "提示词", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "提示词", exact: true })).toBeVisible();
  await expect(settings.getByText("Pi-67 Core", { exact: true })).toBeVisible();

  await navigation.getByRole("button", { name: "规则", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "规则", exact: true })).toBeVisible();
  await expect(settings.getByText("全局 AGENTS.md", { exact: true })).toBeVisible();
  await expect(settings.getByText("由用户管理", { exact: true })).toBeVisible();

  await navigation.getByRole("button", { name: "集成", exact: true }).click();
  await expect(settings.getByText("内置第一方", { exact: true })).toBeVisible();
  await expect(settings.getByText("尚未检查", { exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "准备依赖", exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "运行诊断", exact: true })).toBeVisible();

  await navigation.getByRole("button", { name: "下载源与网络", exact: true }).click();
  for (const version of ["24.18.0", "12.0.1", "2.53.0"]) {
    await expect(settings.getByText(version, { exact: true })).toBeVisible();
  }
  await expect(settings.getByText("https://registry.npmmirror.com", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "检测全部源", exact: true }).click();
  await expect(settings.getByText("36 ms", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
});

test("refreshes an initializing capability snapshot without requiring a manual retry", async ({ page }) => {
  await installMockDesktopBridge(page, { capabilityInitializingCalls: 2 });
  await page.goto("/");
  await attachMockAgent(page);
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "技能", exact: true }).click();
  const coreRow = settings.getByText("Pi-67 Core", { exact: true }).locator("..").locator("..");
  await expect(coreRow).toContainText("内置");
  await expect(coreRow).not.toContainText("不可用");
});

function packageEntry(
  source: string,
  scope: "global" | "project",
  enabled = true,
  metadata: Pick<PackageEntry, "displayName" | "version" | "description" | "resourceTypes"> = {}
): PackageEntry {
  return { source, scope, enabled, filtered: false, installed: true, ...metadata };
}
