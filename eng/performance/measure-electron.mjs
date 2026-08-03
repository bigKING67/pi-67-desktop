import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  createPerformanceCodeSessionFixture,
  createPerformanceSessionFixture
} from "../../packages/pi-runtime/eng/performance-session-fixture.mjs";
import { DEFAULT_MESSAGE_PAGE_SIZE } from "../../packages/pi-runtime/dist/index.mjs";
import { writeElectronPerformanceReport } from "./electron-performance-report.mjs";
import { collectProcessOwnedMemoryBytes } from "./electron-process-memory.mjs";
import {
  assertRendererResourceBoundaries,
  createRendererResourceCollector
} from "./electron-renderer-resources.mjs";
import {
  initializePackagedRuntime,
  measureActiveExtensionCommandClose,
  measurePackagedApplicationLaunch,
  measurePackagedCommandPaletteFirstOpen,
  measureRealPiSessionProjection,
  waitForRuntimeReady
} from "./electron-runtime-scenarios.mjs";
import { measurePackagedCodeHighlight } from "./packaged-code-highlight.mjs";
import { resolveSampleCount } from "./performance-contract.mjs";
import { writeControlledShutdownExtension } from "../packaging/controlled-shutdown-fixture.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const samples = resolveSampleCount();
const executablePath = resolvePackagedExecutable();
const outputPath = process.env.PI67_PERF_ELECTRON_OUTPUT
  ?? join(root, "artifacts/performance", `electron-${process.platform}-${process.arch}.json`);
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry) => entry[1] !== undefined)
);
const launch = (profile, agentDir, expectWelcome) => measurePackagedApplicationLaunch({
  executablePath, profile, agentDir, expectWelcome, inheritedEnvironment
});

await access(executablePath);

const cleanProfileLaunchSamples = [];
const cleanProfileElectronHandshakeSamples = [];
const cleanProfileFirstWindowSamples = [];
const cleanProfileDomContentLoadedSamples = [];
const cleanProfileWorkspaceActionVisibleSamples = [];
const warmLaunchSamples = [];
const welcomeMemorySamples = [];
const warmRestoredWorkspaceMemorySamples = [];
const connectedMemorySamples = [];
const welcomeOwnedMemorySamples = [];
const warmRestoredWorkspaceOwnedMemorySamples = [];
const connectedOwnedMemorySamples = [];
const mainMemorySamples = [];
const rendererMemorySamples = [];
const agentHostMemorySamples = [];
const mainOwnedMemorySamples = [];
const rendererOwnedMemorySamples = [];
const connectedMainOwnedMemorySamples = [];
const connectedRendererOwnedMemorySamples = [];
const connectedAgentHostOwnedMemorySamples = [];
const initializedRuntimeMemorySamples = [];
const restoredSessionMemorySamples = [];
const initializedRuntimeOwnedMemorySamples = [];
const restoredSessionOwnedMemorySamples = [];
const initializedRuntimeMainMemorySamples = [];
const initializedRuntimeRendererMemorySamples = [];
const initializedRuntimeAgentHostMemorySamples = [];
const initializedRuntimeMainOwnedMemorySamples = [];
const initializedRuntimeRendererOwnedMemorySamples = [];
const initializedRuntimeAgentHostOwnedMemorySamples = [];
const restoredSessionMainMemorySamples = [];
const restoredSessionRendererMemorySamples = [];
const restoredSessionAgentHostMemorySamples = [];
const restoredSessionMainOwnedMemorySamples = [];
const restoredSessionRendererOwnedMemorySamples = [];
const restoredSessionAgentHostOwnedMemorySamples = [];
const runtimeInitializationWorkingSetDeltaSamples = [];
const runtimeInitializationAgentHostDeltaSamples = [];
const sessionRestoreWorkingSetDeltaSamples = [];
const sessionRestoreAgentHostDeltaSamples = [];
const runtimeInitializationOwnedMemoryDeltaSamples = [];
const runtimeInitializationAgentHostOwnedMemoryDeltaSamples = [];
const sessionRestoreOwnedMemoryDeltaSamples = [];
const sessionRestoreAgentHostOwnedMemoryDeltaSamples = [];
const runtimeInitializationSamples = [];
const packagedCommandPaletteFeedbackSamples = [];
const packagedCommandPaletteFirstOpenSamples = [];
const realPiSessionProjectionSamples = [];
const packagedCodeHighlightSamples = [];
const recoverySamples = [];
const activeExtensionCommandCloseSamples = [];
const closeSamples = [];
const rendererResourceTransitions = [];

