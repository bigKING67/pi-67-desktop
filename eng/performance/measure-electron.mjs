import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { _electron as electron } from "@playwright/test";
import {
  createPerformanceCodeSessionFixture,
  createPerformanceSessionFixture
} from "../../packages/pi-runtime/eng/performance-session-fixture.mjs";
import { measurePackagedCodeHighlight } from "./packaged-code-highlight.mjs";
import {
  createReport,
  enforceReport,
  printReport,
  resolveSampleCount,
  summarizeMetric,
  writeReport
} from "./performance-contract.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const samples = resolveSampleCount();
const executablePath = resolvePackagedExecutable();
const outputPath = process.env.PI67_PERF_ELECTRON_OUTPUT
  ?? join(root, "artifacts/performance", `electron-${process.platform}-${process.arch}.json`);
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry) => entry[1] !== undefined)
);

await access(executablePath);

const cleanProfileLaunchSamples = [];
const warmLaunchSamples = [];
const welcomeMemorySamples = [];
const connectedMemorySamples = [];
const mainMemorySamples = [];
const rendererMemorySamples = [];
const agentHostMemorySamples = [];
const initializedRuntimeMemorySamples = [];
const restoredSessionMemorySamples = [];
const realPiSessionProjectionSamples = [];
const packagedCodeHighlightSamples = [];
const recoverySamples = [];
const closeSamples = [];

for (let index = 0; index < samples; index += 1) {
  const profile = await mkdtemp(join(tmpdir(), "pi67-performance-"));
  const agentDir = join(profile, "pi-agent");
  const workspace = join(profile, "workspace");
  const sessionDir = join(profile, "performance-sessions");
  let activeApplication;
  try {
    await Promise.all([mkdir(agentDir), mkdir(workspace), mkdir(sessionDir)]);
    const fixture = await createPerformanceSessionFixture({ cwd: workspace, sessionDir, messageCount: 1_000 });
    const codeFixture = await createPerformanceCodeSessionFixture({ cwd: workspace, sessionDir, lineCount: 500 });
    const cleanLaunch = await launch(profile, agentDir);
    activeApplication = cleanLaunch.application;
    cleanProfileLaunchSamples.push(cleanLaunch.durationMs);
    recordWelcomeMemory(await measureWorkingSet(cleanLaunch.application, false));
    await connectAgentHost(cleanLaunch.application, cleanLaunch.window);
    recordConnectedMemory(await measureWorkingSet(cleanLaunch.application, true));
    await initializeRuntime(cleanLaunch.application, cleanLaunch.window, workspace);
    initializedRuntimeMemorySamples.push(totalWorkingSet(await measureWorkingSet(cleanLaunch.application, true)));
    realPiSessionProjectionSamples.push(await measureRealPiSessionProjection(
      cleanLaunch.application,
      cleanLaunch.window,
      fixture.sessionPath,
      fixture.messageCount
    ));
    restoredSessionMemorySamples.push(totalWorkingSet(await measureWorkingSet(cleanLaunch.application, true)));
    recoverySamples.push(await measureAgentHostRecovery(cleanLaunch.application, cleanLaunch.window));
    packagedCodeHighlightSamples.push(await measurePackagedCodeHighlight(
      cleanLaunch.application,
      cleanLaunch.window,
      codeFixture.sessionPath,
      codeFixture.lineCount
    ));
    await close(cleanLaunch.application);
    activeApplication = undefined;

    const warmLaunch = await launch(profile, agentDir);
    activeApplication = warmLaunch.application;
    warmLaunchSamples.push(warmLaunch.durationMs);
    recordWelcomeMemory(await measureWorkingSet(warmLaunch.application, false));
    closeSamples.push(await close(warmLaunch.application));
    activeApplication = undefined;
  } finally {
    await activeApplication?.close().catch(() => undefined);
    await rm(profile, { recursive: true, force: true });
  }
}

