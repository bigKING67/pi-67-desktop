import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { release, tmpdir, version } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isProcessAlive,
  readPositiveProcessId,
  writeControlledShutdownExtension
} from "./controlled-shutdown-fixture.ts";
import { startControlledPrompt } from "./controlled-provider-interaction.mjs";
import {
  measureElectronApplicationShutdown,
  productShutdownWithinBudget
} from "./electron-shutdown-measurement.mjs";
import {
  assertPackagedRuntimeAssets,
  cleanupPackagedTestDirectories,
  createPackagedTestDirectories,
  installWorkspaceDialogResult,
  launchPackagedApplication,
  repositoryRoot,
  resolvePackagedArtifact,
  setPackagedContentSize
} from "./packaged-electron-fixture.mjs";
import {
  captureProcessOutput
} from "./packaged-electron-smoke-scenarios.mjs";
import { parseInitializationObservations } from "./windows-real-user-initialization.mjs";
import {
  assertLayoutObservation,
  observeLayout,
  WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX
} from "./windows-layout-observation.mjs";
export {
  assertLayoutObservation,
  viewportWidthMatches,
  WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX
} from "./windows-layout-observation.mjs";

export const WINDOWS_SYNTHETIC_SCALE_FACTORS = [1.25, 1.5, 2];
export const WINDOWS_SYNTHETIC_RUNTIME_TIMEOUT_MS = 60_000;
export const WINDOWS_SYNTHETIC_SHUTDOWN_BUDGET_MS = 5_000;

const outputDirectory = join(repositoryRoot, "artifacts/validation/windows-packaged-ui");
const summaryPath = join(outputDirectory, "summary.json");

