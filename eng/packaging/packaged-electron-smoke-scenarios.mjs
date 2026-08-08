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

export async function verifyInitialRuntimeSettings(window, packagedProcessOutput) {
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
  await sessionCatalogCheck.getByText(/schema v3; unavailable/u).waitFor({ state: "visible", timeout: 30_000 });
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
    await window.getByRole("button", { name: /新建会话$/u }).first().click({ timeout: timeoutMs });
  }
  await intent.waitFor({ state: "visible", timeout: timeoutMs });
}

export async function verifyColdProviderRestoration(window) {
  const settings = await openSettingsSection(window, /^模型服务/u);
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
    throw new Error("Packaged cold restart did not restore the Provider model catalog surface.");
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
  await window.locator(".brand-lockup").getByText(CONTROLLED_PROMPT_TEXT, { exact: true })
    .waitFor({ state: "visible", timeout: 10_000 });
  shutdownState.childPid = await readPositiveProcessId(childPidPath);
  if (!isProcessAlive(shutdownState.childPid)) {
    throw new Error("Controlled Extension child exited before packaged shutdown.");
  }
  const utilityPids = await application.evaluate(({ app }) => app.getAppMetrics()
    .filter((metric) => metric.type === "Utility")
    .map((metric) => metric.pid));
  if (utilityPids.length === 0) throw new Error("Packaged Agent Host utility process was not observable.");

  const closeStartedAt = Date.now();
  await application.close();
  const closeDurationMs = Date.now() - closeStartedAt;
  if (closeDurationMs > 5_000) {
    throw new Error(`Packaged application shutdown exceeded 5000ms: ${closeDurationMs}ms.`);
  }
  await waitForProcessExit(shutdownState.childPid);
  for (const pid of utilityPids) await waitForProcessExit(pid);
  await assertSingleShutdownQuitLifecycle(lifecyclePath, "Packaged Pi Runtime");
  return closeDurationMs;
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

export function inspectRendererSurface(window) {
  return window.evaluate(() => ({
    bodyText: document.body.innerText.slice(0, 2_000),
    conversationCount: document.querySelectorAll('[aria-label="Pi conversation"]').length,
    conversationRowCount: document.querySelectorAll('[data-testid="conversation-row"]').length,
    settingsVisible: Boolean(document.querySelector('[data-testid="settings-workbench"]')),
    title: document.title,
    url: location.href
  }));
}
