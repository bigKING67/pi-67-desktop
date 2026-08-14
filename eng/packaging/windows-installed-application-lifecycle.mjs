import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CONTROL_MUTATION_ACK_TIMEOUT_MS } from "@pi67/protocol";
import { lt as semverLessThan, valid as validSemver } from "semver";
import {
  CONTROLLED_PROMPT_TEXT,
  isProcessAlive,
  readPositiveProcessId,
  waitForProcessExit
} from "./controlled-shutdown-fixture.ts";
import {
  measureElectronApplicationShutdown,
  productShutdownWithinBudget
} from "./electron-shutdown-measurement.mjs";
import {
  installWorkspaceDialogResult,
  launchPackagedApplication
} from "./packaged-electron-fixture.mjs";
import {
  captureProcessOutput,
  openSettingsSection
} from "./packaged-electron-smoke-scenarios.mjs";
import { startControlledPrompt } from "./controlled-provider-interaction.mjs";

const RUNTIME_READINESS_PROPAGATION_MARGIN_MS = 15_000;
export const INSTALLED_SHUTDOWN_BUDGET_MS = 5_000;

export const INSTALLED_RUNTIME_READINESS_TIMEOUT_MS =
  CONTROL_MUTATION_ACK_TIMEOUT_MS + RUNTIME_READINESS_PROPAGATION_MARGIN_MS;
export const WINDOWS_SETTINGS_WORKBENCH_VERSION = "0.1.0-alpha.8";

export function resolveInstalledUserInterfaceContract(version) {
  if (!validSemver(version)) {
    throw new Error(`Invalid version for installed user interface contract: ${String(version)}.`);
  }
  const legacyUserInterface = semverLessThan(version, WINDOWS_SETTINGS_WORKBENCH_VERSION);
  return {
    legacyUserInterface,
    runtimeReadiness: legacyUserInterface ? "legacy-exact-label" : "runtime-phase-and-conversation",
    settingsFlow: legacyUserInterface ? "legacy-toolbar-menu" : "settings-workbench"
  };
}

