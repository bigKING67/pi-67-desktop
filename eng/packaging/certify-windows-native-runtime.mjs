import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { hostname, release, version as osVersion } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  assertSingleShutdownQuitLifecycle,
  isProcessAlive,
  readPositiveProcessId,
  resetControlledShutdownLifecycle,
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
  resolvePackagedArtifact
} from "./packaged-electron-fixture.mjs";
import { verifyPackagedResponsiveLayout } from "./verify-windows-packaged-input-layout.mjs";
import { normalizeWindowsSignerThumbprint } from "./windows-artifact-identity.mjs";
import { readWindowsNativeCandidateBinding } from "./windows-native-candidate-binding.mjs";
import {
  WINDOWS_NATIVE_CERTIFICATION_SCALES
} from "./windows-native-certification-contract.mjs";
import {
  certifyMicrosoftPinyin,
  certifySleepResume,
  installNativeCertificationProtocolProbe,
  startControlledOperation
} from "./windows-native-certification-interactions.mjs";

export { WINDOWS_NATIVE_CERTIFICATION_SCALES } from "./windows-native-certification-contract.mjs";
const WORKFLOW_SCALE_TIMEOUT_MS = 15 * 60_000;

export async function certifyWindowsNativeRuntime(options) {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(`Windows native certification requires win32/x64, got ${process.platform}/${process.arch}.`);
  }
  if (options.interactionMode === "terminal" && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error("Windows native certification requires an interactive terminal and desktop session.");
  }

  const artifact = resolveCertificationArtifact(options.executablePath);
  await assertPackagedRuntimeAssets(artifact);
  const candidateBinding = await readWindowsNativeCandidateBinding({
    candidateIdentityPath: options.candidateIdentityPath,
    executablePath: artifact.executablePath,
    expectedRepository: options.expectedRepository,
    expectedRunAttempt: options.expectedCandidateRunAttempt,
    expectedRunId: options.expectedCandidateRunId,
    expectedSignerThumbprint: options.expectedSignerThumbprint,
    expectedSourceCommit: options.expectedSourceCommit,
    expectedSourceTag: options.expectedSourceTag,
    installerPath: options.installerPath
  });
  const artifactIdentity = candidateBinding.artifactIdentity;
  const scaleLabel = String(Math.round(options.expectedScale * 100));
  const outputDirectory = join(repositoryRoot, "artifacts/certification/windows-native", `scale-${scaleLabel}`);
  const reportPath = join(outputDirectory, "receipt.json");
  const screenshotPath = join(outputDirectory, "workspace.png");
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const directories = await createPackagedTestDirectories(
    `pi67-windows-native-${scaleLabel}-`,
    "中文路径 包含空格的 Windows 原生认证工作区"
  );
  const childPidPath = join(directories.userDataDirectory, "controlled-child.pid");
  const lifecyclePath = join(directories.userDataDirectory, "controlled-lifecycle.txt");
  await writeControlledShutdownExtension({
    extensionPath: join(directories.extensionsDirectory, "native-certification-fixture.ts"),
    childPidPath,
    lifecyclePath
  });

  const report = {
    schemaVersion: 1,
    status: "running",
    evidenceLevel: "interactive-windows-native-runtime",
    expectedScale: options.expectedScale,
    host: {
      arch: process.arch,
      osRelease: release(),
      osVersion: osVersion(),
      platform: process.platform,
      idSha256: hostIdentitySha256()
    },
    artifact: {
      executableName: basename(artifact.executablePath),
      ...artifactIdentity
    },
    candidate: candidateBinding.candidate,
    sleepRequired: options.sleep,
    interactionMode: options.interactionMode
  };
  await writeReport(reportPath, report);

  let application;
  let page;
  let childPid;
  const interaction = createCertificationInteraction(options.interactionMode);
  try {
    await interaction.question(
      `确认 Windows 显示缩放已设置为 ${scaleLabel}%，并且当前是本机交互式桌面会话。按 Enter 启动认证：`
    );
    ({ application, page } = await launchCertificationApplication(artifact, directories));
    if (options.interactionMode === "workflow") {
      await waitForExpectedNativeRuntimeScale(application, page, options.expectedScale);
      await application.close();
      application = undefined;
      // The DPI probe is not the certified instance; discard its shutdown evidence before relaunch.
      await resetControlledShutdownLifecycle(lifecyclePath);
      ({ application, page } = await launchCertificationApplication(artifact, directories));
    }
    const nativeRuntime = await observeNativeRuntime(application, page);
    assertNativeScale(nativeRuntime, options.expectedScale);
    report.coldStartedAtExpectedScale = true;
    await startControlledOperation(page);
    childPid = await readPositiveProcessId(childPidPath);
    const responsive = await verifyPackagedResponsiveLayout(page, application, options.expectedScale);
    const ime = await certifyMicrosoftPinyin(page, application, interaction);
    const sleep = options.sleep
      ? await certifySleepResume(page, application, interaction)
      : null;
    await page.screenshot({ animations: "disabled", path: screenshotPath });

    const utilityPids = await application.evaluate(({ app }) => app.getAppMetrics()
      .filter((metric) => metric.type === "Utility")
      .map((metric) => metric.pid));
    const closeStartedAt = performance.now();
    await application.close();
    application = undefined;
    const closeDurationMs = performance.now() - closeStartedAt;
    if (closeDurationMs > 5_000) {
      throw new Error(`Windows certified application shutdown exceeded 5000ms: ${closeDurationMs.toFixed(1)}ms.`);
    }
    await waitForProcessExit(childPid);
    for (const pid of utilityPids) await waitForProcessExit(pid);
    await assertSingleShutdownQuitLifecycle(lifecyclePath, "Windows certified Pi Runtime");

    Object.assign(report, {
      status: "passed",
      nativeRuntime,
      responsive,
      ime,
      sleep,
      shutdown: {
        closeDurationMs: round(closeDurationMs),
        controlledChildExited: true,
        utilityProcessCount: utilityPids.length
      },
      screenshot: {
        path: relative(repositoryRoot, screenshotPath),
        sha256: await hashFile(screenshotPath)
      }
    });
    await writeReport(reportPath, report);
    console.log(`Windows native certification passed. Receipt: ${relative(repositoryRoot, reportPath)}.`);
  } catch (error) {
    report.status = "failed";
    report.error = boundedErrorMessage(error, [directories.userDataDirectory, dirname(artifact.executablePath)]);
    await writeReport(reportPath, report);
    throw error;
  } finally {
    interaction.close();
    if (application) await application.close();
    if (childPid !== undefined && isProcessAlive(childPid)) process.kill(childPid);
    await cleanupPackagedTestDirectories(directories.userDataDirectory);
  }
}

