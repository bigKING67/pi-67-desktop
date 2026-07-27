import { resolve } from "node:path";
import {
  isProcessAlive,
  readPositiveProcessId,
  waitForProcessExit
} from "./controlled-shutdown-fixture.ts";
import {
  installWorkspaceDialogResult,
  launchPackagedApplication
} from "./packaged-electron-fixture.mjs";

export async function launchInstalledApplication({
  activeControlledOperation,
  agentDir,
  artifact,
  childPidPath,
  expectedTheme,
  legacyUserInterface,
  probePackagedRendererIsolation,
  selectLightTheme,
  userDataDirectory,
  workspace
}) {
  let application;
  let childPid;
  try {
    const startedAt = performance.now();
    application = await launchPackagedApplication({
      agentDir,
      artifact,
      probePackagedRendererIsolation,
      userDataDirectory
    });
    const mainPid = application.process().pid;
    const window = await application.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.getByRole("button", { name: "选择工作区" }).waitFor({ state: "visible", timeout: 15_000 });
    if (window.url() !== "app://pi67/index.html") {
      throw new Error(`Installed renderer did not use app://pi67: ${window.url()}.`);
    }
    await window.locator(`html[data-theme-preference="${expectedTheme}"]`).waitFor({ state: "attached" });

    const runtime = await application.evaluate(({ app }) => ({
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      executablePath: app.getPath("exe")
    }));
    if (resolve(runtime.executablePath).toLowerCase() !== resolve(artifact.executablePath).toLowerCase()) {
      throw new Error("Installed Electron runtime launched from an unexpected executable path.");
    }

    if (selectLightTheme) {
      await selectLightThemePreference(window, legacyUserInterface);
      await window.locator('html[data-theme-preference="light"][data-theme="light"]').waitFor({ state: "attached" });
    }

    await installWorkspaceDialogResult(application, workspace);
    await window.getByRole("button", { name: "选择工作区" }).click();
    await waitForRuntimeReady(window, legacyUserInterface);

    if (activeControlledOperation) {
      await window.keyboard.press("Control+k");
      const command = window.getByRole("option", {
        name: "/hold-open Start a controlled child process until Pi shuts down"
      });
      await command.waitFor({ state: "visible", timeout: 10_000 });
      await command.click();
      childPid = await readPositiveProcessId(childPidPath);
      if (!isProcessAlive(childPid)) throw new Error("Installed controlled Extension child exited before shutdown.");
    }

    const utilityPids = await application.evaluate(({ app }) => app.getAppMetrics()
      .filter((metric) => metric.type === "Utility")
      .map((metric) => metric.pid));
    if (utilityPids.length === 0) throw new Error("Installed Agent Host utility process was not observable.");

    const closeStartedAt = performance.now();
    await application.close();
    application = undefined;
    const closeDurationMs = performance.now() - closeStartedAt;
    if (closeDurationMs > 5_000) {
      throw new Error(`Installed application shutdown exceeded 5000ms: ${closeDurationMs.toFixed(1)}ms.`);
    }
    if (mainPid !== undefined) await waitForProcessExit(mainPid);
    for (const pid of utilityPids) await waitForProcessExit(pid);
    if (childPid !== undefined) await waitForProcessExit(childPid);

    return {
      closeDurationMs: round(closeDurationMs),
      legacyUserInterface,
      launchToReadyMs: round(performance.now() - startedAt),
      runtime: {
        appVersion: runtime.appVersion,
        electronVersion: runtime.electronVersion
      },
      rendererIsolationProbe: probePackagedRendererIsolation,
      utilityProcessCount: utilityPids.length
    };
  } finally {
    if (application) await application.close();
    if (childPid !== undefined && isProcessAlive(childPid)) process.kill(childPid);
  }
}

async function selectLightThemePreference(window, legacyUserInterface) {
  if (legacyUserInterface) {
    await window.getByRole("button", { name: /外观：跟随系统/u }).click();
    await window.getByRole("menuitemradio", { name: /浅色/u }).click();
    return;
  }
  await window.getByRole("button", { name: "打开更多菜单" }).click();
  await window.getByRole("menu").getByRole("menuitem", { name: /外观：浅色/u }).click();
}

async function waitForRuntimeReady(window, legacyUserInterface) {
  const ready = legacyUserInterface
    ? window.getByText("Pi SDK 已就绪", { exact: true })
    : window.getByLabel("当前状态：Pi SDK 已就绪");
  await ready.waitFor({ state: "visible", timeout: 30_000 });
}

function round(value) {
  return Math.round(value * 10) / 10;
}
