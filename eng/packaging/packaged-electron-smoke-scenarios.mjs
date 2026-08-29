import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  assertSingleShutdownQuitLifecycle,
  CONTROLLED_PROMPT_TEXT,
  isProcessAlive,
  readPositiveProcessId,
  resetControlledShutdownLifecycle,
  waitForProcessExit
} from "./controlled-shutdown-fixture.ts";
import { startControlledPrompt } from "./controlled-provider-interaction.mjs";
import {
  measureElectronApplicationShutdown,
  productShutdownWithinBudget
} from "./electron-shutdown-measurement.mjs";

const PACKAGED_SHUTDOWN_BUDGET_MS = 5_000;

export async function verifyPackagedWelcome({
  agentDir,
  application,
  captureScreenshot,
  packagedCredential,
  packagedProcessOutput,
  userDataDirectory,
  window,
  workspace,
  verifyMainOnlyDiagnostics
}) {
  const rendererBootstrapFailures = captureRendererBootstrapFailures(window);
  try {
    await window.waitForLoadState("domcontentloaded");
    await window.getByRole("button", { name: "选择工作区" }).waitFor({ state: "visible", timeout: 15_000 });
    if (!(await window.getByRole("button", { name: "选择工作区" }).isEnabled())) {
      throw new Error("Packaged workspace action is unavailable before Agent Host demand.");
    }
    await window.getByLabel("当前状态：等待选择工作区").waitFor({ state: "visible", timeout: 15_000 });
    await verifyMainOnlyDiagnostics({
      agentDir,
      application,
      packagedCredential,
      userDataDirectory,
      window,
      workspace
    });
  } catch (error) {
    await captureScreenshot(window, "00-welcome-failure.png").catch(() => undefined);
    const surface = await inspectRendererSurface(window).catch(() => ({ unavailable: true }));
    throw new Error([
      `Packaged welcome did not render: ${JSON.stringify(surface)}`,
      `Renderer bootstrap failures: ${JSON.stringify(rendererBootstrapFailures())}`,
      packagedProcessOutput() || "No packaged process diagnostics were emitted."
    ].join("\n"), { cause: error });
  }
}

export async function captureWelcomeAndConnectAgentHost(window, captureScreenshot, packagedProcessOutput) {
  await captureScreenshot(window, "00-welcome-system.png");
  await window.evaluate(() => window.pi67.system.connectAgentHost());
  await verifyInitialRuntimeSettings(window, packagedProcessOutput);
}

export async function openPackagedSmokeWorkspace({ application, window, workspace }) {
  await application.evaluate(({ dialog }, selectedWorkspace) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedWorkspace] });
  }, workspace);
  await window.getByRole("button", { name: "选择工作区" }).click();
  await window.getByLabel("当前状态：Pi SDK 已就绪").waitFor({ state: "visible", timeout: 30_000 });
  await window.getByRole("list", { name: "工作区与对话" }).waitFor({ state: "visible", timeout: 30_000 });
  const rows = window.locator('[data-testid="conversation-row"]');
  await rows.first().waitFor({ state: "visible", timeout: 30_000 });
  const rowCount = await rows.count();
  if (rowCount !== 1) {
    throw new Error(`Expected one initial packaged conversation row, received ${rowCount}.`);
  }
}

