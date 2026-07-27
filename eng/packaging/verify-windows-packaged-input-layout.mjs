import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { release, version } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSingleShutdownQuitLifecycle,
  isProcessAlive,
  readPositiveProcessId,
  waitForProcessExit,
  writeControlledShutdownExtension
} from "./controlled-shutdown-fixture.ts";
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

export const WINDOWS_SYNTHETIC_SCALE_FACTORS = [1.25, 1.5, 2];

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

  try {
    for (const scaleFactor of WINDOWS_SYNTHETIC_SCALE_FACTORS) {
      report.scenarios.push(await verifyScaleScenario(artifact, scaleFactor));
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
  }
}

async function verifyScaleScenario(artifact, scaleFactor) {
  const scaleLabel = String(Math.round(scaleFactor * 100));
  const directories = await createPackagedTestDirectories(
    `pi67-windows-ui-${scaleLabel}-`,
    "中文长路径 包含空格的 Pi-67 Desktop 工作区验证"
  );
  const childPidPath = join(directories.userDataDirectory, "child.pid");
  const lifecyclePath = join(directories.userDataDirectory, "lifecycle.txt");
  await writeControlledShutdownExtension({
    extensionPath: join(directories.extensionsDirectory, "windows-ui-fixture.ts"),
    childPidPath,
    lifecyclePath
  });

  let application;
  let childPid;
  try {
    application = await launchPackagedApplication({
      agentDir: directories.agentDir,
      applicationArguments: [`--force-device-scale-factor=${scaleFactor}`],
      artifact,
      userDataDirectory: directories.userDataDirectory
    });
    const window = await application.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.getByRole("button", { name: "选择工作区" }).waitFor({ state: "visible", timeout: 15_000 });
    await installWorkspaceDialogResult(application, directories.workspace);
    await window.getByRole("button", { name: "选择工作区" }).click();
    await window.getByLabel("当前状态：Pi SDK 已就绪").waitFor({ state: "visible", timeout: 30_000 });
    if (window.url() !== "app://pi67/index.html") {
      throw new Error(`Scale ${scaleFactor}: unexpected packaged renderer URL ${window.url()}.`);
    }

    const runtime = await application.evaluate(({ app }) => ({
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron
    }));
    await startControlledOperation(window);
    childPid = await readPositiveProcessId(childPidPath);

    const { contextViewport, navigationViewport } = await verifyPackagedResponsiveLayout(
      window,
      application,
      scaleFactor
    );
    const composition = await verifySyntheticComposition(window, scaleFactor);
    const screenshotPath = join(outputDirectory, `scale-${scaleLabel}.png`);
    await window.screenshot({ animations: "disabled", path: screenshotPath });

    await application.close();
    application = undefined;
    await waitForProcessExit(childPid);
    await assertSingleShutdownQuitLifecycle(
      lifecyclePath,
      `Scale ${scaleFactor}: controlled Runtime`
    );

    return {
      composition,
      contextViewport,
      navigationViewport,
      requestedScaleFactor: scaleFactor,
      runtime,
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

export async function verifyPackagedResponsiveLayout(window, application, scaleFactor) {
  return {
    contextViewport: await verifyContextDrawerLayout(window, application, scaleFactor),
    navigationViewport: await verifyNavigationDrawerLayout(window, application, scaleFactor)
  };
}

async function startControlledOperation(window) {
  await window.keyboard.press("Control+k");
  const command = window.getByRole("option", {
    name: "/hold-open Start a controlled child process until Pi shuts down"
  });
  await command.waitFor({ state: "visible", timeout: 10_000 });
  await command.click();
  await window.getByRole("button", { name: "停止" }).waitFor({ state: "visible", timeout: 10_000 });
}

async function verifyContextDrawerLayout(window, application, scaleFactor) {
  await setStableContentViewport(window, application, 1_040, 800);
  await window.getByLabel("会话上下文").waitFor({ state: "detached" });
  const contextToggle = window.getByRole("button", { name: "显示上下文" });
  await contextToggle.click();
  await window.getByLabel("会话上下文").waitFor({ state: "visible" });
  await window.getByRole("button", { name: "关闭上下文抽屉" }).waitFor({ state: "visible" });

  const observation = await observeLayout(window);
  assertLayoutObservation(observation, {
    breakpoint: "context-drawer",
    expectedWidth: 1_040,
    requestedScaleFactor: scaleFactor
  });
  if (!observation.contextDrawerVisible) {
    throw new Error(`Scale ${scaleFactor}: context drawer is not visible at the 1040px breakpoint.`);
  }

  await window.getByRole("button", { name: "关闭上下文抽屉" }).click();
  await window.getByLabel("会话上下文").waitFor({ state: "detached" });
  await waitForFocus(window, "显示上下文");
  return observation;
}

async function verifyNavigationDrawerLayout(window, application, scaleFactor) {
  await setStableContentViewport(window, application, 760, 800);
  const navigation = window.getByLabel("会话导航", { exact: true });
  await navigation.waitFor({ state: "hidden" });
  const navigationToggle = window.getByRole("button", { name: "显示会话导航" });
  await navigationToggle.click();
  await navigation.waitFor({ state: "visible" });
  await window.getByRole("button", { name: "关闭会话导航" }).waitFor({ state: "visible" });

  const observation = await observeLayout(window);
  assertLayoutObservation(observation, {
    breakpoint: "navigation-drawer",
    expectedWidth: 760,
    requestedScaleFactor: scaleFactor
  });
  if (!observation.navigationDrawerVisible) {
    throw new Error(`Scale ${scaleFactor}: navigation drawer is not visible at the 760px breakpoint.`);
  }

  await window.getByRole("button", { name: "关闭会话导航" }).click();
  await navigation.waitFor({ state: "hidden" });
  await waitForFocus(window, "显示会话导航");
  return observation;
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

async function setStableContentViewport(window, application, width, height) {
  await setPackagedContentSize(application, width, height);
  await window.waitForFunction((expected) => (
    Math.abs(window.innerWidth - expected.width) <= 1
    && Math.abs(window.innerHeight - expected.height) <= 1
  ), { height, width });
  await window.evaluate(() => new Promise((resolvePromise) => {
    requestAnimationFrame(() => requestAnimationFrame(resolvePromise));
  }));
}

async function waitForFocus(window, label) {
  await window.waitForFunction((expectedLabel) => (
    document.activeElement?.getAttribute("aria-label") === expectedLabel
  ), label);
}

async function observeLayout(window) {
  return window.evaluate(() => {
    const rect = (element) => element ? rectangle(element.getBoundingClientRect()) : null;
    const composer = document.querySelector(".composer-shell");
    const contextDrawer = document.querySelector(".context-pane");
    const navigationDrawer = document.querySelector(".navigation-rail");
    const send = [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "发送");
    const stop = [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "停止");
    const titleBar = document.querySelector(".title-bar");
    const titleActions = document.querySelector(".title-actions");
    const actionControls = titleActions
      ? [...titleActions.querySelectorAll("button, [role='button']")]
      : [];
    const rightmostActionControl = actionControls.reduce((right, element) => (
      Math.max(right, element.getBoundingClientRect().right)
    ), 0);
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    return {
      composer: rect(composer),
      contextDrawerVisible: contextDrawer !== null && getComputedStyle(contextDrawer).display !== "none",
      devicePixelRatio: window.devicePixelRatio,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      matchesContextBreakpoint: window.matchMedia("(max-width: 1040px)").matches,
      matchesNavigationBreakpoint: window.matchMedia("(max-width: 760px)").matches,
      navigationDrawerVisible: navigationDrawer !== null && getComputedStyle(navigationDrawer).display !== "none",
      send: controlObservation(send, viewportWidth, viewportHeight),
      stop: controlObservation(stop, viewportWidth, viewportHeight),
      titleBar: rect(titleBar),
      titleBarNativeControlReserve: window.innerWidth - rightmostActionControl,
      visualViewportHeight: viewportHeight,
      visualViewportWidth: viewportWidth
    };

    function rectangle(value) {
      return {
        bottom: value.bottom,
        height: value.height,
        left: value.left,
        right: value.right,
        top: value.top,
        width: value.width
      };
    }

    function controlObservation(element, width, height) {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      const topmost = document.elementFromPoint(value.left + value.width / 2, value.top + value.height / 2);
      return {
        contained: value.left >= 0 && value.top >= 0 && value.right <= width && value.bottom <= height,
        rect: rectangle(value),
        topmost: topmost === element || (topmost !== null && element.contains(topmost))
      };
    }
  });
}

export function assertLayoutObservation(observation, contract) {
  const prefix = `Scale ${contract.requestedScaleFactor} ${contract.breakpoint}`;
  if (Math.abs(observation.devicePixelRatio - contract.requestedScaleFactor) > 0.05) {
    throw new Error(`${prefix}: expected DPR ${contract.requestedScaleFactor}, got ${observation.devicePixelRatio}.`);
  }
  if (Math.abs(observation.innerWidth - contract.expectedWidth) > 1) {
    throw new Error(`${prefix}: expected innerWidth ${contract.expectedWidth}, got ${observation.innerWidth}.`);
  }
  if (contract.breakpoint === "context-drawer" && !observation.matchesContextBreakpoint) {
    throw new Error(`${prefix}: max-width 1040px media query did not match.`);
  }
  if (contract.breakpoint === "navigation-drawer" && !observation.matchesNavigationBreakpoint) {
    throw new Error(`${prefix}: max-width 760px media query did not match.`);
  }
  if (observation.horizontalOverflow > 1) {
    throw new Error(`${prefix}: document overflows horizontally by ${observation.horizontalOverflow}px.`);
  }
  if (!observation.composer || !observation.titleBar) {
    throw new Error(`${prefix}: Composer or TitleBar geometry is unavailable.`);
  }
  for (const [name, control] of [["Send", observation.send], ["Stop", observation.stop]]) {
    if (!control?.contained || !control.topmost) {
      throw new Error(`${prefix}: ${name} is clipped or covered.`);
    }
  }
  if (observation.titleBarNativeControlReserve < 136) {
    throw new Error(
      `${prefix}: title actions reserve only ${observation.titleBarNativeControlReserve}px for native Windows controls.`
    );
  }
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyWindowsPackagedInputLayout();
}