const metrics = [
  summarizeMetric({
    id: "cleanProfileLaunch",
    label: "Clean-profile launch to usable window",
    unit: "ms",
    samples: cleanProfileLaunchSamples,
    budget: 3_000,
    evidenceLevel: "packaged",
    method: "New Electron user-data directory; first window and connected workspace action",
    limitations: ["The harness does not flush the operating-system file cache, so this is not a power-cycle cold start."]
  }),
  summarizeMetric({
    id: "warmLaunch",
    label: "Warm-profile launch to usable window",
    unit: "ms",
    samples: warmLaunchSamples,
    budget: 1_800,
    evidenceLevel: "packaged",
    method: "Second packaged launch using the same clean profile"
  }),
  summarizeMetric({
    id: "welcomeIdleWorkingSet",
    label: "On-demand Welcome Main + renderer resident working set",
    unit: "MiB",
    samples: welcomeMemorySamples,
    budget: 350,
    evidenceLevel: "packaged",
    method: process.platform === "win32"
      ? "Win32 WorkingSetSize for packaged Main and renderer before Agent Host demand"
      : "macOS RSS for packaged Main and renderer before Agent Host demand",
    limitations: ["Summed process working sets can double-count shared pages; GPU and network utility processes are excluded."]
  }),
  summarizeMetric({
    id: "mainWorkingSet",
    label: "Electron Main resident working set",
    unit: "MiB",
    samples: mainMemorySamples,
    evidenceLevel: "packaged",
    method: "Main process component of welcomeIdleWorkingSet"
  }),
  summarizeMetric({
    id: "rendererWorkingSet",
    label: "Renderer resident working set",
    unit: "MiB",
    samples: rendererMemorySamples,
    evidenceLevel: "packaged",
    method: "Renderer process component of welcomeIdleWorkingSet"
  }),
  summarizeMetric({
    id: "connectedAgentHostWorkingSet",
    label: "Main + renderer + connected unloaded Agent Host working set",
    unit: "MiB",
    samples: connectedMemorySamples,
    evidenceLevel: "packaged",
    method: "Explicit Agent Host demand followed by Main, renderer, and node utility process working-set sum",
    limitations: ["Pi SDK is still unloaded; initialized runtime memory is a separate required scenario.", "Summed RSS can double-count shared pages."]
  }),
  summarizeMetric({
    id: "agentHostWorkingSet",
    label: "Agent Host resident working set",
    unit: "MiB",
    samples: agentHostMemorySamples,
    evidenceLevel: "packaged",
    method: "node.mojom.NodeService component after explicit Agent Host demand"
  }),
  summarizeMetric({
    id: "initializedRuntimeWorkingSet",
    label: "Main + renderer + initialized Pi SDK Agent Host working set",
    unit: "MiB",
    samples: initializedRuntimeMemorySamples,
    evidenceLevel: "packaged",
    method: "Isolated PI_CODING_AGENT_DIR and workspace, real Pi SDK session initialization, then three-process working-set sum",
    limitations: ["The session has no provider turn, large transcript, or loaded user extension set.", "Summed RSS can double-count shared pages."]
  }),
  summarizeMetric({
    id: "realPiSessionProjection",
    label: "Official 1,000-message Pi session restore to usable projection",
    unit: "ms",
    samples: realPiSessionProjectionSamples,
    budget: 1_500,
    evidenceLevel: "packaged",
    method: "SessionManager.appendMessage JSONL fixture; native file dialog bridge; Pi SDK restore; validated 1,000-message transcript, bounded virtualized tree, visible fixture content, and composer paint",
    limitations: ["The synthetic session contains user and assistant text messages but no images, tool results, compaction, or branches."]
  }),
  summarizeMetric({
    id: "restoredSessionWorkingSet",
    label: "Main + renderer + Agent Host working set after 1,000-message restore",
    unit: "MiB",
    samples: restoredSessionMemorySamples,
    evidenceLevel: "packaged",
    method: "Three-process working-set sum after the official 1,000-message Pi JSONL is fully projected",
    limitations: ["Summed RSS can double-count shared pages."]
  }),
  summarizeMetric({
    id: "agentHostRecovery",
    label: "Agent Host crash to recovered active Pi session",
    unit: "ms",
    samples: recoverySamples,
    budget: 3_000,
    evidenceLevel: "packaged",
    method: "Initialize an isolated Pi session, terminate node utility process, then wait for failure notice, replacement PID, and Pi SDK ready state"
  }),
  summarizeMetric({
    id: "packagedLongCodeHighlight",
    label: "Packaged app:// TypeScript code highlight",
    unit: "ms",
    samples: packagedCodeHighlightSamples,
    evidenceLevel: "packaged",
    method: "Official Pi JSONL with 500 TypeScript lines; app:// renderer, CSP, same-origin module worker, Shiki WASM, grammar, and bounded virtual line window",
    limitations: ["Informational; browser-tier stress coverage uses 2,000 cold and 1,800 warm lines."]
  }),
  summarizeMetric({
    id: "normalClose",
    label: "Normal packaged application close",
    unit: "ms",
    samples: closeSamples,
    evidenceLevel: "packaged",
    method: "Playwright ElectronApplication.close without an active Pi tool",
    limitations: ["Does not satisfy the active-tool close budget."]
  })
];
const report = await createReport({
  root,
  suite: "electron",
  metrics,
  unverified: [
    { id: "powerCycleColdLaunch", reason: "Requires an OS-level cold-cache procedure outside the automated harness." },
    { id: "activeToolClose", reason: "Requires a controlled long-running real Pi tool invocation." },
    { id: "providerTurnMemory", reason: "Requires controlled real provider turns with representative tool and transcript payloads." }
  ]
});
await writeReport(outputPath, report);
printReport(outputPath, report);
enforceReport(report);

