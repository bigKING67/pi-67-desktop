import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  isProcessAlive,
  writeControlledShutdownExtension
} from "./controlled-shutdown-fixture.ts";
import {
  assertPackagedRuntimeAssets,
  cleanupPackagedTestDirectories,
  createPackagedTestDirectories,
  installWorkspaceDialogResult,
  launchPackagedApplication,
  resolvePackagedArtifact
} from "./packaged-electron-fixture.mjs";
import {
  captureProcessOutput,
  inspectRendererSurface,
  openSettingsSection,
  runControlledShutdownScenario,
  verifyColdProviderRestoration,
  verifyInitialRuntimeSettings
} from "./packaged-electron-smoke-scenarios.mjs";
import { createPackagedVisualEvidence } from "./packaged-electron-visual-evidence.mjs";
import { assertPackagedSkillSuites } from "./smoke-packaged-skill-suites.mjs";

const artifact = resolvePackagedArtifact();
await assertPackagedRuntimeAssets(artifact);
const packagedScreenshotDirectory = process.env.PI67_PACKAGED_SCREENSHOT_DIR?.trim() || undefined;
if (packagedScreenshotDirectory) await mkdir(packagedScreenshotDirectory, { recursive: true });
const {
  capturePackagedScreenshot,
  capturePackagedWorkbenchVisualEvidence
} = createPackagedVisualEvidence(packagedScreenshotDirectory);
const {
  agentDir,
  extensionsDirectory,
  userDataDirectory,
  workspace
} = await createPackagedTestDirectories("pi67-packaged-smoke-");
const childPidPath = join(userDataDirectory, "child.pid");
const lifecyclePath = join(userDataDirectory, "lifecycle.txt");
const packagedCredential = "pi67-packaged-reveal-fixture";
const localizedExtensionDirectory = join(agentDir, "npm/node_modules/pi-subagents");
const packagedSkillDirectory = join(agentDir, "skills/packaged-skill");
const packagedPromptDirectory = join(agentDir, "prompts");
await Promise.all([
  mkdir(localizedExtensionDirectory, { recursive: true }),
  mkdir(packagedSkillDirectory, { recursive: true }),
  mkdir(packagedPromptDirectory, { recursive: true })
]);
await Promise.all([
  writeFile(join(agentDir, "settings.json"), `${JSON.stringify({
    packages: ["npm:pi-subagents"]
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }),
  writeFile(join(localizedExtensionDirectory, "package.json"), `${JSON.stringify({
    name: "pi-subagents",
    version: "0.35.1",
    description: "Pi extension for delegating tasks to subagents with chains, parallel execution, and TUI clarification",
    type: "module",
    pi: { extensions: ["index.js"] }
  }, null, 2)}\n`, "utf8"),
  writeFile(join(localizedExtensionDirectory, "index.js"), "export default function packagedLocalizationFixture() {}\n", "utf8"),
  writeFile(join(packagedSkillDirectory, "SKILL.md"), [
    "---",
    "name: packaged-skill",
    "description: Validates the packaged Skill resource projection.",
    "---",
    "",
    "# Packaged Skill",
    ""
  ].join("\n"), "utf8"),
  writeFile(join(packagedPromptDirectory, "packaged-review.md"), [
    "---",
    "description: Validates the packaged prompt-template resource projection.",
    "---",
    "",
    "Review the packaged Settings resource projection.",
    ""
  ].join("\n"), "utf8"),
  writeFile(join(agentDir, "AGENTS.md"), "Packaged global context fixture.\n", "utf8"),
  writeFile(join(workspace, "AGENTS.md"), "Packaged project context fixture.\n", "utf8")
]);
await writeFile(join(agentDir, "auth.json"), `${JSON.stringify({
  anthropic: { type: "api_key", key: packagedCredential }
}, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
await writeControlledShutdownExtension({
  extensionPath: join(extensionsDirectory, "shutdown-fixture.ts"),
  childPidPath,
  lifecyclePath
});
let application;
let childPid;
const shutdownState = { childPid: undefined };
let packagedProcessOutput = () => "";

try {
  application = await launchPackagedApplication({
    agentDir,
    artifact,
    userDataDirectory
  });
  packagedProcessOutput = captureProcessOutput(application.process());
  let window = await application.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.getByRole("button", { name: "选择工作区" }).waitFor({ state: "visible", timeout: 15_000 });
  if (!(await window.getByRole("button", { name: "选择工作区" }).isEnabled())) {
    throw new Error("Packaged workspace action is unavailable before Agent Host demand.");
  }
  await window.getByLabel("当前状态：等待选择工作区").waitFor({ state: "visible", timeout: 15_000 });
  await capturePackagedScreenshot(window, "00-welcome-system.png");
  await window.evaluate(() => window.pi67.system.connectAgentHost());
  await verifyInitialRuntimeSettings(window, packagedProcessOutput);
  await installWorkspaceDialogResult(application, workspace);
  await window.getByRole("button", { name: "选择工作区" }).click();
  await window.getByLabel("当前状态：Pi SDK 已就绪").waitFor({ state: "visible", timeout: 30_000 });
  await window.getByRole("list", { name: "工作区与会话" }).waitFor({ state: "visible", timeout: 30_000 });
  const initialConversationRows = window.locator('[data-testid="conversation-row"]');
  await initialConversationRows.first().waitFor({ state: "visible", timeout: 30_000 });
  if ((await initialConversationRows.count()) !== 1) {
    throw new Error(`Expected one initial packaged conversation row, received ${await initialConversationRows.count()}.`);
  }
  if (await window.getByText("无法打开工作区", { exact: true }).count()) {
    throw new Error(`Packaged workspace open reported a failure: ${JSON.stringify(await inspectRendererSurface(window))}`);
  }
  const workspaceSettings = await openSettingsSection(window, /^运行服务/u);
  await workspaceSettings.getByRole("button", { name: /运行环境诊断/u }).click();
  const doctorDialog = window.getByRole("dialog", { name: "运行环境诊断" });
  const sessionCatalogCheck = doctorDialog.getByLabel("运行环境检查结果")
    .locator(".doctor-check").filter({ hasText: "Session 目录" });
  await doctorDialog.getByRole("button", { name: /重新运行检查/u }).click();
  await sessionCatalogCheck.getByText("通过", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await sessionCatalogCheck.getByText(/schema v1; ready/u).waitFor({ state: "visible", timeout: 30_000 });
  await doctorDialog.getByRole("button", { name: "关闭" }).click();
  await workspaceSettings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^模型服务/u }).click();
  const providerPanel = workspaceSettings.getByTestId("provider-configuration-panel");
  const configurationProviderSearch = providerPanel.getByRole("textbox", { name: "搜索 Pi Provider" });
  const configurationProviderList = providerPanel.getByTestId("provider-configuration-list");
  const configurationProviderEditor = providerPanel.getByTestId("provider-configuration-editor");
  await configurationProviderSearch.waitFor({ state: "visible", timeout: 15_000 });
  await configurationProviderList.waitFor({ state: "visible", timeout: 15_000 });
  if (await configurationProviderEditor.isVisible()) {
    throw new Error("Packaged Provider editor must not share the Provider Catalog surface.");
  }
  await assertNoWorkspaceChangesAuthorityWarning(window);
  const providerCatalogTabs = providerPanel.getByRole("tablist", { name: "模型服务分类" });
  const availableProvidersTab = providerCatalogTabs.getByRole("tab", { name: /^可配置 \d+$/u });
  await availableProvidersTab.click();
  if ((await availableProvidersTab.getAttribute("aria-selected")) !== "true") {
    throw new Error("Packaged Provider Catalog did not switch to the configurable task view.");
  }
  await capturePackagedScreenshot(window, "01-provider-catalog.png");
  const settingsScrollRegion = workspaceSettings.getByTestId("settings-scroll-region");
  const [providerListLayout, settingsScrollLayout] = await Promise.all([
    configurationProviderList.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight
    })),
    settingsScrollRegion.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight
    }))
  ]);
  if (
    providerListLayout.overflowY !== "visible"
    || settingsScrollLayout.overflowY !== "auto"
    || settingsScrollLayout.scrollHeight <= settingsScrollLayout.clientHeight
  ) {
    throw new Error(`Packaged Provider Catalog did not use the shared Settings scroll: ${JSON.stringify({
      providerList: providerListLayout,
      settings: settingsScrollLayout
    })}`);
  }
  const configuredProvidersTab = providerCatalogTabs.getByRole("tab", { name: /^已配置 \d+$/u });
  await configuredProvidersTab.click();
  await configurationProviderSearch.fill("anthropic");
  const packagedProviderRow = configurationProviderList.getByRole("button", { name: /^Anthropic\b/u });
  await packagedProviderRow.waitFor({ state: "visible", timeout: 15_000 });
  await packagedProviderRow.click();
  await configurationProviderEditor.waitFor({ state: "visible", timeout: 15_000 });
  await configurationProviderList.waitFor({ state: "hidden", timeout: 15_000 });
  const providerSectionTabs = providerPanel.getByRole("tablist", { name: "Provider 设置分区" });
  const providerModelTab = providerSectionTabs.getByRole("tab", { name: /^模型 \d+$/u });
  await providerModelTab.waitFor({ state: "visible", timeout: 15_000 });
  if ((await providerModelTab.getAttribute("aria-selected")) !== "true") {
    throw new Error("Packaged Provider workbench did not open on the model catalog.");
  }
  const providerModelList = providerPanel.getByTestId("provider-model-list");
  await providerModelList.waitFor({ state: "visible", timeout: 15_000 });
  const packagedModelRows = providerModelList.getByTestId("provider-model-row");
  await packagedModelRows.first().waitFor({ state: "visible", timeout: 15_000 });
  if ((await packagedModelRows.count()) < 1) {
    throw new Error("Packaged Provider workbench rendered an empty model catalog.");
  }
  const packagedModelDetail = providerPanel.getByTestId("provider-model-detail");
  if (await packagedModelDetail.isVisible()) {
    throw new Error("Packaged model detail must not share the model Catalog surface.");
  }
  if ((await providerPanel.getByLabel("Model ID").count()) !== 0) {
    throw new Error("Packaged model Catalog mounted a detail editor before selection.");
  }
  await capturePackagedScreenshot(window, "02-model-catalog.png");
  await packagedModelRows.first().click();
  await packagedModelDetail.waitFor({ state: "visible", timeout: 15_000 });
  await providerModelList.waitFor({ state: "hidden", timeout: 15_000 });
  if ((await providerPanel.getByLabel("Model ID").count()) !== 1) {
    throw new Error("Packaged model detail did not render exactly one editor.");
  }
  await capturePackagedScreenshot(window, "03-model-detail.png");
  await providerPanel.getByRole("button", { name: "返回模型列表" }).click();
  await providerModelList.waitFor({ state: "visible", timeout: 15_000 });
  await workspaceSettings.getByRole("button", { name: "管理凭据", exact: true }).click();
  const credentialDialog = window.getByRole("dialog", { name: "Provider 与凭据" });
  await credentialDialog.waitFor({ state: "visible", timeout: 15_000 });
  const credentialProviderSearch = credentialDialog.getByRole("textbox", { name: "搜索 Provider" });
  await credentialProviderSearch.fill("anthropic");
  await credentialDialog.getByRole("button", { name: /^Anthropic\b/u }).click();
  await credentialDialog.getByText("已持久化到 Pi auth.json", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await credentialDialog.getByRole("button", { name: "临时显示已保存 API Key" }).click();
  await credentialDialog.getByText(packagedCredential, { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await credentialDialog.getByRole("button", { name: "隐藏已保存 API Key" }).click();
  if (await credentialDialog.getByText(packagedCredential, { exact: true }).count()) {
    throw new Error("Packaged credential reveal remained mounted after the user hid it.");
  }
  await credentialDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await workspaceSettings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "扩展", exact: true }).click();
  const extensionWorkspace = workspaceSettings.getByTestId("extension-management-workspace");
  const extensionList = extensionWorkspace.getByTestId("extension-package-list-scroll");
  const extensionDetail = extensionWorkspace.getByTestId("extension-package-detail-scroll");
  await extensionList.waitFor({ state: "visible", timeout: 30_000 });
  if (await extensionDetail.isVisible()) {
    throw new Error("Packaged resource detail must not share the Package Catalog surface.");
  }
  const packagedExtensionRow = extensionList.getByRole("button", { name: /^pi-subagents，/u });
  await packagedExtensionRow.waitFor({ state: "visible", timeout: 30_000 });
  await capturePackagedScreenshot(window, "04-resource-package-catalog.png");
  await packagedExtensionRow.click();
  await extensionDetail.waitFor({ state: "visible", timeout: 15_000 });
  await extensionList.waitFor({ state: "hidden", timeout: 15_000 });
  await extensionDetail.getByText("将任务委派给子代理，支持任务链、并行执行和交互式澄清。", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  if (await extensionDetail.getByText("Pi extension for delegating tasks", { exact: false }).count()) {
    throw new Error("Packaged resource detail exposed raw English manifest copy in the Chinese locale.");
  }
  await assertNoWorkspaceChangesAuthorityWarning(window);
  await capturePackagedScreenshot(window, "05-resource-package-detail.png");
  await extensionWorkspace.getByRole("button", { name: "返回扩展包列表" }).click();
  await extensionList.waitFor({ state: "visible", timeout: 15_000 });
  const settingsNavigation = workspaceSettings.getByRole("navigation", { name: "设置分类" });
  const extensionSettingsWorkspace = workspaceSettings.getByTestId("extension-settings-workspace");
  await extensionSettingsWorkspace.getByRole("tab", { name: "内置扩展", exact: true }).click();
  await extensionSettingsWorkspace.getByText("pi-hy-memory", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await extensionSettingsWorkspace.getByText("xtalpi-pi-tools", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await capturePackagedScreenshot(window, "06-bundled-extensions.png");
  await extensionSettingsWorkspace.getByRole("tab", { name: "本地扩展", exact: true }).click();
  const localExtensionPanel = extensionSettingsWorkspace.getByRole("tabpanel", { name: "本地扩展", exact: true });
  await localExtensionPanel.getByText("shutdown-fixture.ts", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  if (await localExtensionPanel.getByText("pi-subagents · index.js", { exact: true }).count()) {
    throw new Error("Packaged third-party Extension was duplicated in the local Extension view.");
  }
  if (await localExtensionPanel.getByRole("button", { name: /卸载/u }).count()) {
    throw new Error("Packaged local Extension view repeated Package uninstall controls.");
  }
  await capturePackagedScreenshot(window, "06-local-extensions.png");
  await settingsNavigation.getByRole("button", { name: "技能", exact: true }).click();
  const skillSettingsWorkspace = workspaceSettings.getByTestId("skill-settings-workspace");
  const globalSkillPanel = skillSettingsWorkspace.getByRole("tabpanel", { name: "全局可用", exact: true });
  await globalSkillPanel.getByText("packaged-skill", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  if (await globalSkillPanel.getByText("pi-subagents", { exact: true }).count()) {
    throw new Error("Packaged global Skill view repeated an Extension-only Package.");
  }
  await capturePackagedScreenshot(window, "07-global-skills.png");
  await assertPackagedSkillSuites(
    skillSettingsWorkspace,
    (fileName) => capturePackagedScreenshot(window, fileName)
  );
  await settingsNavigation.getByRole("button", { name: "指令模板", exact: true }).click();
  await workspaceSettings.getByText("/packaged-review", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  if (await workspaceSettings.getByText("pi-subagents", { exact: true }).count()) {
    throw new Error("Packaged Prompt Template page repeated an Extension-only Package.");
  }
  await capturePackagedScreenshot(window, "08-prompt-template-resources.png");
  await settingsNavigation.getByRole("button", { name: "规则与上下文", exact: true }).click();
  const ruleSettingsWorkspace = workspaceSettings.getByTestId("rule-settings-workspace");
  const globalRuleCategories = ruleSettingsWorkspace.getByRole("group", { name: "全局规则与上下文分类" });
  await globalRuleCategories.getByRole("button", { name: "桌面托管", exact: true }).click();
  const managedRuleCatalog = ruleSettingsWorkspace.getByRole("list", { name: "桌面托管规则", exact: true });
  const managedRuleRows = managedRuleCatalog.getByRole("listitem");
  await managedRuleRows.first().waitFor({ state: "visible", timeout: 15_000 });
  if (await managedRuleRows.count() !== 11) {
    throw new Error(`Expected 11 Desktop-managed rule files, received ${await managedRuleRows.count()}.`);
  }
  await managedRuleRows.first().getByRole("button").click();
  const managedRuleDetail = ruleSettingsWorkspace.getByTestId("context-file-detail");
  const managedRuleSource = managedRuleDetail.getByRole("textbox");
  await managedRuleSource.waitFor({ state: "visible", timeout: 15_000 });
  if (await managedRuleSource.getAttribute("readonly") === null) {
    throw new Error("Desktop-managed rule source was unexpectedly editable.");
  }
  await managedRuleDetail.getByRole("button", { name: "预览", exact: true }).click();
  await managedRuleDetail.getByTestId("context-file-preview")
    .waitFor({ state: "visible", timeout: 15_000 });
  await capturePackagedScreenshot(window, "09-rule-context-managed-preview.png");
  await managedRuleDetail.getByRole("button", { name: "返回规则目录", exact: true }).click();
  await ruleSettingsWorkspace.getByRole("tab", { name: "项目专属", exact: true }).click();
  await ruleSettingsWorkspace.getByRole("heading", { name: "项目规则与上下文", exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await workspaceSettings.getByText(/(?:\/|\\)workspace(?:\/|\\)AGENTS\.md$/u)
    .waitFor({ state: "visible", timeout: 15_000 });
  await capturePackagedScreenshot(window, "09-rule-context-project-catalog.png");
  const projectRuleCategories = ruleSettingsWorkspace.getByRole("group", { name: "项目规则与上下文分类" });
  await projectRuleCategories.getByRole("button", { name: "继承规则", exact: true }).click();
  await ruleSettingsWorkspace.getByRole("heading", { name: "继承的规则与上下文", exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  if (window.url() !== "app://pi67/index.html") throw new Error(`Unexpected packaged renderer URL: ${window.url()}`);
  const security = await window.evaluate(() => ({
    hasNodeProcess: "process" in globalThis,
    hasRequire: "require" in globalThis,
    hasBridge: typeof window.pi67?.system === "object"
  }));
  if (security.hasNodeProcess || security.hasRequire || !security.hasBridge) {
    throw new Error(`Packaged renderer security boundary failed: ${JSON.stringify(security)}`);
  }
  const packagedVersion = await application.evaluate(({ app }) => app.getVersion());
  await workspaceSettings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^关于/u }).click();
  await workspaceSettings.getByRole("heading", { name: "关于", exact: true, level: 1 })
    .waitFor({ state: "visible", timeout: 15_000 });
  for (const value of [packagedVersion, "macOS", "Apple Silicon (arm64)", "Unsigned Preview · 手动更新"]) {
    await workspaceSettings.getByText(value, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  }
  await capturePackagedScreenshot(window, "10-about.png");
  await window.locator('html[data-theme-preference="system"]').waitFor({ state: "attached" });
  await workspaceSettings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^外观/u }).click();
  await workspaceSettings.getByRole("button", { name: /^浅色/u }).click();
  await window.locator('html[data-theme-preference="light"][data-theme="light"]').waitFor({ state: "attached" });
  await capturePackagedScreenshot(window, "10-appearance-light.png");
  await workspaceSettings.getByRole("button", { name: "返回工作台" }).click();
  await workspaceSettings.waitFor({ state: "hidden", timeout: 15_000 });
  try {
    await window.getByLabel("Pi conversation").waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    const returnedSurface = await inspectRendererSurface(window);
    throw new Error(`Packaged Settings did not return to the conversation: ${JSON.stringify(returnedSurface)}`, { cause: error });
  }
  await capturePackagedWorkbenchVisualEvidence(application, window);
  await window.reload();
  await window.locator('html[data-theme-preference="light"][data-theme="light"]').waitFor({ state: "attached" });
  const restoredConversation = window.getByLabel("Pi conversation");
  const restoreTask = window.getByRole("button", { name: "恢复任务", exact: true });
  const createConversation = window.getByRole("button", { name: "新建会话", exact: true });
  try {
    await restoredConversation.or(restoreTask).or(createConversation).waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    const reloadSurface = await inspectRendererSurface(window);
    throw new Error(`Packaged workspace did not restore after reload: ${JSON.stringify(reloadSurface)}`, { cause: error });
  }
  if (await restoreTask.isVisible()) await restoreTask.click();
  else if (await createConversation.isVisible()) await createConversation.click();
  try {
    await restoredConversation.waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    throw new Error(`Packaged task did not resume after reload: ${JSON.stringify(await inspectRendererSurface(window))}`, { cause: error });
  }
  await window.getByLabel("当前状态：Pi SDK 已就绪").waitFor({ state: "visible", timeout: 30_000 });

  await application.close();
  application = undefined;
  application = await launchPackagedApplication({
    agentDir,
    artifact,
    userDataDirectory
  });
  packagedProcessOutput = captureProcessOutput(application.process());
  window = await application.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.getByRole("list", { name: "工作区与会话" }).waitFor({ state: "visible", timeout: 30_000 });
  if (await window.getByLabel("当前状态：等待选择工作区").count()) {
    throw new Error(`Packaged cold restart lost Workspace authority: ${JSON.stringify(await inspectRendererSurface(window))}`);
  }
  const coldConversation = window.getByLabel("Pi conversation");
  const coldRestoreTask = window.getByRole("button", { name: "恢复任务", exact: true });
  const coldOpenConversation = window.getByRole("button", { name: "打开会话", exact: true });
  const coldCreateConversation = window.getByRole("button", { name: "新建会话", exact: true });
  try {
    await coldConversation.or(coldRestoreTask).or(coldOpenConversation).or(coldCreateConversation)
      .waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    throw new Error(`Packaged Workspace did not restore after a cold restart: ${JSON.stringify(await inspectRendererSurface(window))}`, { cause: error });
  }
  await verifyColdProviderRestoration(window);

  if (!(await coldConversation.isVisible())) {
    await window.keyboard.press(process.platform === "darwin" ? "Meta+N" : "Control+N");
  }
  try {
    await coldConversation.waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    throw new Error(`Packaged conversation did not activate after a cold restart: ${JSON.stringify(await inspectRendererSurface(window))}\n${packagedProcessOutput() || "No packaged process diagnostics were emitted."}`, { cause: error });
  }
  await window.locator('[data-runtime-phase="ready"]').waitFor({ state: "visible", timeout: 30_000 });

  const closeDurationMs = await runControlledShutdownScenario({
    application,
    childPidPath,
    lifecyclePath,
    shutdownState,
    window
  });
  childPid = shutdownState.childPid;
  application = undefined;
  console.log(`Packaged Electron smoke passed: ${process.platform}/${process.arch}, private toolchain + first-party capabilities, bounded Provider workbench search/scrolling + segmented single-model catalog + one-shot literal credential reveal, app://pi67, theme persistence, sandbox, node:sqlite utility lifecycle, Session Catalog rebuild, cold Workspace/Provider restoration, synthetic powerMonitor resume resync, real Agent Host roundtrip, and bounded active-prompt shutdown (${closeDurationMs}ms).`);
} finally {
  try {
    if (application) await application.close();
    childPid ??= shutdownState.childPid;
    if (childPid !== undefined && isProcessAlive(childPid)) process.kill(childPid);
  } finally {
    await cleanupPackagedTestDirectories(userDataDirectory);
  }
}

async function assertNoWorkspaceChangesAuthorityWarning(window) {
  if (await window.getByText("无法加载本会话修改记录", { exact: true }).count()) {
    throw new Error("Packaged workspace-only Settings requested Task-scoped workspace changes.");
  }
}
