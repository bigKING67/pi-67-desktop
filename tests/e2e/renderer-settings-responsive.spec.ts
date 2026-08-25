import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge,
  setMockAgentResponseResult
} from "./pi67-renderer-fixture.js";
import { DEFAULT_MOCK_WORKSPACE } from "./pi67-renderer-desktop-bridge.js";

test("keeps Settings navigation and primary actions reachable at a 200 percent zoom equivalent viewport", async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 400 });
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page);
  await installUsageFixture(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  const navigation = page.getByRole("navigation", { name: "设置分类" });
  const contentHeader = page.getByRole("heading", { name: "外观", exact: true, level: 1 }).locator("..");
  const layout = await settings.evaluate((element) => {
    const navigationElement = [...element.querySelectorAll<HTMLElement>('[aria-label="设置分类"]')]
      .find((candidate) => getComputedStyle(candidate).display !== "none");
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

  const categoryTrigger = settings.getByRole("button", { name: "选择设置分类", exact: true });
  await categoryTrigger.click();
  const categoryMenu = page.getByRole("menu", { name: "选择设置分类" });
  await expect(categoryMenu).toBeVisible();
  for (const group of ["应用", "Pi", "办公", "能力与集成", "系统与支持"]) {
    await expect(categoryMenu.getByText(group, { exact: true })).toBeVisible();
  }
  const categoryPopover = page.getByRole("dialog", { name: "选择设置分类" });
  const popoverBounds = await categoryPopover.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  });
  expect(popoverBounds.left).toBeGreaterThanOrEqual(0);
  expect(popoverBounds.right).toBeLessThanOrEqual(520);
  expect(popoverBounds.top).toBeGreaterThanOrEqual(0);
  expect(popoverBounds.bottom).toBeLessThanOrEqual(400);
  await categoryMenu.getByRole("menuitem", { name: "扩展", exact: true }).click();
  await expect(page.getByRole("button", { name: `项目 · ${DEFAULT_MOCK_WORKSPACE.displayName}`, exact: true })).toBeVisible();
  const scrollRegion = settings.getByTestId("settings-scroll-region");
  await scrollRegion.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await scrollRegion.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await selectMobileSettingsSection(settings, page, "技能");
  const skillTabs = settings.getByRole("tablist", { name: "技能可用范围" });
  await expect(skillTabs).toBeVisible();
  await expect(page.getByRole("group", { name: "设置作用域" })).toHaveCount(0);
  const skillTabBounds = await skillTabs.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  });
  expect(skillTabBounds.left).toBeGreaterThanOrEqual(0);
  expect(skillTabBounds.right).toBeLessThanOrEqual(520);
  const bundledPanel = settings.getByRole("tabpanel", { name: "全局可用", exact: true });
  await expect(bundledPanel.getByTestId("bundled-skill-suite-row")).toHaveCount(5);
  await bundledPanel.getByTestId("bundled-skill-suite-row").filter({ hasText: "browser67" }).click();
  await expect(bundledPanel.getByRole("searchbox", { name: "搜索 browser67 技能" })).toBeVisible();
  await expect(bundledPanel.getByRole("button", { name: "返回全局可用技能" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(520);

  await selectMobileSettingsSection(settings, page, "工作规则");
  const ruleWorkspace = settings.getByTestId("rule-settings-workspace");
  const ruleTabs = ruleWorkspace.getByRole("tablist", { name: "工作规则范围" });
  await expect(ruleTabs).toBeVisible();
  const ruleTabBounds = await ruleTabs.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  });
  expect(ruleTabBounds.left).toBeGreaterThanOrEqual(0);
  expect(ruleTabBounds.right).toBeLessThanOrEqual(520);
  const ruleAdvanced = ruleWorkspace.locator("details").first();
  const ruleAdvancedSummary = ruleAdvanced.locator("summary");
  const ruleCategoryBounds = await ruleAdvancedSummary.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  });
  expect(ruleCategoryBounds.left).toBeGreaterThanOrEqual(0);
  expect(ruleCategoryBounds.right).toBeLessThanOrEqual(520);
  await ruleAdvancedSummary.click();
  await ruleWorkspace.getByRole("list", { name: "Pi-67 内置规则" })
    .getByRole("button", { name: /00-product\.md/u }).click();
  const contextDetail = ruleWorkspace.getByTestId("context-file-detail");
  await expect(contextDetail.getByRole("textbox", { name: "00-product.md Markdown 源码" })).toBeVisible();
  const detailBounds = await contextDetail.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
  });
  expect(detailBounds.left).toBeGreaterThanOrEqual(0);
  expect(detailBounds.right).toBeLessThanOrEqual(520);
  expect(detailBounds.scrollWidth).toBeLessThanOrEqual(detailBounds.clientWidth);
  await contextDetail.getByRole("button", { name: "预览", exact: true }).click();
  await expect(contextDetail.getByTestId("context-file-preview")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(520);

  await selectMobileSettingsSection(settings, page, "用量分析");
  await expect(settings.getByRole("heading", { name: "Pi JSONL 用量分析", exact: true })).toBeVisible();
  await expect(settings.getByRole("group", { name: "统计窗口" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "重建", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(520);

  await selectMobileSettingsSection(settings, page, "浏览器集成");
  await expect(settings.getByRole("button", { name: "安装浏览器扩展", exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "运行诊断", exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "安装浏览器扩展", exact: true }).click();
  const installer = page.getByRole("dialog", { name: "browser67 浏览器扩展连接" });
  await expect(installer).toBeVisible();
  await expect(installer.getByRole("button", { name: "打开 Chrome 扩展页", exact: true })).toBeVisible();
  const installerBounds = await installer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth
    };
  });
  expect(installerBounds.left).toBeGreaterThanOrEqual(0);
  expect(installerBounds.right).toBeLessThanOrEqual(520);
  expect(installerBounds.scrollWidth).toBeLessThanOrEqual(installerBounds.clientWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(520);
  await installer.getByRole("button", { name: "关闭", exact: true }).click();

  await selectMobileSettingsSection(settings, page, "更新与诊断");
  await expect.poll(async () => scrollRegion.evaluate((element) => element.scrollTop)).toBe(0);
  await page.getByRole("button", { name: "立即检查", exact: true }).click();
  const updateDialog = page.getByRole("dialog", { name: "Pi-67 更新" });
  await expect(updateDialog.getByText("发现 Pi-67 0.1.0-alpha.2", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (
    window as unknown as { __pi67UpdateTest: { checks: number } }
  ).__pi67UpdateTest.checks)).toBe(1);
  await updateDialog.getByRole("button", { name: "稍后处理", exact: true }).click();
  await expect(page.getByRole("button", { name: /^导出脱敏诊断/u })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "已打开的任务" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "显示对话导航" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "返回工作台" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(显示|隐藏)上下文/u })).toHaveCount(0);
  expect(await page.locator(".title-bar").evaluate((element) => ({
    columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
    brandDisplay: getComputedStyle(element.querySelector<HTMLElement>(".brand-lockup")!).display
  }))).toEqual({ columns: 1, brandDisplay: "flex" });
  expect(await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    height: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight
  }))).toEqual({ width: 520, scrollWidth: 520, height: 400, scrollHeight: 400 });
});