for (let index = 0; index < samples; index += 1) {
  const profile = await mkdtemp(join(tmpdir(), "pi67-performance-"));
  const agentDir = join(profile, "pi-agent");
  const extensionsDirectory = join(agentDir, "extensions");
  const workspace = join(profile, "workspace");
  const sessionDir = join(profile, "performance-sessions");
  const childPidPath = join(profile, "controlled-child.pid");
  const lifecyclePath = join(profile, "controlled-lifecycle.txt");
  let activeApplication;
  try {
    await Promise.all([mkdir(extensionsDirectory, { recursive: true }), mkdir(workspace), mkdir(sessionDir)]);
    await writeControlledShutdownExtension({
      extensionPath: join(extensionsDirectory, "shutdown-fixture.ts"),
      childPidPath,
      lifecyclePath
    });
    const fixture = await createPerformanceSessionFixture({ cwd: workspace, sessionDir, messageCount: 1_000 });
    const codeFixture = await createPerformanceCodeSessionFixture({ cwd: workspace, sessionDir, lineCount: 500 });
    const cleanLaunch = await launch(profile, agentDir, true);
    activeApplication = cleanLaunch.application;
    cleanProfileLaunchSamples.push(cleanLaunch.durationMs);
    cleanProfileElectronHandshakeSamples.push(cleanLaunch.phases.electronHandshakeMs);
    cleanProfileFirstWindowSamples.push(cleanLaunch.phases.firstWindowMs);
    cleanProfileDomContentLoadedSamples.push(cleanLaunch.phases.domContentLoadedMs);
    cleanProfileWorkspaceActionVisibleSamples.push(cleanLaunch.phases.workspaceActionVisibleMs);
    const resourceCollector = await createRendererResourceCollector(cleanLaunch.window, join(root, "apps/renderer/dist"));
    recordWelcomeMemory(await measureWorkingSet(cleanLaunch.application, false));
    await connectAgentHost(cleanLaunch.application, cleanLaunch.window);
    const connectedMemory = await measureWorkingSet(cleanLaunch.application, true);
    recordConnectedMemory(connectedMemory);
    const initializedStage = await resourceCollector.measureStage("runtimeInitialization", () => (
      initializePackagedRuntime(cleanLaunch.application, cleanLaunch.window, workspace)
    ));
    runtimeInitializationSamples.push(initializedStage.result);
    const initializedMemory = await measureWorkingSet(cleanLaunch.application, true);
    initializedRuntimeMemorySamples.push(totalWorkingSet(initializedMemory));
    initializedRuntimeOwnedMemorySamples.push(totalOwnedMemory(initializedMemory));
    initializedRuntimeMainMemorySamples.push(initializedMemory.main);
    initializedRuntimeRendererMemorySamples.push(initializedMemory.renderer);
    initializedRuntimeAgentHostMemorySamples.push(initializedMemory.agentHost);
    initializedRuntimeMainOwnedMemorySamples.push(initializedMemory.mainOwned);
    initializedRuntimeRendererOwnedMemorySamples.push(initializedMemory.rendererOwned);
    initializedRuntimeAgentHostOwnedMemorySamples.push(initializedMemory.agentHostOwned);
    runtimeInitializationWorkingSetDeltaSamples.push(totalWorkingSet(initializedMemory) - totalWorkingSet(connectedMemory));
    runtimeInitializationAgentHostDeltaSamples.push(initializedMemory.agentHost - connectedMemory.agentHost);
    runtimeInitializationOwnedMemoryDeltaSamples.push(totalOwnedMemory(initializedMemory) - totalOwnedMemory(connectedMemory));
    runtimeInitializationAgentHostOwnedMemoryDeltaSamples.push(
      initializedMemory.agentHostOwned - connectedMemory.agentHostOwned
    );
    const restoredStage = await resourceCollector.measureStage("sessionRestore", () => measureRealPiSessionProjection(
      cleanLaunch.application, cleanLaunch.window, fixture.sessionPath, Math.min(fixture.messageCount, DEFAULT_MESSAGE_PAGE_SIZE)
    ));
    realPiSessionProjectionSamples.push(restoredStage.result);
    const rendererResourceTransition = {
      welcome: resourceCollector.welcome,
      runtimeInitialization: initializedStage.resources,
      sessionRestore: restoredStage.resources
    };
    assertRendererResourceBoundaries(rendererResourceTransition);
    rendererResourceTransitions.push(rendererResourceTransition);
    resourceCollector.dispose();
    const restoredMemory = await measureWorkingSet(cleanLaunch.application, true);
    restoredSessionMemorySamples.push(totalWorkingSet(restoredMemory));
    restoredSessionOwnedMemorySamples.push(totalOwnedMemory(restoredMemory));
    restoredSessionMainMemorySamples.push(restoredMemory.main);
    restoredSessionRendererMemorySamples.push(restoredMemory.renderer);
    restoredSessionAgentHostMemorySamples.push(restoredMemory.agentHost);
    restoredSessionMainOwnedMemorySamples.push(restoredMemory.mainOwned);
    restoredSessionRendererOwnedMemorySamples.push(restoredMemory.rendererOwned);
    restoredSessionAgentHostOwnedMemorySamples.push(restoredMemory.agentHostOwned);
    sessionRestoreWorkingSetDeltaSamples.push(totalWorkingSet(restoredMemory) - totalWorkingSet(initializedMemory));
    sessionRestoreAgentHostDeltaSamples.push(restoredMemory.agentHost - initializedMemory.agentHost);
    sessionRestoreOwnedMemoryDeltaSamples.push(totalOwnedMemory(restoredMemory) - totalOwnedMemory(initializedMemory));
    sessionRestoreAgentHostOwnedMemoryDeltaSamples.push(
      restoredMemory.agentHostOwned - initializedMemory.agentHostOwned
    );
    recoverySamples.push(await measureAgentHostRecovery(cleanLaunch.application, cleanLaunch.window));
    packagedCodeHighlightSamples.push(await measurePackagedCodeHighlight(
      cleanLaunch.application,
      cleanLaunch.window,
      codeFixture.sessionPath,
      codeFixture.lineCount
    ));
    const commandPaletteFirstOpen = await measurePackagedCommandPaletteFirstOpen(
      cleanLaunch.window,
      process.platform
    );
    packagedCommandPaletteFeedbackSamples.push(commandPaletteFirstOpen.feedbackMs);
    packagedCommandPaletteFirstOpenSamples.push(commandPaletteFirstOpen.readyMs);
    const agentHostBeforeClose = processRoles(cleanLaunch.application.process().pid).get("agentHost");
    if (!agentHostBeforeClose) throw new Error("Agent Host process was not found before active-command close.");
    activeExtensionCommandCloseSamples.push(await measureActiveExtensionCommandClose(
      cleanLaunch.application,
      cleanLaunch.window,
      process.platform,
      childPidPath,
      lifecyclePath,
      agentHostBeforeClose.pid
    ));
    activeApplication = undefined;

    const warmLaunch = await launch(profile, agentDir, false);
    activeApplication = warmLaunch.application;
    warmLaunchSamples.push(warmLaunch.durationMs);
    recordWarmRestoredWorkspaceMemory(await measureWorkingSet(warmLaunch.application, false));
    closeSamples.push(await close(warmLaunch.application));
    activeApplication = undefined;
  } finally {
    await activeApplication?.close().catch(() => undefined);
    await rm(profile, { recursive: true, force: true });
  }
}

