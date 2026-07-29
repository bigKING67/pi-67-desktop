import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertSingleShutdownQuitLifecycle,
  CONTROLLED_PROMPT_TEXT,
  isProcessAlive,
  readPositiveProcessId,
  resetControlledShutdownLifecycle,
  waitForProcessExit,
  writeControlledShutdownExtension
} from "./controlled-shutdown-fixture.ts";
import { startControlledPrompt } from "./controlled-provider-interaction.mjs";
import {
  assertPackagedRuntimeAssets,
  cleanupPackagedTestDirectories,
  createPackagedTestDirectories,
  installWorkspaceDialogResult,
  launchPackagedApplication,
  resolvePackagedArtifact
} from "./packaged-electron-fixture.mjs";

const artifact = resolvePackagedArtifact();
await assertPackagedRuntimeAssets(artifact);
const packagedScreenshotDirectory = process.env.PI67_PACKAGED_SCREENSHOT_DIR?.trim() || undefined;
if (packagedScreenshotDirectory) await mkdir(packagedScreenshotDirectory, { recursive: true });
const {
  agentDir,
  extensionsDirectory,
  userDataDirectory,
  workspace
} = await createPackagedTestDirectories("pi67-packaged-smoke-");
const childPidPath = join(userDataDirectory, "child.pid");
const lifecyclePath = join(userDataDirectory, "lifecycle.txt");
const packagedCredential = "pi67-packaged-reveal-fixture";
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
  await window.evaluate(() => window.pi67.system.connectAgentHost());
  const initialSettings = await openSettingsSection(window, /^运行服务/u);
  await initialSettings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^下载源与网络/u }).click();
  await initialSettings.getByText("24.18.0", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await initialSettings.getByText("12.0.1", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await initialSettings.getByText("2.53.0", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await initialSettings.getByText("https://registry.npmmirror.com", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await initialSettings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^运行服务/u }).click();
  await initialSettings.getByRole("button", { name: /运行环境诊断/u }).click();
  const doctorDialog = window.getByRole("dialog", { name: "运行环境诊断" });
  await doctorDialog.waitFor({ state: "visible", timeout: 15_000 });
  await doctorDialog.getByRole("button", { name: "运行检查" }).click();
  const doctorResults = doctorDialog.getByLabel("运行环境检查结果");
  const doctorError = doctorDialog.locator(".doctor-error");
  await doctorResults.or(doctorError).waitFor({ state: "visible", timeout: 30_000 });
  if (await doctorError.isVisible()) {
    throw new Error([
      `Packaged Agent Host Doctor failed: ${(await doctorError.textContent())?.trim() ?? "unknown error"}`,
      packagedProcessOutput() || "No packaged process diagnostics were emitted."
    ].join("\n"));
  }
  await doctorResults.getByText("Pi SDK").waitFor({ state: "visible", timeout: 30_000 });
  const sqliteCheck = doctorResults.locator(".doctor-check").filter({ hasText: "内置 SQLite" });
  await sqliteCheck.getByText("通过", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await sqliteCheck.getByText(/temporary-file create\/open\/close\/reopen verified\./u)
    .waitFor({ state: "visible", timeout: 30_000 });
  const sessionCatalogCheck = doctorResults.locator(".doctor-check").filter({ hasText: "Session 目录" });
  await sessionCatalogCheck.getByText("需注意", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await sessionCatalogCheck.getByText(/schema v1; unavailable/u).waitFor({ state: "visible", timeout: 30_000 });
  await doctorDialog.getByRole("button", { name: "关闭" }).click();
  await initialSettings.getByRole("button", { name: "返回工作台" }).click();
  await initialSettings.waitFor({ state: "hidden", timeout: 15_000 });
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
    .getByRole("button", { name: /^扩展/u }).click();
  const extensionWorkspace = workspaceSettings.getByTestId("extension-management-workspace");
  const extensionList = extensionWorkspace.getByTestId("extension-package-list-scroll");
  const extensionDetail = extensionWorkspace.getByTestId("extension-package-detail-scroll");
  await extensionList.waitFor({ state: "visible", timeout: 30_000 });
  if (await extensionDetail.isVisible()) {
    throw new Error("Packaged Extension detail must not share the Extension Catalog surface.");
  }
  const packagedExtensionRow = extensionList.getByRole("button").first();
  await packagedExtensionRow.waitFor({ state: "visible", timeout: 30_000 });
  await capturePackagedScreenshot(window, "04-extension-catalog.png");
  await packagedExtensionRow.click();
  await extensionDetail.waitFor({ state: "visible", timeout: 15_000 });
  await extensionList.waitFor({ state: "hidden", timeout: 15_000 });
  await assertNoWorkspaceChangesAuthorityWarning(window);
  await capturePackagedScreenshot(window, "05-extension-detail.png");
  await extensionWorkspace.getByRole("button", { name: "返回扩展列表" }).click();
  await extensionList.waitFor({ state: "visible", timeout: 15_000 });
  if (window.url() !== "app://pi67/index.html") throw new Error(`Unexpected packaged renderer URL: ${window.url()}`);
  const security = await window.evaluate(() => ({
    hasNodeProcess: "process" in globalThis,
    hasRequire: "require" in globalThis,
    hasBridge: typeof window.pi67?.system === "object"
  }));
  if (security.hasNodeProcess || security.hasRequire || !security.hasBridge) {
    throw new Error(`Packaged renderer security boundary failed: ${JSON.stringify(security)}`);
  }
  await window.locator('html[data-theme-preference="system"]').waitFor({ state: "attached" });
  await workspaceSettings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^通用/u }).click();
  await workspaceSettings.getByRole("button", { name: /^浅色/u }).click();
  await window.locator('html[data-theme-preference="light"][data-theme="light"]').waitFor({ state: "attached" });
  await capturePackagedScreenshot(window, "06-general-light.png");
  await workspaceSettings.getByRole("button", { name: "返回工作台" }).click();
  await workspaceSettings.waitFor({ state: "hidden", timeout: 15_000 });
  try {
    await window.getByLabel("Pi conversation").waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    const returnedSurface = await inspectRendererSurface(window);
    throw new Error(`Packaged Settings did not return to the conversation: ${JSON.stringify(returnedSurface)}`, { cause: error });
  }
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
  const coldProviderSettings = await openSettingsSection(window, /^模型服务/u);
  const coldProviderPanel = coldProviderSettings.getByTestId("provider-configuration-panel");
  const coldProviderList = coldProviderPanel.getByTestId("provider-configuration-list");
  await coldProviderPanel.getByRole("textbox", { name: "搜索 Pi Provider" }).waitFor({ state: "visible", timeout: 30_000 });
  await coldProviderList.getByRole("button").first().click();
  await coldProviderPanel.getByTestId("provider-configuration-editor").waitFor({ state: "visible", timeout: 30_000 });
  await coldProviderList.waitFor({ state: "hidden", timeout: 30_000 });
  const coldModelTab = coldProviderPanel.getByRole("tablist", { name: "Provider 设置分区" })
    .getByRole("tab", { name: /^模型 \d+$/u });
  await coldModelTab.waitFor({ state: "visible", timeout: 30_000 });
  if ((await coldModelTab.getAttribute("aria-selected")) !== "true") {
    throw new Error("Packaged cold restart did not restore the Provider model catalog surface.");
  }
  const coldProviderModelList = coldProviderPanel.getByTestId("provider-model-list");
  const coldProviderModelRow = coldProviderModelList.getByTestId("provider-model-row").first();
  await coldProviderModelRow.waitFor({ state: "visible", timeout: 30_000 });
  if ((await coldProviderPanel.getByLabel("Model ID").count()) !== 0) {
    throw new Error("Packaged cold restart mounted a model editor before selection.");
  }
  await coldProviderModelRow.click();
  await coldProviderPanel.getByTestId("provider-model-detail").waitFor({ state: "visible", timeout: 30_000 });
  await coldProviderModelList.waitFor({ state: "hidden", timeout: 30_000 });
  if ((await coldProviderPanel.getByLabel("Model ID").count()) !== 1) {
    throw new Error("Packaged cold restart did not render one selected model editor.");
  }
  await window.getByRole("button", { name: /打开通知中心/u }).click();
  const coldNotifications = window.getByRole("dialog", { name: "通知中心" });
  await coldNotifications.waitFor({ state: "visible", timeout: 15_000 });
  if (await coldNotifications.getByText("无法读取 Pi Provider 配置", { exact: true }).count()) {
    throw new Error(`Packaged Provider load timed out after a cold restart: ${JSON.stringify(await inspectRendererSurface(window))}`);
  }
  await window.keyboard.press("Escape");
  await coldProviderSettings.getByRole("button", { name: "返回工作台" }).click();
  await coldProviderSettings.waitFor({ state: "hidden", timeout: 15_000 });

  if (!(await coldConversation.isVisible())) {
    await window.keyboard.press(process.platform === "darwin" ? "Meta+N" : "Control+N");
  }
  try {
    await coldConversation.waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    throw new Error(`Packaged conversation did not activate after a cold restart: ${JSON.stringify(await inspectRendererSurface(window))}\n${packagedProcessOutput() || "No packaged process diagnostics were emitted."}`, { cause: error });
  }
  await window.locator('[data-runtime-phase="ready"]').waitFor({ state: "visible", timeout: 30_000 });

  await application.evaluate(({ powerMonitor }) => powerMonitor.emit("resume"));
  await window.getByLabel("当前状态：系统恢复后 Pi 状态已重新同步")
    .waitFor({ state: "visible", timeout: 30_000 });
  // Renderer reload can reattach or reinitialize the Task Runtime. Scope the
  // exactly-once shutdown probe to final app quit.
  await resetControlledShutdownLifecycle(lifecyclePath);
  await startControlledPrompt(window);
  await window.locator('[data-testid="conversation-row"]')
    .filter({ hasText: CONTROLLED_PROMPT_TEXT }).waitFor({ state: "visible", timeout: 10_000 });
  await window.locator(".brand-lockup").getByText(CONTROLLED_PROMPT_TEXT, { exact: true })
    .waitFor({ state: "visible", timeout: 10_000 });
  childPid = await readPositiveProcessId(childPidPath);
  if (!isProcessAlive(childPid)) throw new Error("Controlled Extension child exited before packaged shutdown.");
  const utilityPids = await application.evaluate(({ app }) => app.getAppMetrics()
    .filter((metric) => metric.type === "Utility")
    .map((metric) => metric.pid));
  if (utilityPids.length === 0) throw new Error("Packaged Agent Host utility process was not observable.");

  const closeStartedAt = Date.now();
  await application.close();
  application = undefined;
  const closeDurationMs = Date.now() - closeStartedAt;
  if (closeDurationMs > 5_000) {
    throw new Error(`Packaged application shutdown exceeded 5000ms: ${closeDurationMs}ms.`);
  }
  await waitForProcessExit(childPid);
  for (const pid of utilityPids) await waitForProcessExit(pid);
  await assertSingleShutdownQuitLifecycle(lifecyclePath, "Packaged Pi Runtime");
  console.log(`Packaged Electron smoke passed: ${process.platform}/${process.arch}, private toolchain + first-party capabilities, bounded Provider workbench search/scrolling + segmented single-model catalog + one-shot literal credential reveal, app://pi67, theme persistence, sandbox, node:sqlite utility lifecycle, Session Catalog rebuild, cold Workspace/Provider restoration, synthetic powerMonitor resume resync, real Agent Host roundtrip, and bounded active-prompt shutdown (${closeDurationMs}ms).`);
} finally {
  try {
    if (application) await application.close();
    if (childPid !== undefined && isProcessAlive(childPid)) process.kill(childPid);
  } finally {
    await cleanupPackagedTestDirectories(userDataDirectory);
  }
}

function captureProcessOutput(process) {
  let output = "";
  const capture = (chunk) => {
    if (output.length >= 8_192) return;
    output += String(chunk).slice(0, 8_192 - output.length);
  };
  process.stdout?.on("data", capture);
  process.stderr?.on("data", capture);
  return () => output;
}

async function openSettingsSection(window, sectionName) {
  await window.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
  const settings = window.getByLabel("π 设置");
  await settings.waitFor({ state: "visible", timeout: 15_000 });
  const settingsLayout = await settings.evaluate((element) => ({
    columns: getComputedStyle(element).gridTemplateColumns,
    width: element.getBoundingClientRect().width
  }));
  if (settingsLayout.columns.trim().split(/\s+/u).length !== 2) {
    throw new Error(`Expected two-column packaged Settings at ${settingsLayout.width}px, received ${settingsLayout.columns}.`);
  }
  if (await window.getByRole("complementary", { name: "会话导航" }).count()) {
    throw new Error("Packaged Settings must not retain the workspace navigation column.");
  }
  if (await window.getByTestId("inspector-toggle").count()) {
    throw new Error("Packaged Settings must not retain the Inspector toggle.");
  }
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: sectionName }).click();
  return settings;
}

function inspectRendererSurface(window) {
  return window.evaluate(() => ({
    bodyText: document.body.innerText.slice(0, 2_000),
    conversationCount: document.querySelectorAll('[aria-label="Pi conversation"]').length,
    conversationRowCount: document.querySelectorAll('[data-testid="conversation-row"]').length,
    settingsVisible: Boolean(document.querySelector('[data-testid="settings-workbench"]')),
    title: document.title,
    url: location.href
  }));
}

async function capturePackagedScreenshot(window, fileName) {
  if (!packagedScreenshotDirectory) return;
  await window.screenshot({ path: join(packagedScreenshotDirectory, fileName) });
}

async function assertNoWorkspaceChangesAuthorityWarning(window) {
  if (await window.getByText("无法加载本会话修改记录", { exact: true }).count()) {
    throw new Error("Packaged workspace-only Settings requested Task-scoped workspace changes.");
  }
}