async function launchCertificationApplication(artifact, directories) {
  let application;
  try {
    application = await launchPackagedApplication({
      agentDir: directories.agentDir,
      artifact,
      userDataDirectory: directories.userDataDirectory
    });
    const page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await installNativeCertificationProtocolProbe(page);
    await page.getByRole("button", { name: "选择工作区" }).waitFor({ state: "visible", timeout: 15_000 });
    await installWorkspaceDialogResult(application, directories.workspace);
    await page.getByRole("button", { name: "选择工作区" }).click();
    await page.getByLabel("当前状态：Pi SDK 已就绪").waitFor({ state: "visible", timeout: 30_000 });
    if (page.url() !== "app://pi67/index.html") {
      throw new Error(`Windows native certification loaded an unexpected renderer URL: ${page.url()}.`);
    }
    return { application, page };
  } catch (error) {
    if (application) await application.close();
    throw error;
  }
}

export function parseWindowsNativeCertificationArguments(argumentsList) {
  let expectedScale;
  let candidateIdentityPath;
  let executablePath;
  let expectedCandidateRunAttempt;
  let expectedCandidateRunId;
  let expectedRepository;
  let expectedSignerThumbprint;
  let expectedSourceCommit;
  let expectedSourceTag;
  let interactionMode = "terminal";
  let installerPath;
  let sleep = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--expected-scale") expectedScale = Number(argumentsList[++index]);
    else if (argument === "--candidate-identity") candidateIdentityPath = argumentsList[++index];
    else if (argument === "--executable") {
      executablePath = argumentsList[++index];
      if (executablePath === undefined) throw new Error("--executable requires a path.");
    }
    else if (argument === "--sleep") sleep = true;
    else if (argument === "--interaction-mode") {
      interactionMode = argumentsList[++index];
      if (!new Set(["terminal", "workflow"]).has(interactionMode)) {
        throw new Error("--interaction-mode must be terminal or workflow.");
      }
    }
    else if (argument === "--installer") installerPath = argumentsList[++index];
    else if (argument === "--expected-repository") expectedRepository = argumentsList[++index];
    else if (argument === "--expected-source-tag") expectedSourceTag = argumentsList[++index];
    else if (argument === "--expected-source-commit") expectedSourceCommit = argumentsList[++index];
    else if (argument === "--expected-candidate-run-id") expectedCandidateRunId = argumentsList[++index];
    else if (argument === "--expected-candidate-run-attempt") {
      expectedCandidateRunAttempt = argumentsList[++index];
    }
    else if (argument === "--expected-signer-thumbprint") {
      expectedSignerThumbprint = argumentsList[++index];
      if (expectedSignerThumbprint === undefined) {
        throw new Error("--expected-signer-thumbprint requires a value.");
      }
    }
    else throw new Error(`Unknown Windows certification argument: ${String(argument)}.`);
  }
  if (!WINDOWS_NATIVE_CERTIFICATION_SCALES.includes(expectedScale)) {
    throw new Error(`--expected-scale must be one of ${WINDOWS_NATIVE_CERTIFICATION_SCALES.join(", ")}.`);
  }
  if (executablePath !== undefined && (
    executablePath.length === 0
    || executablePath.includes("\r")
    || executablePath.includes("\n")
    || executablePath.includes("\u0000")
  )) {
    throw new Error("--executable must be a non-empty single-line path.");
  }
  for (const [name, value] of [
    ["--candidate-identity", candidateIdentityPath],
    ["--installer", installerPath],
    ["--expected-repository", expectedRepository],
    ["--expected-source-tag", expectedSourceTag],
    ["--expected-source-commit", expectedSourceCommit],
    ["--expected-candidate-run-id", expectedCandidateRunId],
    ["--expected-candidate-run-attempt", expectedCandidateRunAttempt]
  ]) {
    if (typeof value !== "string"
      || value.length === 0
      || value.includes("\r")
      || value.includes("\n")
      || value.includes("\u0000")) {
      throw new Error(`${name} requires a non-empty single-line value.`);
    }
  }
  return {
    candidateIdentityPath,
    executablePath,
    expectedCandidateRunAttempt,
    expectedCandidateRunId,
    expectedRepository,
    expectedScale,
    expectedSignerThumbprint: normalizeWindowsSignerThumbprint(expectedSignerThumbprint),
    expectedSourceCommit,
    expectedSourceTag,
    interactionMode,
    installerPath,
    sleep
  };
}