export async function verifyReadySessionCatalog(window) {
  const settings = await openSettingsSection(window, /^运行服务/u);
  await settings.getByRole("button", { name: /恢复与诊断/u }).click();
  const doctorDialog = window.getByRole("dialog", { name: "恢复与诊断" });
  const sessionCatalogCheck = doctorDialog.getByLabel("运行环境检查结果")
    .locator(".doctor-check").filter({ hasText: "Session 目录" });
  await doctorDialog.getByRole("button", { name: /重新检查/u }).click();
  await sessionCatalogCheck.getByText("通过", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await sessionCatalogCheck.getByText(/schema v7; ready/u).waitFor({ state: "visible", timeout: 30_000 });
  await doctorDialog.getByRole("button", { name: "关闭" }).click();
  return settings;
}

async function verifyInitialRuntimeSettings(window, packagedProcessOutput) {
  const settings = await openSettingsSection(window, /^运行服务/u);
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^下载源与网络/u }).click();
  await settings.getByText("24.18.0", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await settings.getByText("12.0.1", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  const gitVersion = process.platform === "win32" ? "2.53.0.windows.3" : "2.53.0";
  await settings.getByText(gitVersion, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await settings.getByText("https://registry.npmmirror.com", { exact: true })
    .waitFor({ state: "visible", timeout: 15_000 });
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^运行服务/u }).click();
  await settings.getByRole("button", { name: /恢复与诊断/u }).click();
  const doctorDialog = window.getByRole("dialog", { name: "恢复与诊断" });
  await doctorDialog.waitFor({ state: "visible", timeout: 15_000 });
  await doctorDialog.getByRole("button", { name: "开始检查" }).click();
  const doctorResults = doctorDialog.getByLabel("运行环境检查结果");
  const doctorError = doctorDialog.locator(".doctor-error");
  await doctorResults.or(doctorError).waitFor({ state: "visible", timeout: 60_000 });
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
  await sessionCatalogCheck.getByText(/schema v7; unavailable/u).waitFor({ state: "visible", timeout: 30_000 });
  await doctorDialog.getByRole("button", { name: "关闭" }).click();
  await settings.getByRole("button", { name: "返回工作台" }).click();
  await settings.waitFor({ state: "hidden", timeout: 15_000 });
}

export async function verifyPackagedPrivateGitWorktreeContract(window) {
  await window.locator('[data-repository-status="primary"]')
    .waitFor({ state: "visible", timeout: 30_000 });
  await ensurePackagedNewSessionIntent(window);
  const selector = window.getByTestId("new-session-environment-selector");
  await selector.waitFor({ state: "visible", timeout: 30_000 });
  const local = selector.getByRole("radio", { name: /当前工作区/u });
  const worktree = selector.getByRole("radio", { name: /隔离 Worktree/u });
  const localOption = selector.locator("label").filter({ hasText: "当前工作区" });
  const worktreeOption = selector.locator("label").filter({ hasText: "隔离 Worktree" });
  if (!(await worktree.isEnabled())) {
    throw new Error("Packaged private Git inspection did not admit Worktree intent for the no-origin fixture.");
  }
  await worktreeOption.click();
  if (!(await worktree.isChecked())) throw new Error("Packaged Worktree intent was not selected.");
  await localOption.click();
  if (!(await local.isChecked())) throw new Error("Packaged Local intent was not restored without Git mutation.");
}

export async function ensurePackagedNewSessionIntent(window, timeoutMs = 30_000) {
  const intent = window.getByTestId("new-session-intent");
  if (!(await intent.isVisible())) {
    await window.getByRole("button", { name: /新建对话$/u }).first().click({ timeout: timeoutMs });
  }
  await intent.waitFor({ state: "visible", timeout: timeoutMs });
}

