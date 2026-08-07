import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  attachMockAgent,
  clearRecordedCommands,
  installMockDesktopBridge,
  recordedCommandDetails,
  recordedCommands,
  setMockAgentResponseFailure
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
  await expect(extensionWorkspace.getByText("pi-rules-loader", { exact: true })).toBeHidden();

  await extensionTabs.getByRole("tab", { name: "内置扩展", exact: true }).click();
  await expect(extensionWorkspace.getByText("pi-rules-loader", { exact: true })).toBeVisible();
  await expect(extensionWorkspace.getByText("xtalpi-pi-tools", { exact: true })).toBeVisible();
  await expect(extensionWorkspace.getByText("随应用更新", { exact: false }).first()).toBeVisible();

  await extensionTabs.getByRole("tab", { name: "本地扩展", exact: true }).click();
  await settings.getByRole("button", { name: `项目 · ${DEFAULT_MOCK_WORKSPACE.displayName}`, exact: true }).click();
  await expect(settings.getByText(".pi/extensions/project-tools.ts", { exact: true })).toBeVisible();
  await expect(extensionWorkspace.getByText("pi-rules-loader", { exact: true })).toBeHidden();

  await navigation.getByRole("button", { name: "技能", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "技能", exact: true })).toBeVisible();
  const skillWorkspace = settings.getByTestId("skill-settings-workspace");
  const skillTabs = skillWorkspace.getByRole("tablist", { name: "技能可用范围" });
  await expect(skillTabs.getByRole("tab", { name: "全局可用", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  await expect(skillTabs.getByRole("tab")).toHaveCount(2);
  await expect(settings.getByRole("group", { name: "设置作用域" })).toHaveCount(0);
  const globalPanel = skillWorkspace.getByRole("tabpanel", { name: "全局可用", exact: true });
  await expect(globalPanel.getByRole("heading", { name: "内置技能套件", exact: true })).toBeVisible();
  await expect(skillWorkspace.getByRole("heading", { name: "受管技能套件", exact: true })).toHaveCount(0);
  await expect(skillWorkspace.getByRole("heading", { name: "本地全局技能", exact: true })).toBeVisible();
  await expect(globalPanel.getByTestId("bundled-skill-suite-row")).toHaveCount(5);
  await expect(globalPanel.getByText("飞书 Lark CLI", { exact: true })).toHaveCount(1);
  await expect(globalPanel.getByText("AI Berkshire 投资研究", { exact: true })).toHaveCount(1);
  await expect(globalPanel.getByText("Commerce Growth OS", { exact: true })).toBeVisible();
  await expect(globalPanel.getByText("2 个技能 · 基线未独立版本化", { exact: true })).toBeVisible();
  await expect(globalPanel.getByText("1 个技能 · 内置基线 1.0.1", { exact: true })).toBeVisible();
  await expect(globalPanel.getByText("1 个技能 · 内置基线 2.2.0", { exact: true })).toBeVisible();
  await expect(globalPanel.getByText("2 个技能 · 内置基线 0.4.0", { exact: true })).toBeVisible();
  await expect(globalPanel.getByText("2 个技能 · 2 个内置来源", { exact: true })).toBeVisible();
  await expect(globalPanel.getByText("design-craft", { exact: true })).toBeVisible();
  await expect(globalPanel.getByText("project-review", { exact: true })).toHaveCount(0);
  await expect(globalPanel.getByText("package-skill", { exact: true })).toHaveCount(0);

  await globalPanel.getByTestId("bundled-skill-suite-row")
    .filter({ hasText: "飞书 Lark CLI" }).click();
  const suiteDetail = globalPanel.getByTestId("bundled-skill-suite-detail");
  await expect(suiteDetail.getByRole("heading", { name: "飞书 Lark CLI", exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("lark-doc", { exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("lark-calendar", { exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("尚未检查", { exact: true })).toHaveCount(1);
  await expect(suiteDetail.getByText("未独立版本化", { exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("可独立管理", { exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("https://github.com/larksuite/cli", { exact: true })).toBeVisible();
  const suiteSearch = suiteDetail.getByRole("searchbox", { name: "搜索 飞书 Lark CLI 技能" });
  await suiteSearch.fill("calendar");
  await expect(suiteDetail.getByText("lark-calendar", { exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("lark-doc", { exact: true })).toHaveCount(0);
  await suiteDetail.getByRole("button", { name: "返回全局可用技能" }).click();
  await globalPanel.getByTestId("bundled-skill-suite-row")
    .filter({ hasText: "AI Berkshire 投资研究" }).click();
  await expect(suiteDetail.getByRole("heading", { name: "AI Berkshire 投资研究", exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("1.0.1", { exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("可独立管理", { exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("https://github.com/xbtlin/ai-berkshire", { exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("66e556262", { exact: true })).toBeVisible();
  await suiteDetail.getByRole("button", { name: "返回全局可用技能" }).click();

  await expect(skillWorkspace.getByTestId("managed-skill-pack-row")).toHaveCount(0);
  await globalPanel.getByRole("button", { name: "检查技能更新", exact: true }).first().click();
  const larkSuiteRow = globalPanel.getByTestId("bundled-skill-suite-row")
    .filter({ hasText: "飞书 Lark CLI" });
  await expect(larkSuiteRow).toContainText("当前 CLI 1.0.65");
  await larkSuiteRow.click();
  await expect(suiteDetail.getByText("当前 CLI", { exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("官方 Skills", { exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("最新稳定版本", { exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("Lark CLI 官方 Skills · 1.0.80", { exact: true })).toHaveCount(2);
  await expect(suiteDetail.getByText("Pi-67 Core · 1.0.65", { exact: true })).toHaveCount(0);
  await suiteDetail.getByRole("button", { name: "返回全局可用技能" }).click();
  const aiSuiteRow = globalPanel.getByTestId("bundled-skill-suite-row")
    .filter({ hasText: "AI Berkshire 投资研究" });
  await expect(aiSuiteRow).toContainText("可更新");
  await aiSuiteRow.click();
  await suiteDetail.getByRole("button", { name: "更新套件", exact: true }).click();
  const skillUpdateDialog = page.getByRole("dialog", { name: "更新技能套件" });
  await expect(skillUpdateDialog).toContainText("1.0.1");
  await expect(skillUpdateDialog).toContainText("1.0.2");
  await skillUpdateDialog.getByRole("button", { name: "确认更新", exact: true }).click();
  await expect(suiteDetail.getByText("1.0.2 · Overlay", { exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("已是最新", { exact: true })).toBeVisible();
  await expect(suiteDetail.getByText("1 个技能 · 当前 1.0.2 · 最新兼容 1.0.2", { exact: true })).toBeVisible();
  await suiteDetail.getByRole("button", { name: "恢复内置版本", exact: true }).click();
  const restoreDialog = page.getByRole("dialog", { name: "恢复内置技能套件" });
  await expect(restoreDialog).toContainText("恢复会移除受管 Overlay");
  await restoreDialog.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(suiteDetail.getByText("1.0.1 · 内置", { exact: true })).toBeVisible();
  await suiteDetail.getByRole("button", { name: "返回全局可用技能" }).click();

  await skillTabs.getByRole("tab", { name: "项目专属", exact: true }).click();
  await expect(skillWorkspace.getByRole("tabpanel").getByText("project-review", { exact: true })).toBeVisible();
  await expect(skillWorkspace.getByRole("tabpanel").getByText("design-craft", { exact: true })).toHaveCount(0);
  await expect(skillWorkspace.getByRole("tabpanel").getByText("package-skill", { exact: true })).toHaveCount(0);

  await navigation.getByRole("button", { name: "指令模板", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "指令模板", exact: true })).toBeVisible();
  await expect(settings.getByText("/review", { exact: true })).toBeVisible();
  await expect(settings.getByText("Pi-67 Core", { exact: true })).toHaveCount(0);

  await navigation.getByRole("button", { name: "规则与上下文", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "规则与上下文", exact: true })).toBeVisible();
  const ruleWorkspace = settings.getByTestId("rule-settings-workspace");
  const ruleTabs = ruleWorkspace.getByRole("tablist", { name: "规则与上下文可用范围" });
  await expect(ruleTabs.getByRole("tab", { name: "全局可用", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  const globalRuleCategories = ruleWorkspace.getByRole("group", { name: "全局规则与上下文分类" });
  const globalRulesCategory = globalRuleCategories.getByRole("button", { name: "全局规则", exact: true });
  const managedRulesCategory = globalRuleCategories.getByRole("button", { name: "桌面托管", exact: true });
  const globalSystemCategory = globalRuleCategories.getByRole("button", { name: "系统提示词", exact: true });
  await expect(globalRulesCategory).toHaveAttribute("aria-pressed", "true");
  await expect(globalRulesCategory).toContainText("1");
  await expect(managedRulesCategory).toContainText("11");
  await expect(globalSystemCategory).toContainText("2");
  await expect(ruleWorkspace.getByRole("heading", { name: "全局规则与上下文", exact: true })).toBeVisible();
  await expect(ruleWorkspace.getByRole("heading", { name: "桌面托管规则", exact: true })).toHaveCount(0);
  await globalRuleCategories.getByRole("button", { name: "桌面托管", exact: true }).click();
  await expect(ruleWorkspace.getByRole("list", { name: "桌面托管规则" }).getByRole("listitem"))
    .toHaveCount(11);
  await expect(ruleWorkspace.getByRole("heading", { name: "全局规则与上下文", exact: true })).toHaveCount(0);
  await globalRuleCategories.getByRole("button", { name: "系统提示词", exact: true }).click();
  await expect(ruleWorkspace.getByRole("heading", { name: "全局系统提示词", exact: true })).toBeVisible();
  await ruleTabs.getByRole("tab", { name: "项目专属", exact: true }).click();
  const projectRuleCategories = ruleWorkspace.getByRole("group", { name: "项目规则与上下文分类" });
  const projectRulesCategory = projectRuleCategories.getByRole("button", { name: "项目规则", exact: true });
  const inheritedRulesCategory = projectRuleCategories.getByRole("button", { name: "继承规则", exact: true });
  await expect(projectRulesCategory).toHaveAttribute("aria-pressed", "true");
  await expect(projectRulesCategory).toContainText("1");
  await expect(inheritedRulesCategory).toContainText("2");
  await expect(ruleWorkspace.getByRole("heading", { name: "项目规则与上下文", exact: true })).toBeVisible();
  await expect(ruleWorkspace.getByText("/Users/test/Projects/pi-demo/AGENTS.md", { exact: true })).toBeVisible();
  await expect(ruleWorkspace.getByRole("heading", { name: "继承的规则与上下文", exact: true })).toHaveCount(0);
  await projectRuleCategories.getByRole("button", { name: "继承规则", exact: true }).click();
  await expect(ruleWorkspace.getByRole("heading", { name: "继承的规则与上下文", exact: true })).toBeVisible();
  await expect(ruleWorkspace.getByText("/Users/test/Projects/AGENTS.md", { exact: true })).toBeVisible();
  await projectRuleCategories.getByRole("button", { name: "系统提示词", exact: true }).click();
  await expect(ruleWorkspace.getByRole("heading", { name: "项目系统提示词", exact: true })).toBeVisible();
  await ruleTabs.getByRole("tab", { name: "全局可用", exact: true }).click();
  await expect(globalSystemCategory).toHaveAttribute("aria-pressed", "true");
  await ruleTabs.getByRole("tab", { name: "项目专属", exact: true }).click();
  await expect(projectRuleCategories.getByRole("button", { name: "系统提示词", exact: true }))
    .toHaveAttribute("aria-pressed", "true");

  await navigation.getByRole("button", { name: "下载源与网络", exact: true }).click();
  for (const version of ["24.18.0", "12.0.1", "2.53.0"]) {
    await expect(settings.getByText(version, { exact: true })).toBeVisible();
  }
  await expect(settings.getByText("https://registry.npmmirror.com", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "检测全部源", exact: true }).click();
  await expect(settings.getByText("36 ms", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
});

test("separates MCP services from browser integrations", async ({ page }, testInfo) => {
  const visualArtifactDirectory = process.env.PI67_VISUAL_ARTIFACT_DIR;
  if (visualArtifactDirectory) await mkdir(visualArtifactDirectory, { recursive: true });
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  const navigation = settings.getByRole("navigation", { name: "设置分类" });
  await navigation.getByRole("button", { name: "MCP 服务", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "MCP 服务", exact: true })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Tavily Bridge", exact: true })).toBeVisible();
  await expect(settings.getByRole("textbox", { name: "Tavily Bridge Client Token" })).toBeVisible();
  await expect(settings.getByText("凭据状态", { exact: true })).toBeVisible();
  await expect(settings.getByText("设置页未验证连接", { exact: true })).toBeVisible();
  await expect(settings.getByText("已连接", { exact: true })).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "安装浏览器扩展", exact: true })).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "运行诊断", exact: true })).toHaveCount(0);
  const mcpScreenshotPath = visualArtifactDirectory
    ? resolve(visualArtifactDirectory, "settings-mcp-services.png")
    : testInfo.outputPath("settings-mcp-services.png");
  await page.screenshot({ path: mcpScreenshotPath, animations: "disabled" });
  await testInfo.attach("settings-mcp-services", { path: mcpScreenshotPath, contentType: "image/png" });

  const clientToken = "mcp_testbridge.0123456789abcdef0123456789abcdef";
  await settings.getByRole("textbox", { name: "Tavily Bridge Client Token" }).fill(clientToken);
  await settings.getByRole("button", { name: "保存", exact: true }).click();
  await expect(settings.getByText("已保存 Client Token，并重启了 Pi 运行服务以加载新凭据。", { exact: true }))
    .toBeVisible();
  await settings.getByRole("button", { name: "显示完整 Token" }).click();
  await expect(settings.getByText(clientToken, { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "隐藏完整 Token" }).click();
  await settings.getByRole("button", { name: "清除", exact: true }).click();
  const clearDialog = page.getByRole("dialog", { name: "清除 MCP Client Token？" });
  await expect(clearDialog).toContainText("Pi-67 userData");
  expect(await settingsActionCount(page, "mcpClears")).toBe(0);
  await clearDialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(await settingsActionCount(page, "mcpClears")).toBe(0);
  await settings.getByRole("button", { name: "清除", exact: true }).click();
  await clearDialog.getByRole("button", { name: "清除 Client Token", exact: true }).click();
  expect(await settingsActionCount(page, "mcpClears")).toBe(1);
  await expect(settings.getByText("已清除本机 Token，并重启了 Pi 运行服务。在重新配置前，自建 Tavily 中转搜索将不可用。", { exact: true }))
    .toBeVisible();

  await navigation.getByRole("button", { name: "浏览器集成", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "浏览器集成", exact: true })).toBeVisible();
  await expect(settings.getByText("内置第一方", { exact: true })).toBeVisible();
  await expect(settings.getByText("尚未检查", { exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "安装浏览器扩展", exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "运行诊断", exact: true })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Tavily Bridge", exact: true })).toHaveCount(0);
  await expect(settings.getByRole("textbox", { name: "Tavily Bridge Client Token" })).toHaveCount(0);
  await settings.getByRole("button", { name: "安装浏览器扩展", exact: true }).click();
  const installer = page.getByRole("dialog", { name: "安装 browser67 浏览器扩展" });
  await expect(installer).toBeVisible();
  await expect(settings.getByText("待浏览器加载", { exact: true })).toBeVisible();
  for (const action of [
    "打开 Chrome 扩展页",
    "打开 Edge 扩展页",
    "在系统中显示目录",
    "复制扩展目录"
  ]) {
    await expect(installer.getByRole("button", { name: action, exact: true })).toBeVisible();
  }
  await installer.getByRole("button", { name: "启动连接并验证", exact: true }).click();
  await expect(installer.getByText("已安装并连接", { exact: true })).toBeVisible();
  await expect(settings.getByText("已安装并连接", { exact: true }).first()).toBeVisible();
  const browserScreenshotPath = visualArtifactDirectory
    ? resolve(visualArtifactDirectory, "settings-browser-integration.png")
    : testInfo.outputPath("settings-browser-integration.png");
  await page.screenshot({ path: browserScreenshotPath, animations: "disabled" });
  await testInfo.attach("settings-browser-integration", {
    path: browserScreenshotPath,
    contentType: "image/png"
  });
  await installer.getByRole("button", { name: "完成", exact: true }).click();
});

test("opens, previews, edits, creates, and conflict-checks Context Markdown files", async ({ page }) => {
  const remoteImageRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("example.invalid/context-rule.png")) remoteImageRequests.push(request.url());
  });
  await installMockDesktopBridge(page);
  await page.goto("/");
  await attachMockAgent(page);
  await page.getByRole("button", { name: "选择工作区" }).click();
  await page.keyboard.press("Control+,");

  const settings = page.getByLabel("π 设置");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "规则与上下文", exact: true }).click();
  const workspace = settings.getByTestId("rule-settings-workspace");
  const tabs = workspace.getByRole("tablist", { name: "规则与上下文可用范围" });
  const globalCategories = workspace.getByRole("group", { name: "全局规则与上下文分类" });
  await expect.poll(() => recordedCommands(page)).toContain("context.file.list");
  await globalCategories.getByRole("button", { name: "桌面托管", exact: true }).click();
  const managedCatalog = workspace.getByRole("list", { name: "桌面托管规则" });
  await expect(managedCatalog.getByRole("listitem")).toHaveCount(11);

  await managedCatalog.getByRole("button", { name: /00-product\.md/u }).click();
  const detail = workspace.getByTestId("context-file-detail");
  await expect(detail.getByRole("heading", { name: "00-product.md", exact: true })).toBeVisible();
  const managedSource = detail.getByRole("textbox", { name: "00-product.md Markdown 源码" });
  await expect(managedSource).toHaveAttribute("readonly", "");
  await detail.getByRole("button", { name: "预览", exact: true }).click();
  await expect(detail.getByTestId("context-file-preview").getByRole("img", { name: "远程示例" }))
    .toContainText("图片：远程示例");
  expect(remoteImageRequests).toEqual([]);
  await detail.getByRole("button", { name: "返回规则目录" }).click();
  await expect(globalCategories.getByRole("button", { name: "桌面托管", exact: true }))
    .toHaveAttribute("aria-pressed", "true");

  await globalCategories.getByRole("button", { name: "全局规则", exact: true }).click();
  const globalCatalog = workspace.getByRole("list", { name: "全局规则与上下文" });
  await globalCatalog.getByRole("button", { name: /AGENTS\.md/u }).click();
  const globalSource = detail.getByRole("textbox", { name: "AGENTS.md Markdown 源码" });
  const privateMarker = "context-private-e2e-marker";
  await globalSource.fill(`# Global rules\n\n${privateMarker}\n`);
  await globalCategories.getByRole("button", { name: "桌面托管", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "放弃未保存的修改" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(globalCategories.getByRole("button", { name: "全局规则", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await tabs.getByRole("tab", { name: "项目专属", exact: true }).click();
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(tabs.getByRole("tab", { name: "全局可用", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "MCP 服务", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "放弃未保存的修改" })).toHaveCount(1);
  await discard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await settings.getByRole("button", { name: "返回工作台", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "放弃未保存的修改" })).toHaveCount(1);
  await discard.getByRole("button", { name: "继续编辑", exact: true }).click();

  await clearRecordedCommands(page);
  await detail.getByRole("button", { name: "保存并重新加载", exact: true }).click();
  await expect(page.getByText("AGENTS.md 已保存", { exact: true })).toBeVisible();
  const saveCommand = (await recordedCommandDetails(page)).find((command) => (
    command.type === "context.file.save"
  ));
  expect(saveCommand).toBeDefined();
  expect(saveCommand?.payload).toMatchObject({
    expectedRevision: expect.stringMatching(/^[a-f0-9]{64}$/u),
    content: {
      byteLength: expect.any(Number),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u)
    }
  });
  expect(saveCommand?.payload).not.toHaveProperty("path");
  expect(JSON.stringify(saveCommand)).not.toContain(privateMarker);

  await detail.getByRole("button", { name: "返回规则目录" }).click();
  await globalCategories.getByRole("button", { name: "系统提示词", exact: true }).click();
  const systemCatalog = workspace.getByRole("list", { name: "全局系统提示词" });
  await systemCatalog.getByRole("button", { name: /SYSTEM\.md/u }).first().click();
  const systemSource = detail.getByRole("textbox", { name: "SYSTEM.md Markdown 源码" });
  await expect(systemSource).toHaveValue("");
  await systemSource.fill("# Desktop system prompt\n");
  await detail.getByRole("button", { name: "保存并重新加载", exact: true }).click();
  await expect(detail.getByText("可编辑", { exact: true })).toBeVisible();

  await detail.getByRole("button", { name: "返回规则目录" }).click();
  await tabs.getByRole("tab", { name: "项目专属", exact: true }).click();
  await workspace.getByRole("list", { name: "项目规则与上下文" })
    .getByRole("button", { name: /AGENTS\.md/u }).click();
  const projectSource = detail.getByRole("textbox", { name: "AGENTS.md Markdown 源码" });
  await projectSource.fill("# Project conflict draft\n");
  await setMockAgentResponseFailure(page, "context.file.save", {
    code: "RESOURCE_CHANGED_EXTERNALLY",
    message: "The context file changed outside Desktop.",
    recoverable: true
  });
  await detail.getByRole("button", { name: "保存并重新加载", exact: true }).click();
  await expect(detail.getByTestId("context-file-conflict")).toContainText("当前草稿仍被保留");
  await expect(projectSource).toHaveValue("# Project conflict draft\n");
  await detail.getByRole("button", { name: "重新读取最新文件", exact: true }).click();
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "放弃修改并离开", exact: true }).click();
  await expect(projectSource).toHaveValue("# Project rules\n\nKeep project behavior explicit.\n");
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
  const coreExtensionRow = settings.getByText("pi-rules-loader", { exact: true }).locator("..").locator("..");
  await expect(coreExtensionRow).toContainText("已提供");
  await expect(coreExtensionRow).not.toContainText("准备中");
});

async function settingsActionCount(page: import("@playwright/test").Page, key: "mcpClears" | "packageResets") {
  return page.evaluate((actionKey) => {
    const state = (window as typeof window & {
      __pi67SettingsTest: Record<string, number>;
    }).__pi67SettingsTest;
    return state[actionKey] ?? 0;
  }, key);
}

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
  await workspace.getByRole("tab", { name: "项目专属", exact: true }).click();
  await expect(workspace.getByText("当前项目尚未受信任", { exact: false })).toBeVisible();
  await expect(workspace.getByText("project-review", { exact: true })).toHaveCount(0);
});
