import { expect, test } from "@playwright/test";
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
import { openPackageSettings, packageEntry } from "./pi67-renderer-package-settings-fixture.js";

test("asks once before installing observational memory on a fresh profile", async ({ page }) => {
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await setMockAgentResponseResult(page, "extension.package.onboarding.get", {
    source: "npm:pi-observational-memory",
    scope: "global",
    state: "unseen"
  });
  await page.getByRole("button", { name: "帮助与设置" }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "扩展", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "安装会话观察记忆扩展" });
  await expect(dialog.getByRole("heading", { name: "安装 pi-observational-memory？" })).toBeVisible();
  await expect(dialog.getByText("不会静默下载", { exact: false })).toBeVisible();
  await clearRecordedCommands(page);
  await dialog.getByRole("button", { name: "暂不安装" }).click();

  await expect.poll(async () => (await recordedCommandDetails(page)).map((command) => command.type))
    .toContain("extension.package.onboarding.decline");
  expect((await recordedCommandDetails(page)).some((command) => (
    command.type === "extension.package.install"
  ))).toBe(false);
  await expect(dialog).toHaveCount(0);
});

test("lists package sources and keeps update eligibility bounded to npm and git", async ({ page }) => {
  const npmSource = "npm:@example/pi-extension";
  const pathSource = "/Users/test/Extensions/local-extension";
  await openPackageSettings(page, [
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

  const list = page.getByTestId("extension-package-list-scroll");
  const updateAction = list.getByRole("button", { name: `更新 ${npmSource}` });
  const packageRow = updateAction.locator("xpath=ancestor::li[1]");
  const detailAction = packageRow.locator('[data-package-focus-action="details"]');
  await expect(updateAction).toBeVisible();
  await expect(updateAction).toHaveCSS("cursor", "pointer");
  await expect(detailAction).toHaveCSS("cursor", "pointer");
  await detailAction.hover();
  const rowAppearance = await packageRow.evaluate((element) => {
    const action = element.querySelector<HTMLElement>('[data-package-focus-action="update"]')!;
    const details = element.querySelector<HTMLElement>('[data-package-focus-action="details"]')!;
    const rowBounds = element.getBoundingClientRect();
    const actionBounds = action.getBoundingClientRect();
    return {
      actionRightInset: rowBounds.right - actionBounds.right,
      detailsBackground: getComputedStyle(details).backgroundColor,
      rowBackground: getComputedStyle(element).backgroundColor
    };
  });
  expect(rowAppearance.actionRightInset).toBeGreaterThanOrEqual(8);
  expect(rowAppearance.detailsBackground).toBe("rgba(0, 0, 0, 0)");
  expect(rowAppearance.rowBackground).not.toBe("rgba(0, 0, 0, 0)");
  await updateAction.click();
  const updateDialog = page.getByRole("dialog", { name: "更新扩展包？" });
  await expect(updateDialog).toBeVisible();
  await expect(page.getByTestId("extension-package-detail-scroll")).toBeHidden();
  await updateDialog.getByRole("button", { name: "取消" }).click();

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

test("updates one package from the catalog and focuses the next available update", async ({ page }) => {
  const firstSource = "npm:@example/update-first";
  const secondSource = "npm:@example/update-second";
  const entries = [
    packageEntry(firstSource, "global", true, { displayName: "Update First", version: "1.2.3" }),
    packageEntry(secondSource, "global", true, { displayName: "Update Second", version: "2.0.0" })
  ];
  await openPackageSettings(page, entries);
  await setMockAgentResponseResult(page, "extension.package.checkUpdates", {
    items: entries.map((entry) => ({
      source: entry.source,
      scope: entry.scope,
      type: "npm",
      displayName: entry.source.slice(4)
    })),
    total: entries.length
  });
  await page.getByRole("button", { name: "检查更新" }).click();
  await page.getByRole("button", { name: /可更新 2/u }).click();
  await setMockAgentResponseResult(page, "extension.package.update", {
    changed: true,
    items: [
      { ...entries[0]!, version: "1.3.0" },
      entries[1]!
    ],
    total: entries.length
  });
  await clearRecordedCommands(page);

  await page.getByRole("button", { name: `更新 ${firstSource}` }).click();
  await page.getByRole("dialog", { name: "更新扩展包？" })
    .getByRole("button", { name: "确认更新" }).click();

  await expect(page.getByRole("button", { name: `更新 ${firstSource}` })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `更新 ${secondSource}` })).toBeFocused();
  await expect(page.getByText("Update First 已更新", { exact: true })).toBeVisible();
  await expect(page.getByText("1.2.3 → 1.3.0 · 全局扩展包 · Pi 资源已重新加载。", { exact: true }))
    .toBeVisible();
  await expect(page.getByText("Pi Settings 已更新。", { exact: true })).toHaveCount(0);
  expect((await recordedCommandDetails(page)).filter((command) => (
    command.type === "extension.package.update"
  ))).toEqual([expect.objectContaining({
    payload: { source: firstSource, scope: "global" },
    context: { scope: "workspace", workspaceId: DEFAULT_MOCK_WORKSPACE.id }
  })]);
});

test("confirms install and path uninstall with scoped Host mutations", async ({ page }) => {
  const pathSource = "/Users/test/Extensions/local-extension";
  const npmSource = "npm:@example/new-extension";
  const pathEntry = packageEntry(pathSource, "global");
  await openPackageSettings(page, [pathEntry]);
  await clearRecordedCommands(page);

  await page.getByRole("button", { name: "安装扩展包" }).click();
  let dialog = page.getByRole("dialog", { name: "安装 Pi 扩展包" });
  const sourceInput = dialog.getByRole("textbox", { name: "npm 包、Git URL 或本地目录" });
  await sourceInput.fill(npmSource);
  await expect(sourceInput).toHaveValue(npmSource);
  await expect(dialog).toContainText("可执行扩展拥有与 Agent 相同的运行权限");
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
  dialog = page.getByRole("dialog", { name: "卸载扩展包？" });
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
  await openPackageSettings(page, [globalEntry, projectEntry]);
  await page.getByRole("button", { name: `项目 · ${DEFAULT_MOCK_WORKSPACE.displayName}`, exact: true }).click();
  await expect(page.getByText(/当前项目/u).first()).toBeVisible();
  await page.getByRole("button", { name: /inherited-extension，npm:@example\/inherited-extension · 当前项目/u }).click();
  await clearRecordedCommands(page);

  await setMockAgentResponseResult(page, "extension.package.setEnabled", {
    changed: true,
    items: [globalEntry, { ...projectEntry, enabled: true }],
    total: 2
  });
  await page.getByRole("button", { name: `启用 扩展 ${source}` }).click();
  await expect(page.getByRole("button", { name: `停用 扩展 ${source}` })).toBeVisible();
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
  await openPackageSettings(page, []);
  await setMockAgentResponseFailure(page, "extension.package.install", {
    code: "INTERNAL",
    message: "模拟安装失败",
    recoverable: true
  });
  await clearRecordedCommands(page);

  await page.getByRole("button", { name: "安装扩展包" }).click();
  const installDialog = page.getByRole("dialog", { name: "安装 Pi 扩展包" });
  await installDialog.getByRole("textbox", { name: "npm 包、Git URL 或本地目录" }).fill(source);
  await installDialog.getByRole("button", { name: "确认安装" }).click();

  await expect(page.getByText("模拟安装失败").first()).toBeVisible();
  await expect(page.getByText("扩展包已安装", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "安装 Pi 扩展包" })).toBeVisible();
  await expect.poll(async () => (
    await recordedCommandDetails(page)
  ).filter((command) => command.type === "extension.package.install")).toHaveLength(1);
});

test("blocks global package mutations while any task is running", async ({ page }) => {
  const source = "npm:@example/busy-extension";
  await openPackageSettings(page, []);
  await emitMockAgentEvent(page, {
    type: "operation.started",
    payload: {
      operation: {
        operationId: "operation-extension-busy",
        kind: "prompt",
        lifecycle: "running",
        cancellable: true,
        sessionId: "session-test",
        sessionFileIdentity: "session-file-fixture-demo",
        sessionGeneration: 1,
        startedAt: Date.now()
      }
    }
  }, { operationId: "operation-extension-busy" });
  await clearRecordedCommands(page);

  await page.getByRole("button", { name: "安装扩展包" }).click();
  const installDialog = page.getByRole("dialog", { name: "安装 Pi 扩展包" });
  await installDialog.getByRole("textbox", { name: "npm 包、Git URL 或本地目录" }).fill(source);
  await installDialog.getByRole("button", { name: "确认安装" }).click();

  await expect(page.getByText("请先完成或停止所有正在运行或等待输入的任务。"))
    .toBeVisible();
  expect((await recordedCommandDetails(page)).filter((command) => (
    command.type === "extension.package.install"
  ))).toHaveLength(0);
});

test("uses one extension package workbench for third-party installed and discovery states", async ({ page }) => {
  await openPackageSettings(page, [
    packageEntry("npm:pi-subagents", "global", true, {
      resourceTypes: ["extension", "skill", "prompt"],
      resourceStates: [
        { type: "extension", enabled: true },
        { type: "skill", enabled: false },
        { type: "prompt", enabled: true }
      ]
    }),
    packageEntry("npm:pi-disabled", "global", false)
  ]);

  const workspace = page.getByTestId("extension-management-workspace");
  const tabs = workspace.getByRole("tablist", { name: "Pi 扩展包管理视图" });
  await expect(tabs.getByRole("tab", { name: /已安装/u })).toHaveAttribute("aria-selected", "true");
  await expect(workspace.getByRole("list", { name: "已安装扩展包" }).getByText("第三方扩展包", { exact: true })).toBeVisible();
  await expect(workspace.getByText("随应用提供", { exact: true })).toHaveCount(0);
  await expect(workspace.getByText("已停用", { exact: true }).first()).toBeVisible();
  await expect(workspace.getByText("部分启用", { exact: true })).toBeVisible();
  await workspace.getByRole("button", { name: /pi-subagents，npm:pi-subagents · 全局/u }).click();
  await expect(workspace.getByLabel("扩展包提供的资源类型")).toContainText("扩展");
  await expect(workspace.getByLabel("扩展包提供的资源类型")).toContainText("技能");
  await expect(workspace.getByLabel("扩展包提供的资源类型")).toContainText("指令模板");
  await expect(workspace.getByRole("button", { name: "启用 技能 npm:pi-subagents" })).toBeVisible();
  await workspace.getByRole("button", { name: "返回扩展包列表" }).click();

  await tabs.getByRole("tab", { name: /发现/u }).click();
  await expect(workspace.getByRole("heading", { name: "推荐扩展包" })).toBeVisible();
  await expect(workspace.getByText("npm:pi-subagents", { exact: true })).toBeVisible();

  await expect(tabs.getByRole("tab", { name: /当前会话/u })).toHaveCount(0);
});

test("keeps a dense resource-package catalog in the shared document scroll and explains the selected package", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const entries = Array.from({ length: 48 }, (_, index) => packageEntry(
    index === 0 ? "npm:pi-subagents" : `npm:extension-${String(index).padStart(2, "0")}`,
    "global",
    index % 3 !== 0,
    {
      displayName: index === 0 ? "pi-subagents" : `Extension ${String(index).padStart(2, "0")}`,
      version: `1.${index}.0`,
      description: index === 0
        ? "Pi extension for delegating tasks to subagents with chains and parallel execution."
        : `Extension ${index} 的本地包功能说明。`,
      resourceTypes: ["extension"]
    }
  ));
  await openPackageSettings(page, entries);

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
  await workspace.getByRole("button", { name: "pi-subagents，npm:pi-subagents · 全局" }).click();
  await expect(list).toBeHidden();
  await expect(detail).toBeVisible();
  await expect(workspace.getByText("将任务委派给子代理，支持任务链、并行执行和交互式澄清。"))
    .toBeVisible();
  await expect(workspace.getByText("Pi extension for delegating tasks", { exact: false })).toHaveCount(0);
  await expect(workspace.getByText("1.0.0", { exact: true })).toBeVisible();
  await expect(workspace.getByLabel("扩展包提供的资源类型")).toContainText("扩展");
  await expect(workspace.getByTestId("extension-danger-zone")).toBeVisible();
  await workspace.getByRole("button", { name: "返回扩展包列表" }).click();
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
  const search = settings.getByRole("searchbox", { name: "搜索设置分类" });

  for (const group of ["应用", "Pi", "连接与集成", "系统与支持"]) {
    await expect(navigation.getByRole("group", { name: group, exact: true })).toBeVisible();
  }
  await expect(settings.locator("aside img")).toHaveCount(0);
  await expect(navigation.locator("small")).toHaveCount(0);

  await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");
  await expect(search).toBeFocused();
  await search.fill("主题");
  await expect(navigation.getByRole("button", { name: "外观", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "账户与本地数据", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "扩展", exact: true })).toHaveCount(0);

  await search.fill("卸载");
  await navigation.getByRole("button", { name: "扩展", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "扩展", exact: true })).toBeVisible();

  await settings.getByRole("button", { name: "清除设置分类搜索" }).click();
  await expect(navigation.getByRole("button", { name: "账户与本地数据", exact: true })).toBeVisible();
  await search.fill("不存在的设置");
  await expect(navigation.getByText("没有匹配的设置", { exact: true })).toBeVisible();
  await navigation.getByRole("button", { name: "清除搜索", exact: true }).click();
  await expect(navigation.getByRole("button", { name: "外观", exact: true })).toBeVisible();
});