export async function launchInstalledApplication({
  activeControlledOperation,
  agentDir,
  artifact,
  childPidPath,
  expectedTheme,
  legacyUserInterface,
  lifecyclePath,
  probePackagedRendererIsolation,
  selectLightTheme,
  userDataDirectory,
  workspace
}) {
  if (activeControlledOperation && (typeof childPidPath !== "string" || childPidPath.length === 0)) {
    throw new Error("Installed controlled operation requires a child PID path.");
  }

  let application;
  let childPid;
  let restoredActivation;
  try {
    const startedAt = performance.now();
    application = await launchPackagedApplication({
      agentDir,
      artifact,
      probePackagedRendererIsolation,
      userDataDirectory
    });
    const packagedProcessOutput = captureProcessOutput(application.process());
    const mainPid = application.process().pid;
    const window = await application.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    const startupSurface = await waitForInstalledStartupSurface(window, legacyUserInterface);
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

    if (selectLightTheme && legacyUserInterface) {
      await selectLightThemePreference(window, legacyUserInterface);
      await window.locator('html[data-theme-preference="light"][data-theme="light"]').waitFor({ state: "attached" });
    }

    if (startupSurface === "workspace-picker") {
      await installWorkspaceDialogResult(application, workspace);
      await window.getByRole("button", { name: "选择工作区" }).click();
      await waitForRuntimeReady(window, legacyUserInterface);
    } else if (startupSurface === "workspace-restored") {
      restoredActivation = await activateRestoredWorkspace(window);
      try {
        await waitForRuntimeReady(window, legacyUserInterface);
      } catch (error) {
        throw new Error(
          [
            `Installed restored Workspace did not become ready after ${restoredActivation}: ${errorMessage(error)}`,
            `Runtime diagnostics: ${JSON.stringify(await inspectInstalledRuntimeState(window))}`,
            packagedProcessOutput() || "No installed process diagnostics were emitted."
          ].join("\n"),
          { cause: error }
        );
      }
    }

    if (selectLightTheme && !legacyUserInterface) {
      await selectLightThemePreference(window, legacyUserInterface);
      await window.locator('html[data-theme-preference="light"][data-theme="light"]').waitFor({ state: "attached" });
    }

    if (activeControlledOperation) {
      await startControlledPrompt(window);
      await waitForControlledPromptProjection(window);
      childPid = await readPositiveProcessId(childPidPath);
      if (!isProcessAlive(childPid)) throw new Error("Installed controlled Extension child exited before shutdown.");
    }

    const utilityPids = await application.evaluate(({ app }) => app.getAppMetrics()
      .filter((metric) => metric.type === "Utility")
      .map((metric) => metric.pid));
    if (utilityPids.length === 0) throw new Error("Installed Agent Host utility process was not observable.");

    const lifecycleBeforeClose = await inspectInstalledShutdownLifecycle(lifecyclePath);
    const shutdownMeasurement = await measureElectronApplicationShutdown({
      application,
      budgetMs: INSTALLED_SHUTDOWN_BUDGET_MS,
      childPid,
      mainPid,
      utilityPids
    });
    application = undefined;
    const lifecycleAfterClose = await inspectInstalledShutdownLifecycle(lifecyclePath);
    const shutdown = {
      activeControlledOperation,
      budgetMs: INSTALLED_SHUTDOWN_BUDGET_MS,
      closeDurationMs: round(shutdownMeasurement.productExitDurationMs),
      driverCloseDurationMs: round(shutdownMeasurement.driverCloseDurationMs),
      lifecycle: {
        afterClose: lifecycleAfterClose,
        beforeClose: lifecycleBeforeClose
      },
      processes: shutdownMeasurement.processes
    };
    if (!productShutdownWithinBudget(shutdownMeasurement, INSTALLED_SHUTDOWN_BUDGET_MS)) {
      throw new Error(
        `Installed product process shutdown exceeded ${INSTALLED_SHUTDOWN_BUDGET_MS}ms. `
        + `Shutdown diagnostics: ${JSON.stringify(shutdown)}`
      );
    }
    if (mainPid !== undefined) await waitForProcessExit(mainPid);
    for (const pid of utilityPids) await waitForProcessExit(pid);
    if (childPid !== undefined) await waitForProcessExit(childPid);

    return {
      closeDurationMs: round(shutdownMeasurement.productExitDurationMs),
      driverCloseDurationMs: round(shutdownMeasurement.driverCloseDurationMs),
      legacyUserInterface,
      launchToReadyMs: round(performance.now() - startedAt),
      runtime: {
        appVersion: runtime.appVersion,
        electronVersion: runtime.electronVersion
      },
      rendererIsolationProbe: probePackagedRendererIsolation,
      startupSurface,
      ...(restoredActivation ? { restoredActivation } : {}),
      shutdown,
      utilityProcessCount: utilityPids.length
    };
  } finally {
    if (application) await application.close();
    if (childPid !== undefined && isProcessAlive(childPid)) process.kill(childPid);
  }
}

export async function inspectInstalledShutdownLifecycle(path) {
  const content = await readFile(path, "utf8").catch(() => undefined);
  if (content === undefined) {
    return {
      available: false,
      entryCount: 0,
      otherEntryCount: 0,
      quitEntryCount: 0
    };
  }
  const entries = content.split(/\r?\n/u).filter(Boolean);
  const quitEntryCount = entries.filter((entry) => entry === "shutdown:quit").length;
  return {
    available: true,
    entryCount: entries.length,
    otherEntryCount: entries.length - quitEntryCount,
    quitEntryCount
  };
}

export async function waitForControlledPromptProjection(window) {
  await window.locator('[data-testid="conversation-row"]')
    .filter({ hasText: CONTROLLED_PROMPT_TEXT })
    .waitFor({ state: "visible", timeout: 10_000 });
  await window.locator(".brand-lockup")
    .getByText(CONTROLLED_PROMPT_TEXT, { exact: true })
    .waitFor({ state: "visible", timeout: 10_000 });
}

export function readSelectedConversationIdentity(window) {
  return window.locator('[data-testid="conversation-row"][aria-current="page"]')
    .evaluateAll((rows) => rows[0]?.getAttribute("data-conversation-id") ?? null);
}

export async function selectLightThemePreference(window, legacyUserInterface) {
  if (legacyUserInterface) {
    await window.getByRole("button", { name: /外观：跟随系统/u }).click();
    await window.getByRole("menuitemradio", { name: /浅色/u }).click();
    return;
  }
  const settings = await openSettingsSection(window, /^外观/u);
  await settings.getByRole("button", { name: /^浅色/u }).click();
  await settings.getByRole("button", { name: "返回工作台", exact: true }).click();
  await settings.waitFor({ state: "hidden", timeout: 15_000 });
}