await writeElectronPerformanceReport({
  root,
  outputPath,
  platform: process.platform,
  defaultMessagePageSize: DEFAULT_MESSAGE_PAGE_SIZE,
  samples: {
    cleanProfileLaunch: cleanProfileLaunchSamples,
    cleanProfileElectronHandshake: cleanProfileElectronHandshakeSamples,
    cleanProfileFirstWindow: cleanProfileFirstWindowSamples,
    cleanProfileDomContentLoaded: cleanProfileDomContentLoadedSamples,
    cleanProfileWorkspaceActionVisible: cleanProfileWorkspaceActionVisibleSamples,
    warmLaunch: warmLaunchSamples,
    welcomeMemory: welcomeMemorySamples,
    warmRestoredWorkspaceMemory: warmRestoredWorkspaceMemorySamples,
    connectedMemory: connectedMemorySamples,
    welcomeOwnedMemory: welcomeOwnedMemorySamples,
    warmRestoredWorkspaceOwnedMemory: warmRestoredWorkspaceOwnedMemorySamples,
    connectedOwnedMemory: connectedOwnedMemorySamples,
    mainMemory: mainMemorySamples,
    rendererMemory: rendererMemorySamples,
    agentHostMemory: agentHostMemorySamples,
    mainOwnedMemory: mainOwnedMemorySamples,
    rendererOwnedMemory: rendererOwnedMemorySamples,
    connectedMainOwnedMemory: connectedMainOwnedMemorySamples,
    connectedRendererOwnedMemory: connectedRendererOwnedMemorySamples,
    connectedAgentHostOwnedMemory: connectedAgentHostOwnedMemorySamples,
    initializedRuntimeMemory: initializedRuntimeMemorySamples,
    restoredSessionMemory: restoredSessionMemorySamples,
    initializedRuntimeOwnedMemory: initializedRuntimeOwnedMemorySamples,
    restoredSessionOwnedMemory: restoredSessionOwnedMemorySamples,
    initializedRuntimeMainMemory: initializedRuntimeMainMemorySamples,
    initializedRuntimeRendererMemory: initializedRuntimeRendererMemorySamples,
    initializedRuntimeAgentHostMemory: initializedRuntimeAgentHostMemorySamples,
    initializedRuntimeMainOwnedMemory: initializedRuntimeMainOwnedMemorySamples,
    initializedRuntimeRendererOwnedMemory: initializedRuntimeRendererOwnedMemorySamples,
    initializedRuntimeAgentHostOwnedMemory: initializedRuntimeAgentHostOwnedMemorySamples,
    restoredSessionMainMemory: restoredSessionMainMemorySamples,
    restoredSessionRendererMemory: restoredSessionRendererMemorySamples,
    restoredSessionAgentHostMemory: restoredSessionAgentHostMemorySamples,
    restoredSessionMainOwnedMemory: restoredSessionMainOwnedMemorySamples,
    restoredSessionRendererOwnedMemory: restoredSessionRendererOwnedMemorySamples,
    restoredSessionAgentHostOwnedMemory: restoredSessionAgentHostOwnedMemorySamples,
    runtimeInitializationWorkingSetDelta: runtimeInitializationWorkingSetDeltaSamples,
    runtimeInitializationAgentHostDelta: runtimeInitializationAgentHostDeltaSamples,
    sessionRestoreWorkingSetDelta: sessionRestoreWorkingSetDeltaSamples,
    sessionRestoreAgentHostDelta: sessionRestoreAgentHostDeltaSamples,
    runtimeInitializationOwnedMemoryDelta: runtimeInitializationOwnedMemoryDeltaSamples,
    runtimeInitializationAgentHostOwnedMemoryDelta: runtimeInitializationAgentHostOwnedMemoryDeltaSamples,
    sessionRestoreOwnedMemoryDelta: sessionRestoreOwnedMemoryDeltaSamples,
    sessionRestoreAgentHostOwnedMemoryDelta: sessionRestoreAgentHostOwnedMemoryDeltaSamples,
    runtimeInitialization: runtimeInitializationSamples,
    packagedCommandPaletteFeedback: packagedCommandPaletteFeedbackSamples,
    packagedCommandPaletteFirstOpen: packagedCommandPaletteFirstOpenSamples,
    realPiSessionProjection: realPiSessionProjectionSamples,
    packagedCodeHighlight: packagedCodeHighlightSamples,
    recovery: recoverySamples,
    activeExtensionCommandClose: activeExtensionCommandCloseSamples,
    close: closeSamples,
    rendererResourceTransitions
  }
});

