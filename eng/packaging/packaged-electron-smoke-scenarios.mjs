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
  await settings.getByRole("button", { name: /运行环境诊断/u }).click();
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
  await settings.getByRole("button", { name: "返回工作台" }).click();
  await settings.waitFor({ state: "hidden", timeout: 15_000 });
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
  await startControlledPrompt(window);
  await window.locator('[data-testid="conversation-row"]')
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
