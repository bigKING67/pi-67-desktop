import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  installMockDesktopBridge
} from "./pi67-renderer-fixture.js";
import { DEFAULT_MOCK_WORKSPACE } from "./pi67-renderer-desktop-bridge.js";

test("separates extension packages, extensions, skills, prompt templates, and context rules", async ({ page }) => {
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  const navigation = settings.getByRole("navigation", { name: "设置分类" });

  await navigation.getByRole("button", { name: "扩展", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "扩展", exact: true })).toBeVisible();
  const extensionWorkspace = settings.getByTestId("extension-settings-workspace");
  const extensionTabs = extensionWorkspace.getByRole("tablist", { name: "扩展管理分类" });
  await expect(extensionTabs.getByRole("tab", { name: "扩展包", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(extensionWorkspace.getByText("pi-hy-memory", { exact: true })).toBeHidden();

  await extensionTabs.getByRole("tab", { name: "内置扩展", exact: true }).click();
  await expect(extensionWorkspace.getByText("pi-hy-memory", { exact: true })).toBeVisible();
  await expect(extensionWorkspace.getByText("xtalpi-pi-tools", { exact: true })).toBeVisible();
  await expect(extensionWorkspace.getByText("随应用更新", { exact: false }).first()).toBeVisible();

  await extensionTabs.getByRole("tab", { name: "本地扩展", exact: true }).click();
  await settings.getByRole("button", { name: `项目 · ${DEFAULT_MOCK_WORKSPACE.displayName}`, exact: true }).click();
  await expect(settings.getByText(".pi/extensions/project-tools.ts", { exact: true })).toBeVisible();
  await expect(extensionWorkspace.getByText("pi-hy-memory", { exact: true })).toBeHidden();

  await navigation.getByRole("button", { name: "技能", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "技能", exact: true })).toBeVisible();
  const skillWorkspace = settings.getByTestId("skill-settings-workspace");
  const skillTabs = skillWorkspace.getByRole("tablist", { name: "技能来源分类" });
  await expect(skillTabs.getByRole("tab", { name: "全局技能", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  await expect(settings.getByRole("group", { name: "设置作用域" })).toHaveCount(0);
  await expect(skillWorkspace.getByRole("tabpanel").getByText("design-craft", { exact: true })).toBeVisible();
  await expect(skillWorkspace.getByRole("tabpanel").getByText("project-review", { exact: true })).toHaveCount(0);
  await expect(skillWorkspace.getByRole("tabpanel").getByText("package-skill", { exact: true })).toHaveCount(0);

  await skillTabs.getByRole("tab", { name: "项目技能", exact: true }).click();
  await expect(skillWorkspace.getByRole("tabpanel").getByText("project-review", { exact: true })).toBeVisible();
  await expect(skillWorkspace.getByRole("tabpanel").getByText("design-craft", { exact: true })).toHaveCount(0);
  await expect(skillWorkspace.getByRole("tabpanel").getByText("package-skill", { exact: true })).toHaveCount(0);

  await skillTabs.getByRole("tab", { name: "内置技能", exact: true }).click();
  const bundledPanel = skillWorkspace.getByRole("tabpanel");
  await expect(bundledPanel.getByRole("heading", { name: "内置技能套件", exact: true })).toBeVisible();
  await expect(bundledPanel.getByTestId("bundled-skill-suite-row")).toHaveCount(5);
  await expect(bundledPanel.getByText("飞书 Lark CLI", { exact: true })).toBeVisible();
  await expect(bundledPanel.getByText("Commerce Growth OS", { exact: true })).toBeVisible();
  await expect(bundledPanel.getByText("design-craft", { exact: true })).toHaveCount(0);
  await expect(bundledPanel.getByText("package-skill", { exact: true })).toHaveCount(0);

  await bundledPanel.getByTestId("bundled-skill-suite-row")
    .filter({ hasText: "飞书 Lark CLI" }).click();
  const suiteDetail = bundledPanel.getByTestId("bundled-skill-suite-detail");
  await expect(suiteDetail.getByRole("heading", { name: "飞书 Lark CLI", exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("lark-doc", { exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("lark-calendar", { exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("已提供", { exact: true })).toHaveCount(1);
  const suiteSearch = suiteDetail.getByRole("searchbox", { name: "搜索 飞书 Lark CLI 技能" });
  await suiteSearch.fill("calendar");
  await expect(suiteDetail.getByText("lark-calendar", { exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("lark-doc", { exact: true })).toHaveCount(0);
  await suiteDetail.getByRole("button", { name: "返回内置技能套件" }).click();
  await expect(bundledPanel.getByText("设计与输出工具", { exact: true })).toBeVisible();

  await navigation.getByRole("button", { name: "指令模板", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "指令模板", exact: true })).toBeVisible();
  await expect(settings.getByText("/review", { exact: true })).toBeVisible();
  await expect(settings.getByText("Pi-67 Core", { exact: true })).toHaveCount(0);

  await navigation.getByRole("button", { name: "规则与上下文", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "规则与上下文", exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "全局", exact: true }).click();
  await expect(settings.getByText("全局 AGENTS.md", { exact: true }).first()).toBeVisible();
  await expect(settings.getByText("由用户管理", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: `项目 · ${DEFAULT_MOCK_WORKSPACE.displayName}`, exact: true }).click();
  await expect(settings.getByText("/Users/test/Projects/pi-demo/AGENTS.md", { exact: true })).toBeVisible();
  await expect(settings.getByText("继承自全局", { exact: false })).toBeVisible();

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
    .getByRole("button", { name: "扩展", exact: true }).click();
  await settings.getByRole("tab", { name: "内置扩展", exact: true }).click();
  const coreExtensionRow = settings.getByText("pi-hy-memory", { exact: true }).locator("..").locator("..");
  await expect(coreExtensionRow).toContainText("已提供");
  await expect(coreExtensionRow).not.toContainText("准备中");
});

test("explains why project skills are unavailable for an untrusted workspace", async ({ page }) => {
  await installMockDesktopBridge(page, {
    pickerQueue: [{
      ...DEFAULT_MOCK_WORKSPACE,
      trust: "untrusted",
      trustProvenance: "user-confirmed"
    }]
  });
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "技能", exact: true }).click();
  const workspace = settings.getByTestId("skill-settings-workspace");
  await workspace.getByRole("tab", { name: "项目技能", exact: true }).click();
  await expect(workspace.getByText("当前项目尚未受信任", { exact: false })).toBeVisible();
  await expect(workspace.getByText("project-review", { exact: true })).toHaveCount(0);
});