function resolvePackagedExecutable() {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return join(root, "artifacts/release/mac-arm64/Pi-67 Desktop.app/Contents/MacOS/Pi-67 Desktop");
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return join(root, "artifacts/release/win-unpacked/Pi-67 Desktop.exe");
  }
  throw new Error(`Packaged performance harness does not support ${process.platform}/${process.arch}.`);
}

async function launch(profile, agentDir) {
  const started = performance.now();
  const application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`],
    env: { ...inheritedEnvironment, NODE_ENV: "test", PI_CODING_AGENT_DIR: agentDir }
  });
  try {
    const window = await application.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    const workspaceAction = window.getByRole("button", { name: "选择工作区" });
    await workspaceAction.waitFor({ state: "visible", timeout: 15_000 });
    await waitUntilEnabled(workspaceAction, 15_000);
    return { application, window, durationMs: performance.now() - started };
  } catch (error) {
    await application.close();
    throw error;
  }
}

async function connectAgentHost(application, window) {
  await window.evaluate(() => window.pi67.system.connectAgentHost());
  await waitForReplacementAgentHost(application.process().pid, -1, 10_000);
  await window.getByText("Agent Host 已连接").waitFor({ state: "visible", timeout: 10_000 });
}

async function initializeRuntime(application, window, workspace) {
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
  }, workspace);
  await window.getByRole("button", { name: "选择工作区" }).click();
  await waitForRuntimeReady(window, 30_000);
}

async function measureRealPiSessionProjection(application, window, sessionPath, expectedMessageCount) {
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
  }, sessionPath);
  return withTimeout(window.evaluate((messageCount) => new Promise((resolve, reject) => {
    const button = document.querySelector('[aria-label="打开 Pi session 文件"]');
    if (!(button instanceof HTMLButtonElement)) {
      reject(new Error("Pi session file action is unavailable."));
      return;
    }
    const started = performance.now();
    const deadline = started + 15_000;
    button.click();
    const observe = () => {
      const treeEntryCount = Number(document.querySelector(".session-tree")?.getAttribute("data-entry-count") ?? 0);
      const renderedTreeNodeCount = document.querySelectorAll(".tree-node").length;
      const transcriptMessageCount = Number(document.querySelector(".transcript-region")?.getAttribute("data-message-count") ?? 0);
      const fixtureMessageVisible = document.querySelector(".message-card .message-content")?.textContent
        ?.includes("Pi-67 restore fixture") ?? false;
      const treeVirtualized = renderedTreeNodeCount > 0 && renderedTreeNodeCount < treeEntryCount;
      if (transcriptMessageCount === messageCount && treeVirtualized && fixtureMessageVisible && document.querySelector(".composer-shell")) {
        requestAnimationFrame(() => resolve(performance.now() - started));
        return;
      }
      if (performance.now() >= deadline) {
        reject(new Error(
          `Pi session projection timed out: transcriptMessages=${transcriptMessageCount}, treeEntries=${treeEntryCount}, `
          + `renderedTreeNodes=${renderedTreeNodeCount}, fixtureMessageVisible=${fixtureMessageVisible}.`
        ));
        return;
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  }), expectedMessageCount), 20_000, "Packaged Pi session projection");
}

async function withTimeout(operation, timeoutMs, label) {
  let timeout;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms.`)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function measureWorkingSet(application, requireAgentHost) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const roles = processRoles(application.process().pid, requireAgentHost);
  const toMiB = (bytes) => bytes / 1024 / 1024;
  return {
    main: toMiB(roles.get("main").rssBytes),
    renderer: toMiB(roles.get("renderer").rssBytes),
    agentHost: roles.has("agentHost") ? toMiB(roles.get("agentHost").rssBytes) : 0
  };
}