export async function waitForInstalledStartupSurface(window, legacyUserInterface) {
  const workspacePicker = window.getByRole("button", { name: "选择工作区" });
  const runtimeReady = runtimeReadyLocator(window, legacyUserInterface);
  const restoredWorkspace = window.getByLabel("Pi conversation")
    .or(window.getByRole("button", { name: "恢复任务", exact: true }))
    .or(window.getByRole("button", { name: "打开会话", exact: true }))
    .or(window.getByRole("button", { name: "新建会话", exact: true }));
  await workspacePicker.or(runtimeReady).or(restoredWorkspace)
    .waitFor({ state: "visible", timeout: 30_000 });
  if (await workspacePicker.isVisible()) return "workspace-picker";
  return await runtimeReady.isVisible() ? "runtime-ready" : "workspace-restored";
}

export async function activateRestoredWorkspace(window) {
  if (await window.getByLabel("Pi conversation").isVisible()) return "conversation";

  for (const [name, result] of [
    ["恢复任务", "task-restored"],
    ["打开会话", "session-opened"],
    ["新建会话", "session-created"]
  ]) {
    const action = window.getByRole("button", { name, exact: true });
    if (await action.isVisible()) {
      await action.click();
      return result;
    }
  }

  throw new Error("Installed Workspace restore surface no longer exposed an activation action.");
}

export async function waitForRuntimeReady(window, legacyUserInterface) {
  const runtimeReady = runtimeReadyLocator(window, legacyUserInterface);
  if (legacyUserInterface) {
    await runtimeReady.waitFor({ state: "visible", timeout: 30_000 });
    return;
  }

  const startedAt = performance.now();
  const runtimeFailed = window.locator('[data-runtime-phase="failed"]');
  await runtimeReady.or(runtimeFailed).waitFor({
    state: "visible",
    timeout: INSTALLED_RUNTIME_READINESS_TIMEOUT_MS
  });
  if (await runtimeFailed.isVisible()) {
    const runtimeStatus = (await runtimeFailed.getAttribute("aria-label"))?.slice(0, 160);
    throw new Error(runtimeStatus
      ? `Installed runtime entered failed phase before becoming ready: ${runtimeStatus}`
      : "Installed runtime entered failed phase before becoming ready.");
  }

  const remainingTimeoutMs = Math.max(
    1,
    Math.ceil(INSTALLED_RUNTIME_READINESS_TIMEOUT_MS - (performance.now() - startedAt))
  );
  await window.getByLabel("Pi conversation").waitFor({
    state: "visible",
    timeout: remainingTimeoutMs
  });
}

function runtimeReadyLocator(window, legacyUserInterface) {
  return legacyUserInterface
    ? window.getByText("Pi SDK 已就绪", { exact: true })
    : window.locator('[data-runtime-phase="ready"]');
}

function inspectInstalledRuntimeState(window) {
  return window.evaluate(() => {
    const status = document.querySelector('[aria-label^="当前状态："]');
    const visible = (element) => Boolean(
      element
      && (element.getClientRects().length > 0 || element.getBoundingClientRect().width > 0)
    );
    const activationActions = Object.fromEntries(
      ["恢复任务", "打开会话", "新建会话"].map((name) => {
        const button = [...document.querySelectorAll("button")]
          .find((candidate) => candidate.textContent?.trim() === name);
        return [name, visible(button)];
      })
    );
    return {
      activationActions,
      conversationCount: document.querySelectorAll('[aria-label="Pi conversation"]').length,
      conversationRowCount: document.querySelectorAll('[data-testid="conversation-row"]').length,
      runtimePhase: status?.getAttribute("data-runtime-phase") ?? null,
      runtimeStatus: status?.getAttribute("aria-label")?.slice(0, 160) ?? null,
      workspacePickerVisible: visible(
        [...document.querySelectorAll("button")]
          .find((candidate) => candidate.textContent?.trim() === "选择工作区")
      )
    };
  });
}

function round(value) {
  return value === null || value === undefined ? null : Math.round(value * 10) / 10;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "Unknown installed runtime readiness failure.";
}