function resolvePackagedExecutable() {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return join(root, "artifacts/release/mac-arm64/Pi-67 Desktop.app/Contents/MacOS/Pi-67 Desktop");
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return join(root, "artifacts/release/win-unpacked/Pi-67 Desktop.exe");
  }
  throw new Error(`Packaged performance harness does not support ${process.platform}/${process.arch}.`);
}

async function connectAgentHost(application, window) {
  await window.evaluate(() => window.pi67.system.connectAgentHost());
  await waitForReplacementAgentHost(application.process().pid, -1, 10_000);
  await window.locator('.application-shell[data-agent-connected="true"]').waitFor({
    state: "visible",
    timeout: 10_000
  });
}

async function measureWorkingSet(application, requireAgentHost) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const roles = processRoles(application.process().pid, requireAgentHost);
  const ownedMemory = collectProcessOwnedMemoryBytes(roles);
  const toMiB = (bytes) => bytes / 1024 / 1024;
  return {
    main: toMiB(roles.get("main").rssBytes),
    renderer: toMiB(roles.get("renderer").rssBytes),
    agentHost: roles.has("agentHost") ? toMiB(roles.get("agentHost").rssBytes) : 0,
    mainOwned: toMiB(ownedMemory.get("main")),
    rendererOwned: toMiB(ownedMemory.get("renderer")),
    agentHostOwned: roles.has("agentHost") ? toMiB(ownedMemory.get("agentHost")) : 0
  };
}

function recordWelcomeMemory(sample) {
  mainMemorySamples.push(sample.main);
  rendererMemorySamples.push(sample.renderer);
  mainOwnedMemorySamples.push(sample.mainOwned);
  rendererOwnedMemorySamples.push(sample.rendererOwned);
  welcomeMemorySamples.push(sample.main + sample.renderer);
  welcomeOwnedMemorySamples.push(sample.mainOwned + sample.rendererOwned);
}