export async function verifyWindowsPackagedInputLayout() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(`Windows packaged UI verification requires win32/x64, got ${process.platform}/${process.arch}.`);
  }

  const artifact = resolvePackagedArtifact();
  await assertPackagedRuntimeAssets(artifact);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const report = {
    schemaVersion: 1,
    status: "running",
    evidenceLevel: "windows-packaged-synthetic-scale-and-composition",
    host: {
      arch: process.arch,
      osRelease: release(),
      osVersion: version(),
      platform: process.platform,
      runnerName: process.env.RUNNER_NAME ?? null
    },
    artifact: {
      executableSha256: await hashFile(artifact.executablePath)
    },
    scenarios: []
  };
  await writeReport(report);
  const sharedAgentDirectory = await mkdtemp(join(tmpdir(), "pi67-windows-ui-agent-"));
  await mkdir(join(sharedAgentDirectory, "extensions"), { recursive: true });

  try {
    for (const scaleFactor of WINDOWS_SYNTHETIC_SCALE_FACTORS) {
      report.scenarios.push(await verifyScaleScenario(artifact, scaleFactor, sharedAgentDirectory));
      await writeReport(report);
    }
    report.status = "passed";
    await writeReport(report);
    console.log(
      `Windows packaged synthetic-scale UI smoke passed at ${WINDOWS_SYNTHETIC_SCALE_FACTORS.join(", ")} DPR targets. `
      + `Evidence: ${relative(repositoryRoot, summaryPath)}.`
    );
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? error.message : String(error);
    await writeReport(report);
    throw error;
  } finally {
    await rm(sharedAgentDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function verifyScaleScenario(artifact, scaleFactor, agentDirectory) {
  const scaleLabel = String(Math.round(scaleFactor * 100));
  const directories = await createPackagedTestDirectories(
    `pi67-windows-ui-${scaleLabel}-`,
    "中文长路径 包含空格的 Pi-67 Desktop 工作区验证"
  );
  const childPidPath = join(directories.userDataDirectory, "child.pid");
  const lifecyclePath = join(directories.userDataDirectory, "lifecycle.txt");
  await writeControlledShutdownExtension({
    extensionPath: join(agentDirectory, "extensions", "windows-ui-fixture.ts"),
    childPidPath,
    lifecyclePath
  });

  let application;
  let childPid;
  let processOutput = () => "";
  try {
    application = await launchPackagedApplication({
      agentDir: agentDirectory,
      applicationArguments: [`--force-device-scale-factor=${scaleFactor}`],
      artifact,
      environment: { PI67_TEST_CAPTURE_AGENT_INIT: "1" },
      userDataDirectory: directories.userDataDirectory
    });
    processOutput = captureProcessOutput(application.process());
    const window = await application.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.getByRole("button", { name: "选择工作区" }).waitFor({ state: "visible", timeout: 15_000 });
    await installWorkspaceDialogResult(application, directories.workspace);
    await window.getByRole("button", { name: "选择工作区" }).click();
    await waitForWindowsSyntheticRuntimeReady(window, processOutput, scaleFactor);
    if (window.url() !== "app://pi67/index.html") {
      throw new Error(`Scale ${scaleFactor}: unexpected packaged renderer URL ${window.url()}.`);
    }

    const runtime = await application.evaluate(({ app }) => ({
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron
    }));
    await startControlledPrompt(window);
    childPid = await readPositiveProcessId(childPidPath);
    const utilityPids = await application.evaluate(({ app }) => app.getAppMetrics()
      .filter((metric) => metric.type === "Utility")
      .map((metric) => metric.pid));
    const mainPid = application.process().pid;

    const { contextViewport, navigationViewport } = await verifyPackagedResponsiveLayout(
      window,
      application,
      scaleFactor
    );
    const composition = await verifySyntheticComposition(window, scaleFactor);
    const screenshotPath = join(outputDirectory, `scale-${scaleLabel}.png`);
    await window.screenshot({ animations: "disabled", path: screenshotPath });

    // Packaged smoke owns session_shutdown(reason=quit); this UI gate repeats the
    // independent no-leaked-process boundary for its responsive/IME scenario.
    const shutdownMeasurement = await measureElectronApplicationShutdown({
      application,
      budgetMs: WINDOWS_SYNTHETIC_SHUTDOWN_BUDGET_MS,
      childPid,
      mainPid,
      utilityPids
    });
    application = undefined;
    const shutdown = {
      budgetMs: WINDOWS_SYNTHETIC_SHUTDOWN_BUDGET_MS,
      driverCloseDurationMs: round(shutdownMeasurement.driverCloseDurationMs),
      processes: shutdownMeasurement.processes,
      productExitDurationMs: round(shutdownMeasurement.productExitDurationMs)
    };
    if (!productShutdownWithinBudget(shutdownMeasurement, WINDOWS_SYNTHETIC_SHUTDOWN_BUDGET_MS)) {
      throw new Error(
        `Scale ${scaleFactor}: packaged process shutdown exceeded ${WINDOWS_SYNTHETIC_SHUTDOWN_BUDGET_MS}ms. `
        + `Diagnostics: ${JSON.stringify(shutdown)}`
      );
    }

    return {
      composition,
      contextViewport,
      navigationViewport,
      requestedScaleFactor: scaleFactor,
      runtime,
      shutdown,
      screenshot: {
        path: relative(repositoryRoot, screenshotPath),
        sha256: await hashFile(screenshotPath)
      }
    };
  } finally {
    try {
      if (application) await application.close();
      if (childPid !== undefined && isProcessAlive(childPid)) process.kill(childPid);
    } finally {
      await cleanupPackagedTestDirectories(directories.userDataDirectory);
    }
  }
}

export async function waitForWindowsSyntheticRuntimeReady(
  window,
  processOutput,
  scaleFactor,
  timeoutMs = WINDOWS_SYNTHETIC_RUNTIME_TIMEOUT_MS
) {
  const ready = window.locator('[data-runtime-phase="ready"]');
  const failed = window.locator('[data-runtime-phase="failed"]');
  try {
    await ready.or(failed).waitFor({ state: "visible", timeout: timeoutMs });
    if (await failed.isVisible()) throw new Error("Pi SDK entered the failed runtime phase.");
  } catch (error) {
    const diagnostic = {
      initialization: parseInitializationObservations(processOutput()),
      surface: await inspectWindowsSyntheticRuntimeSurface(window)
    };
    throw new Error(
      `Scale ${scaleFactor}: packaged runtime did not become ready within ${timeoutMs}ms. `
      + `Diagnostics: ${JSON.stringify(diagnostic)}`,
      { cause: error }
    );
  }
}

export function inspectWindowsSyntheticRuntimeSurface(window) {
  return window.evaluate(() => {
    const bodyText = document.body.innerText;
    const runtimeStatus = document.querySelector("[data-runtime-phase]");
    const workspacePickerVisible = [...document.querySelectorAll("button")].some((button) => (
      button.textContent?.trim() === "选择工作区"
      && button.getBoundingClientRect().width > 0
      && button.getBoundingClientRect().height > 0
    ));
    return {
      acknowledgementTimedOut: bodyText.includes("Agent request acknowledgement timed out"),
      conversationRowCount: document.querySelectorAll('[data-testid="conversation-row"]').length,
      runtimePhase: runtimeStatus?.getAttribute("data-runtime-phase") ?? null,
      title: document.title,
      url: location.href,
      workspaceOpenFailed: bodyText.includes("无法打开工作区"),
      workspacePickerVisible
    };
  });
}

export async function verifyPackagedResponsiveLayout(window, application, scaleFactor) {
  await prepareResponsiveLayoutControls(window);
  return {
    contextViewport: await verifyContextDrawerLayout(window, application, scaleFactor),
    navigationViewport: await verifyNavigationDrawerLayout(window, application, scaleFactor)
  };
}

export async function prepareResponsiveLayoutControls(window) {
  await window.getByLabel("给 Pi 发送消息").fill("Windows packaged responsive layout probe");
  await Promise.all([
    window.getByRole("button", { name: "发送", exact: true }).waitFor({ state: "visible" }),
    window.getByRole("button", { name: "停止", exact: true }).waitFor({ state: "visible" })
  ]);
}

export function locateTaskInspector(window) {
  return window.getByRole("complementary", { name: "任务检查器", exact: true });
}

async function verifyContextDrawerLayout(window, application, scaleFactor) {
  await setStableContentViewport(window, application, WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX, 800);
  const taskInspector = locateTaskInspector(window);
  await taskInspector.waitFor({ state: "detached" });
  const contextToggle = window.getByRole("button", { name: "显示任务检查器" });
  await contextToggle.click();
  await taskInspector.waitFor({ state: "visible" });
  await window.getByRole("button", { name: "关闭任务检查器抽屉" }).waitFor({ state: "visible" });

  const drawerObservation = await observeLayout(window);
  await captureResponsiveScreenshot(window, scaleFactor, "context-drawer");
  assertLayoutObservation(drawerObservation, {
    breakpoint: "context-drawer",
    expectedControlLayer: "context-drawer",
    expectedWidth: WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX,
    requestedScaleFactor: scaleFactor
  });
  if (!drawerObservation.contextDrawerVisible) {
    throw new Error(
      `Scale ${scaleFactor}: context drawer is not visible at the ${WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX}px breakpoint.`
    );
  }

  await window.getByRole("button", { name: "关闭任务检查器抽屉" }).click();
  await taskInspector.waitFor({ state: "detached" });
  await waitForFocus(window, "显示任务检查器");
  const observation = await observeLayout(window);
  assertLayoutObservation(observation, {
    breakpoint: "context-drawer",
    expectedWidth: WINDOWS_CONTEXT_DRAWER_BREAKPOINT_PX,
    requestedScaleFactor: scaleFactor
  });
  return { ...observation, drawer: drawerObservation };
}

async function verifyNavigationDrawerLayout(window, application, scaleFactor) {
  await setStableMinimumWindowWidth(window, application, 760);
  const navigation = window.getByLabel("会话导航", { exact: true });
  await navigation.waitFor({ state: "hidden" });
  const navigationToggle = window.getByRole("button", { name: "显示会话导航" });
  await navigationToggle.click();
  await navigation.waitFor({ state: "visible" });
  await window.getByRole("button", { name: "关闭会话导航" }).waitFor({ state: "visible" });

  const drawerObservation = await observeLayout(window);
  await captureResponsiveScreenshot(window, scaleFactor, "navigation-drawer");
  assertLayoutObservation(drawerObservation, {
    allowNativeFrameFloor: true,
    breakpoint: "navigation-drawer",
    expectedControlLayer: "navigation-drawer",
    expectedWidth: 760,
    requestedScaleFactor: scaleFactor
  });
  if (!drawerObservation.navigationDrawerVisible) {
    throw new Error(`Scale ${scaleFactor}: navigation drawer is not visible at the 760px breakpoint.`);
  }

  await window.getByRole("button", { name: "关闭会话导航" }).click();
  await navigation.waitFor({ state: "hidden" });
  await waitForFocus(window, "显示会话导航");
  const observation = await observeLayout(window);
  assertLayoutObservation(observation, {
    allowNativeFrameFloor: true,
    breakpoint: "navigation-drawer",
    expectedWidth: 760,
    requestedScaleFactor: scaleFactor
  });
  return { ...observation, drawer: drawerObservation };
}

async function captureResponsiveScreenshot(window, scaleFactor, surface) {
  const scaleLabel = String(Math.round(scaleFactor * 100));
  await window.screenshot({
    animations: "disabled",
    path: join(outputDirectory, `scale-${scaleLabel}-${surface}.png`)
  });
}

async function verifySyntheticComposition(window, scaleFactor) {
  const composer = window.getByLabel("给 Pi 发送消息");
  const draft = `DPR ${scaleFactor} 微软拼音候选确认测试`;
  await composer.fill(draft);
  const result = await composer.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "微软拼音" }));
    const composingEnter = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      isComposing: true,
      key: "Enter"
    });
    const composingDispatched = element.dispatchEvent(composingEnter);
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "微软拼音" }));
    const legacyEnter = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter"
    });
    Object.defineProperty(legacyEnter, "keyCode", { configurable: true, value: 229 });
    const legacyDispatched = element.dispatchEvent(legacyEnter);
    return {
      composing: {
        defaultPrevented: composingEnter.defaultPrevented,
        dispatched: composingDispatched
      },
      legacy229: {
        defaultPrevented: legacyEnter.defaultPrevented,
        dispatched: legacyDispatched
      },
      value: element.value
    };
  });
  if (
    !result.composing.dispatched
    || result.composing.defaultPrevented
    || !result.legacy229.dispatched
    || result.legacy229.defaultPrevented
    || result.value !== draft
  ) {
    throw new Error(`Scale ${scaleFactor}: synthetic IME Enter changed or submitted the Composer draft.`);
  }
  return result;
}