function recordWelcomeMemory(sample) {
  mainMemorySamples.push(sample.main);
  rendererMemorySamples.push(sample.renderer);
  welcomeMemorySamples.push(sample.main + sample.renderer);
}

function recordConnectedMemory(sample) {
  agentHostMemorySamples.push(sample.agentHost);
  connectedMemorySamples.push(sample.main + sample.renderer + sample.agentHost);
}

function totalWorkingSet(sample) {
  return sample.main + sample.renderer + sample.agentHost;
}

async function measureAgentHostRecovery(application, window) {
  const before = processRoles(application.process().pid);
  const agentHost = before.get("agentHost");
  if (!agentHost) throw new Error("Agent Host process was not found.");
  const started = performance.now();
  process.kill(agentHost.pid, "SIGKILL");
  await window.getByText("Agent Host 已退出；任何仅在本次运行内存中的 Provider API key 均已清除。").waitFor({
    state: "visible",
    timeout: 10_000
  });
  await waitForReplacementAgentHost(application.process().pid, agentHost.pid, 10_000);
  await waitForRuntimeReady(window, 30_000);
  return performance.now() - started;
}

async function waitForRuntimeReady(window, timeoutMs) {
  try {
    await window.locator(".runtime-pill.phase-ready").waitFor({ state: "visible", timeout: timeoutMs });
  } catch (error) {
    const state = await window.locator(".runtime-pill, .runtime-summary, .notice").allTextContents();
    throw new Error(`Pi SDK did not recover: ${state.join(" | ").slice(0, 1_000)}`, { cause: error });
  }
}

async function close(application) {
  const started = performance.now();
  await application.close();
  return performance.now() - started;
}

async function waitUntilEnabled(locator, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.isEnabled()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the workspace action to become enabled.");
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
    "Select-Object ProcessId,ParentProcessId,WorkingSetSize,CommandLine",
    "ConvertTo-Json -Compress"
  ].join(" | ");
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
    pid: Number(row.ProcessId),
    parentPid: Number(row.ParentProcessId),
    rssBytes: Number(row.WorkingSetSize),
    command: typeof row.CommandLine === "string" ? row.CommandLine : ""
  }));
}