test("keeps local Settings workspaces inside a 1040 pixel application surface", async ({ page }) => {
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
  await installPackageFixture(page);
  await installUsageFixture(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.getByRole("button", { name: "帮助与设置" })).toBeVisible();
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  const navigation = settings.getByRole("navigation", { name: "设置分类" });
  await navigation.getByRole("button", { name: "模型", exact: true }).click();
  const scope = page.getByRole("group", { name: "设置作用域" });
  const providerList = settings.getByTestId("provider-configuration-list");
  const providerEditor = settings.getByTestId("provider-configuration-editor");
  const manageCredentials = page.getByRole("button", { name: /API Key/u });
  await expect(scope).toBeVisible();
  await expect(scope.getByRole("button", { name: "全局", exact: true })).toBeVisible();
  await expect(providerList).toBeVisible();
  await expect(providerEditor).toBeHidden();
  await providerList.getByRole("button").first().click();
  await expect(providerList).toBeHidden();
  await expect(providerEditor).toBeVisible();
  await expect(manageCredentials).toBeVisible();

  expect(await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }))).toEqual({ clientWidth: 1040, scrollWidth: 1040 });
  for (const locator of [manageCredentials]) {
    const bounds = await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(1040);
    expect(bounds.width).toBeGreaterThan(0);
  }

  await navigation.getByRole("button", { name: "扩展", exact: true }).click();
  const extensionList = settings.getByTestId("extension-package-list-scroll");
  const extensionDetail = settings.getByTestId("extension-package-detail-scroll");
  for (const locator of [
    settings.getByRole("button", { name: "检查更新", exact: true }),
    settings.getByRole("button", { name: "安装扩展包", exact: true })
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
  await expect(extensionList).toBeVisible();
  await expect(extensionDetail).toBeHidden();
  await extensionList.getByRole("button").first().click();
  await expect(extensionList).toBeHidden();
  await expect(extensionDetail).toBeVisible();
  await expect(settings.getByRole("button", { name: "返回扩展包列表" })).toBeVisible();
  await settings.getByRole("button", { name: "返回扩展包列表" }).click();
  await expect(extensionList).toBeVisible();
  await expect(extensionDetail).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1040);
});