async function setStableContentViewport(
  window,
  application,
  width,
  height
) {
  await setPackagedContentSize(application, width, height);
  await window.waitForFunction((expected) => (
    Math.abs(window.innerWidth - expected.width) <= 1
    && Math.abs(window.innerHeight - expected.height) <= 1
  ), { height, width });
  await waitForTwoAnimationFrames(window);
}

async function setStableMinimumWindowWidth(window, application, width) {
  await application.evaluate(({ BrowserWindow }, minimumWidth) => {
    const browserWindow = BrowserWindow.getAllWindows()[0];
    if (!browserWindow) throw new Error("Packaged BrowserWindow is unavailable.");
    const [, currentHeight] = browserWindow.getSize();
    browserWindow.setSize(minimumWidth, currentHeight);
  }, width);
  await window.waitForFunction((expectedWidth) => (
    window.innerWidth <= expectedWidth + 1
  ), width);
  await waitForTwoAnimationFrames(window);
}

async function waitForTwoAnimationFrames(window) {
  await window.evaluate(() => new Promise((resolvePromise) => {
    requestAnimationFrame(() => requestAnimationFrame(resolvePromise));
  }));
}

async function waitForFocus(window, label) {
  await window.waitForFunction((expectedLabel) => (
    document.activeElement?.getAttribute("aria-label") === expectedLabel
  ), label);
}

async function writeReport(report) {
  await writeFile(summaryPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function hashFile(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolvePromise(hash.digest("hex")));
  });
}

function round(value) {
  return value === null || value === undefined ? null : Math.round(value * 10) / 10;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyWindowsPackagedInputLayout();
}