export async function verifyColdProviderRestoration(window) {
  const settings = await openSettingsSection(window, "模型");
  const providerPanel = settings.getByTestId("provider-configuration-panel");
  const providerList = providerPanel.getByTestId("provider-configuration-list");
  await providerPanel.getByRole("textbox", { name: "搜索 Pi Provider" }).waitFor({ state: "visible", timeout: 30_000 });
  await providerList.getByRole("button").first().click();
  await providerPanel.getByTestId("provider-configuration-editor").waitFor({ state: "visible", timeout: 30_000 });
  await providerList.waitFor({ state: "hidden", timeout: 30_000 });
  const modelTab = providerPanel.getByRole("tablist", { name: "Provider 设置分区" })
    .getByRole("tab", { name: /^模型 \d+$/u });
  await modelTab.waitFor({ state: "visible", timeout: 30_000 });
  if ((await modelTab.getAttribute("aria-selected")) !== "true") {
    const tabs = await providerPanel
      .getByRole("tablist", { name: "Provider 设置分区" })
      .getByRole("tab")
      .evaluateAll((elements) => elements.map((element) => ({
        label: element.textContent?.trim() ?? "",
        selected: element.getAttribute("aria-selected")
      })));
    throw new Error(`Packaged cold restart did not restore the Provider model catalog surface: ${JSON.stringify(tabs)}.`);
  }
  const modelList = providerPanel.getByTestId("provider-model-list");
  const modelRow = modelList.getByTestId("provider-model-row").first();
  await modelRow.waitFor({ state: "visible", timeout: 30_000 });
  if ((await providerPanel.getByLabel("Model ID").count()) !== 0) {
    throw new Error("Packaged cold restart mounted a model editor before selection.");
  }
  await modelRow.click();
  await providerPanel.getByTestId("provider-model-detail").waitFor({ state: "visible", timeout: 30_000 });
  await modelList.waitFor({ state: "hidden", timeout: 30_000 });
  if ((await providerPanel.getByLabel("Model ID").count()) !== 1) {
    throw new Error("Packaged cold restart did not render one selected model editor.");
  }
  await window.getByRole("button", { name: /打开通知中心/u }).click();
  const notifications = window.getByRole("dialog", { name: "通知中心" });
  await notifications.waitFor({ state: "visible", timeout: 15_000 });
  if (await notifications.getByText("无法读取 Pi Provider 配置", { exact: true }).count()) {
    throw new Error(`Packaged Provider load timed out after a cold restart: ${JSON.stringify(await inspectRendererSurface(window))}`);
  }
  await window.keyboard.press("Escape");
  await settings.getByRole("button", { name: "返回工作台" }).click();
  await settings.waitFor({ state: "hidden", timeout: 15_000 });
}

export async function runControlledShutdownScenario({
  application,
  childPidPath,
  lifecyclePath,
  shutdownState,
  window
}) {
  await application.evaluate(({ powerMonitor }) => powerMonitor.emit("resume"));
  await window.getByLabel("当前状态：系统恢复后 Pi 状态已重新同步")
    .waitFor({ state: "visible", timeout: 30_000 });
  // Reload recovery may reattach the runtime; the final quit owns this lifecycle probe.
  await resetControlledShutdownLifecycle(lifecyclePath);
  // A prior controlled prompt can leave a dead PID in this shared probe file.
  await writeFile(childPidPath, "", "utf8");
  await startControlledPrompt(window);
  await window.locator('[data-testid="conversation-row"][aria-current="page"]')
    .filter({ hasText: CONTROLLED_PROMPT_TEXT }).waitFor({ state: "visible", timeout: 10_000 });
  await window.getByLabel("Pi conversation").getByText(CONTROLLED_PROMPT_TEXT, { exact: true })
    .waitFor({ state: "visible", timeout: 10_000 });
  shutdownState.childPid = await readPositiveProcessId(childPidPath);
  if (!isProcessAlive(shutdownState.childPid)) {
    throw new Error("Controlled Extension child exited before packaged shutdown.");
  }
  const utilityPids = await application.evaluate(({ app }) => app.getAppMetrics()
    .filter((metric) => metric.type === "Utility")
    .map((metric) => metric.pid));
  if (utilityPids.length === 0) throw new Error("Packaged Agent Host utility process was not observable.");

  const shutdownMeasurement = await measureElectronApplicationShutdown({
    application,
    budgetMs: PACKAGED_SHUTDOWN_BUDGET_MS,
    childPid: shutdownState.childPid,
    mainPid: application.process().pid,
    utilityPids
  });
  const shutdown = {
    budgetMs: PACKAGED_SHUTDOWN_BUDGET_MS,
    driverCloseDurationMs: round(shutdownMeasurement.driverCloseDurationMs),
    driverCloseError: shutdownMeasurement.driverCloseError,
    driverCloseTimedOut: shutdownMeasurement.driverCloseTimedOut,
    forcedTerminationRequested: shutdownMeasurement.forcedTerminationRequested,
    lifecycle: await inspectShutdownLifecycle(lifecyclePath),
    productExitDurationMs: round(shutdownMeasurement.productExitDurationMs),
    processes: shutdownMeasurement.processes
  };
  if (!productShutdownWithinBudget(shutdownMeasurement, PACKAGED_SHUTDOWN_BUDGET_MS)) {
    throw new Error(
      `Packaged product process shutdown exceeded ${PACKAGED_SHUTDOWN_BUDGET_MS}ms. `
      + `Shutdown diagnostics: ${JSON.stringify(shutdown)}`
    );
  }
  await waitForProcessExit(shutdownState.childPid);
  for (const pid of utilityPids) await waitForProcessExit(pid);
  await assertSingleShutdownQuitLifecycle(lifecyclePath, "Packaged Pi Runtime");
  return shutdown;
}