test("keeps every Settings category on one centered document measure without side-by-side management panes", async ({ page }) => {
  await page.setViewportSize({ width: 1476, height: 908 });
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page);
  await installPackageFixture(page);
  await installUsageFixture(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await expect(page.getByRole("button", { name: "帮助与设置" })).toBeVisible();
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  const scrollRegion = settings.getByTestId("settings-scroll-region");
  const measureDocument = () => scrollRegion.evaluate((element) => {
    const body = element.firstElementChild as HTMLElement;
    const regionRect = element.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    return {
      bodyWidth: bodyRect.width,
      leftInset: bodyRect.left - regionRect.left,
      rightInset: regionRect.right - bodyRect.right
    };
  });
  const documentMetrics = await measureDocument();
  expect(documentMetrics.bodyWidth).toBeGreaterThan(840.5);
  expect(documentMetrics.bodyWidth).toBeLessThanOrEqual(1120.5);
  expect(Math.abs(documentMetrics.leftInset - documentMetrics.rightInset)).toBeLessThanOrEqual(1);

  const navigation = settings.getByRole("navigation", { name: "设置分类" });
  for (const category of ["提示词模板", "飞书", "用量分析", "浏览器集成", "运行服务", "更新与诊断", "关于"]) {
    await navigation.getByRole("button", { name: category, exact: true }).click();
    await expect(settings.getByRole("heading", { name: category, exact: true }).first()).toBeVisible();
    const next = await measureDocument();
    expect(Math.abs(next.bodyWidth - documentMetrics.bodyWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(next.leftInset - documentMetrics.leftInset)).toBeLessThanOrEqual(1);
    expect(Math.abs(next.rightInset - documentMetrics.rightInset)).toBeLessThanOrEqual(1);
  }

  await navigation.getByRole("button", { name: "模型", exact: true }).click();
  const standardWidth = (await measureDocument()).bodyWidth;
  expect(Math.abs(standardWidth - documentMetrics.bodyWidth)).toBeLessThanOrEqual(1);
  const providerList = settings.getByTestId("provider-configuration-list");
  const providerEditor = settings.getByTestId("provider-configuration-editor");
  await expect(providerList).toBeVisible();
  await expect(providerEditor).toBeHidden();
  await providerList.getByRole("button").first().click();
  await expect(providerList).toBeHidden();
  await expect(providerEditor).toBeVisible();

  const modelList = settings.getByTestId("provider-model-list");
  const modelDetail = settings.getByTestId("provider-model-detail");
  await expect(modelList).toBeVisible();
  await expect(modelDetail).toBeHidden();
  await modelList.getByTestId("provider-model-row").first().click();
  await expect(modelList).toBeHidden();
  await expect(modelDetail).toBeVisible();

  await navigation.getByRole("button", { name: "扩展", exact: true }).click();
  const extensionList = settings.getByTestId("extension-package-list-scroll");
  const extensionDetail = settings.getByTestId("extension-package-detail-scroll");
  await expect(extensionList).toBeVisible();
  await expect(extensionDetail).toBeHidden();
  await extensionList.getByRole("button").first().click();
  await expect(extensionList).toBeHidden();
  await expect(extensionDetail).toBeVisible();

  expect(await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }))).toEqual({ clientWidth: 1476, scrollWidth: 1476 });
});

async function installPackageFixture(page: Page): Promise<void> {
  await setMockAgentResponseResult(page, "extension.package.list", {
    items: [{
      source: "npm:pi-subagents",
      scope: "global",
      enabled: true,
      filtered: false,
      installed: true,
      trustState: "user-installed-observed",
      displayName: "pi-subagents",
      resourceTypes: ["extension"]
    }],
    total: 1
  });
}

async function installUsageFixture(page: Page): Promise<void> {
  await setMockAgentResponseResult(page, "workspace.usage.report", {
    workspaceId: DEFAULT_MOCK_WORKSPACE.id,
    generatedAt: 1_786_220_000_000,
    window: "30d",
    buckets: [],
    models: [],
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    coverage: {
      discoveredSessions: 0,
      scannedSessions: 0,
      skippedSessions: 0,
      unavailableSessions: 0,
      invalidSessions: 0,
      futureVersionSessions: 0,
      undatedUsageEntries: 0,
      complete: true
    }
  });
}

async function selectMobileSettingsSection(settings: Locator, page: Page, label: string) {
  await settings.getByRole("button", { name: "选择设置分类", exact: true }).click();
  await page.getByRole("menu", { name: "选择设置分类" })
    .getByRole("menuitem", { name: label, exact: true }).click();
}