function recordWarmRestoredWorkspaceMemory(sample) {
  warmRestoredWorkspaceMemorySamples.push(sample.main + sample.renderer);
  warmRestoredWorkspaceOwnedMemorySamples.push(sample.mainOwned + sample.rendererOwned);
}

function recordConnectedMemory(sample) {
  agentHostMemorySamples.push(sample.agentHost);
  connectedMemorySamples.push(sample.main + sample.renderer + sample.agentHost);
  connectedOwnedMemorySamples.push(sample.mainOwned + sample.rendererOwned + sample.agentHostOwned);
  connectedMainOwnedMemorySamples.push(sample.mainOwned);
  connectedRendererOwnedMemorySamples.push(sample.rendererOwned);
  connectedAgentHostOwnedMemorySamples.push(sample.agentHostOwned);
}

function totalWorkingSet(sample) {
  return sample.main + sample.renderer + sample.agentHost;
}

function totalOwnedMemory(sample) {
  return sample.mainOwned + sample.rendererOwned + sample.agentHostOwned;
}

async function measureAgentHostRecovery(application, window) {
  const before = processRoles(application.process().pid);
  const agentHost = before.get("agentHost");
  if (!agentHost) throw new Error("Agent Host process was not found.");
  const projectionBefore = await window.locator('[data-transcript-region="true"]').evaluate((region) => ({
    sessionId: region.getAttribute("data-session-id"),
    messageCount: Number(region.getAttribute("data-message-count") ?? 0)
  })).catch(() => undefined);
  const started = performance.now();
  process.kill(agentHost.pid, "SIGKILL");
  await window.locator("[data-notification-id]", { hasText: "Pi 运行服务已退出" }).waitFor({
    state: "visible",
    timeout: 10_000
  });
  await waitForReplacementAgentHost(application.process().pid, agentHost.pid, 10_000);
  await waitForRuntimeReady(window, 30_000);
  if (projectionBefore?.sessionId) {
    await window.waitForFunction(({ sessionId, messageCount }) => {
      const region = document.querySelector('[data-transcript-region="true"]');
      return region?.getAttribute("data-session-id") === sessionId
        && Number(region.getAttribute("data-message-count") ?? 0) === messageCount;
    }, projectionBefore, { timeout: 30_000 });
  }
  return performance.now() - started;
}

async function close(application) {
  const started = performance.now();
  await application.close();
  return performance.now() - started;
}

async function waitForReplacementAgentHost(rootPid, previousPid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const replacement = findAgentHost(rootPid);
    if (replacement && replacement.pid !== previousPid) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for a replacement Agent Host process.");
}

function findAgentHost(rootPid) {
  return collectProcessTree(rootPid).find((row) => row.command.includes("--utility-sub-type=node.mojom.NodeService"));
}

function processRoles(rootPid, requireAgentHost = true) {
  const tree = collectProcessTree(rootPid);
  const main = tree.find((row) => row.pid === rootPid);
  const renderer = tree.find((row) => row.command.includes("--type=renderer"));
  const agentHost = tree.find((row) => row.command.includes("--utility-sub-type=node.mojom.NodeService"));
  if (!main || !renderer || (requireAgentHost && !agentHost)) {
    throw new Error(`Incomplete Electron process roles: main=${Boolean(main)}, renderer=${Boolean(renderer)}, agentHost=${Boolean(agentHost)}.`);
  }
  const roles = new Map([
    ["main", main],
    ["renderer", renderer]
  ]);
  if (agentHost) roles.set("agentHost", agentHost);
  return roles;
}

function collectProcessTree(rootPid) {
  const rows = process.platform === "win32" ? windowsProcesses() : macProcesses();
  const processIds = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (processIds.has(row.parentPid) && !processIds.has(row.pid)) {
        processIds.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => processIds.has(row.pid));
}

function macProcesses() {
  const output = execFileSync("ps", ["-axo", "pid=,ppid=,rss=,command="], { encoding: "utf8" });
  return output.trim().split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u);
    return match ? [{ pid: Number(match[1]), parentPid: Number(match[2]), rssBytes: Number(match[3]) * 1024, command: match[4] }] : [];
  });
}

function windowsProcesses() {
  const script = [
    "Get-CimInstance Win32_Process",
    "Select-Object ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount,CommandLine",
    "ConvertTo-Json -Compress"
  ].join(" | ");
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
    pid: Number(row.ProcessId),
    parentPid: Number(row.ParentProcessId),
    rssBytes: Number(row.WorkingSetSize),
    privateBytes: Number(row.PrivatePageCount),
    command: typeof row.CommandLine === "string" ? row.CommandLine : ""
  }));
}