function resolveCertificationArtifact(executablePath) {
  if (!executablePath) return resolvePackagedArtifact("win32", "x64");
  const resolvedExecutable = resolve(executablePath);
  return {
    arch: "x64",
    executablePath: resolvedExecutable,
    platform: "win32",
    resourcesPath: join(dirname(resolvedExecutable), "resources")
  };
}

async function observeNativeRuntime(application, page) {
  const main = await application.evaluate(({ app, BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("Windows certification BrowserWindow is unavailable.");
    const display = screen.getDisplayMatching(window.getBounds());
    return {
      appVersion: app.getVersion(),
      displayBounds: display.bounds,
      displayScaleFactor: display.scaleFactor,
      electronVersion: process.versions.electron
    };
  });
  const renderer = await page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    screenHeight: window.screen.height,
    screenWidth: window.screen.width
  }));
  return { main, renderer };
}

async function waitForExpectedNativeRuntimeScale(application, page, expectedScale) {
  console.log(`ACTION REQUIRED: set the active Windows display scale to ${Math.round(expectedScale * 100)}%.`);
  const deadline = Date.now() + WORKFLOW_SCALE_TIMEOUT_MS;
  let latest;
  while (Date.now() < deadline) {
    latest = await observeNativeRuntime(application, page);
    if (nativeScaleMatches(latest, expectedScale)) return latest;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(
    `Windows display scale did not reach ${expectedScale}; last observed Electron/Renderer scales were `
    + `${latest?.main?.displayScaleFactor}/${latest?.renderer?.devicePixelRatio}.`
  );
}

export function assertNativeScale(runtime, expectedScale) {
  for (const [name, actual] of [
    ["Electron display scale", runtime.main.displayScaleFactor],
    ["Renderer devicePixelRatio", runtime.renderer.devicePixelRatio]
  ]) {
    if (Math.abs(actual - expectedScale) > 0.05) {
      throw new Error(`${name} expected ${expectedScale}, got ${actual}.`);
    }
  }
}

function nativeScaleMatches(runtime, expectedScale) {
  return Math.abs(runtime.main.displayScaleFactor - expectedScale) <= 0.05
    && Math.abs(runtime.renderer.devicePixelRatio - expectedScale) <= 0.05;
}

function createCertificationInteraction(mode) {
  if (mode === "terminal") {
    return createInterface({ input: process.stdin, output: process.stdout });
  }
  return {
    async question(message) {
      console.log(`ACTION REQUIRED: ${message}`);
    },
    close() {}
  };
}

async function writeReport(path, report) {
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function hostIdentitySha256() {
  return createHash("sha256")
    .update([hostname(), release(), osVersion(), process.arch].join("\u0000"))
    .digest("hex");
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function boundedErrorMessage(error, privatePaths) {
  let message = error instanceof Error ? error.message : String(error);
  for (const path of privatePaths) message = message.replaceAll(path, "<private-path>");
  return message.slice(0, 2_000);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await certifyWindowsNativeRuntime(parseWindowsNativeCertificationArguments(process.argv.slice(2)));
}