export async function waitForPersistedRuntimeRecovery(userDataDirectory, timeoutMs = 10_000) {
  const statePath = join(userDataDirectory, "workbench", "state-v5.json");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const state = await readFile(statePath, "utf8")
      .then((value) => JSON.parse(value))
      .catch(() => undefined);
    const hasMaterializedRecovery = Array.isArray(state?.runtimeRecovery) && state.runtimeRecovery.some((record) => (
      record?.conversation?.kind === "session"
      && typeof record.conversation.sessionFileIdentity === "string"
      && record.conversation.sessionFileIdentity.length > 0
      && typeof record.conversation.sessionPath === "string"
      && record.conversation.sessionPath.length > 0
      && typeof record.sessionId === "string"
      && record.sessionId.length > 0
    ));
    if (state?.version === 5 && hasMaterializedRecovery) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Packaged Workbench did not persist a materialized Session recovery record.");
}

export function captureProcessOutput(process) {
  let output = "";
  const capture = (chunk) => {
    if (output.length >= 8_192) return;
    output += String(chunk).slice(0, 8_192 - output.length);
  };
  process.stdout?.on("data", capture);
  process.stderr?.on("data", capture);
  return () => output;
}

export function captureRendererBootstrapFailures(window) {
  const failures = [];
  const capture = (kind, detail) => {
    if (failures.length < 10) failures.push({ kind, detail: String(detail).slice(0, 1_000) });
  };
  window.on("pageerror", (error) => capture("pageerror", error.message));
  window.on("requestfailed", (request) => {
    if (isCriticalRendererAsset(request.resourceType())) {
      capture("asset", `${request.url()} (${request.failure()?.errorText ?? "failed"})`);
    }
  });
  window.on("response", (response) => {
    if (isCriticalRendererAsset(response.request().resourceType()) && !response.ok()) {
      capture("asset", `${response.url()} (${response.status()})`);
    }
  });
  return () => failures;
}

export async function openSettingsSection(window, sectionName) {
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
  if (await window.getByRole("complementary", { name: "对话导航" }).count()) {
    throw new Error("Packaged Settings must not retain the workspace navigation column.");
  }
  if (await window.getByTestId("inspector-toggle").count()) {
    throw new Error("Packaged Settings must not retain the Inspector toggle.");
  }
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: sectionName }).click();
  return settings;
}

export function inspectRendererSurface(window) {
  return window.evaluate(() => ({
    bodyText: document.body.innerText.slice(0, 2_000),
    conversationCount: document.querySelectorAll('[aria-label="Pi conversation"]').length,
    conversationRowCount: document.querySelectorAll('[data-testid="conversation-row"]').length,
    rootChildCount: document.querySelector("#root")?.childElementCount ?? 0,
    settingsVisible: Boolean(document.querySelector('[data-testid="settings-workbench"]')),
    title: document.title,
    url: location.href
  }));
}

function isCriticalRendererAsset(resourceType) {
  return resourceType === "script" || resourceType === "stylesheet" || resourceType === "worker";
}

function round(value) {
  return value === null || value === undefined ? null : Math.round(value * 10) / 10;
}

async function inspectShutdownLifecycle(path) {
  const entries = (await readFile(path, "utf8").catch(() => ""))
    .split(/\r?\n/u)
    .filter(Boolean);
  return {
    entryCount: entries.length,
    otherEntryCount: entries.filter((entry) => entry !== "shutdown:quit").length,
    quitEntryCount: entries.filter((entry) => entry === "shutdown:quit").length
  };
}
