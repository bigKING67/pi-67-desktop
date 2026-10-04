import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { readRecoveryMainProcess, readRecoveryProcess, readWindowsRecoveryExitState, signalRecoveryProcess } from "./packaged-recovery-process.mjs";
import { fileURLToPath } from "node:url";
import { cleanupPackagedTestDirectories, createPackagedTestDirectories, installWorkspaceDialogResult,
  launchPackagedApplication, resolvePackagedArtifact } from "./packaged-electron-fixture.mjs";
import { closeElectronApplicationWithinTimeout } from "./electron-shutdown-measurement.mjs";
import { collectIsolatedSessionEvidence, snapshotDirectoryMetadata, watchDirectoryMutationDigests } from "./packaged-context-isolation-receipt.mjs";
import { clickRecoveryAction, observeRecoveryProtocol, prepareTaskRecoveryProfile, RECOVERY_RESPONSE, selectRecoveryScenario } from "./packaged-task-recovery-fixture.mjs";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../", import.meta.url));
const scenario = selectRecoveryScenario(process.argv.slice(2));
const artifact = resolvePackagedArtifact();
const asarPath = join(artifact.resourcesPath, "app.asar");
const { stdout: sourceHead } = await execute("git", ["rev-parse", "HEAD"], { cwd: root });
const { stdout: sourceStatus } = await execute("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root });
const provenance = { platform: artifact.platform, arch: artifact.arch, sourceHead: sourceHead.trim(), sourceDirty: sourceStatus.trim().length > 0,
  ...(process.env.GITHUB_RUN_ID ? { workflowRunId: process.env.GITHUB_RUN_ID, workflowAttempt: process.env.GITHUB_RUN_ATTEMPT } : {}) };
const asar = await readFile(asarPath);
const artifactSha256 = createHash("sha256").update(asar).digest("hex");
const evidence = join(root, "artifacts/validation/pi-durable-compat/packaged", `${scenario}-${randomUUID()}`);
await mkdir(evidence, { recursive: true });
const temporary = await createPackagedTestDirectories("pi67-recovery-", "synthetic-workspace");
const directories = Object.fromEntries(await Promise.all(Object.entries(temporary).map(async ([key, value]) => [key, await realpath(value)])));
const fixture = await prepareTaskRecoveryProfile(directories, scenario);
const canonicalRoot = join(homedir(), ".pi/agent/sessions");
const canonicalBefore = await snapshotDirectoryMetadata(canonicalRoot);
const canonicalWatch = canonicalBefore.exists ? watchDirectoryMutationDigests(canonicalRoot) : undefined;
const tracked = new Map();
let application;
let applicationMainPid;
const launches = [];
let window;
let failure;
let stage = "launch";
let receipt;
let cleanupPassed = false;
const journal = [];
const mark = value => { stage = value; journal.push({ stage, at: new Date().toISOString() }); console.log(`Recovery ${scenario}: ${stage}`); };

try {
  mark("process-query-preflight");
  assert(await readRecoveryProcess(process.ppid), "The runner parent process must be observable before launching Electron.");
  mark("launch");
  application = await launch();
  window = await openWorkspace(application);
  const picker = window.getByRole("button", { name: "Pi 模型", exact: true });
  if (!(await picker.innerText()).includes("Auto")) {
    await picker.click();
    await window.getByRole("listbox").getByRole("option", { name: /Auto · 自动选择/u }).click();
  }
  assert.match(await picker.innerText(), /Auto/u);
  mark("send-synthetic-task");
  await window.getByRole("textbox", { name: "给 Pi 发送消息" }).fill("Complete the synthetic recovery task exactly once.");
  await window.getByRole("button", { name: "发送", exact: true }).click();
  await waitUntil(async () => (await observations()).some(entry => entry.kind === "crash" || entry.kind === "await-main-crash"), 30_000, "injected crash boundary");
  const before = await observations();
  const hostPid = before.find(entry => entry.kind === "candidate").pid;
  const initialSessions = await collectIsolatedSessionEvidence(directories.agentDir);
  assert.equal(initialSessions.length, 1);
  const originalId = initialSessions[0].sessionId;
  const initialEntries = await sessionEntries(initialSessions);
  assert.equal(initialEntries.filter(entry => entry.type === "message" && entry.message.role === "user").length, 1);
  assert.equal(before.filter(entry => entry.kind === "judge").length, 1);
  assert(before.filter(entry => entry.kind === "candidate").every(entry => entry.model === "complex"));
  if (scenario === "app-after-tool") {
    mark("terminate-owned-main-after-persisted-tool-result");
    assert(initialEntries.some(entry => entry.type === "message" && entry.message.role === "toolResult"));
    await track(hostPid);
    const mainPid = applicationMainPid;
    assert.equal((await readRecoveryProcess(hostPid))?.parentPid, mainPid, "The fixture Host must be owned by this exact Main.");
    const conversationId = await window.locator('[data-testid="conversation-row"][aria-current="page"][data-conversation-id^="session:"]').getAttribute("data-conversation-id");
    assert(conversationId);
    assert.equal(await realpath(await application.evaluate(({ app }) => app.getPath("userData"))), directories.userDataDirectory);
    assert.equal(await processIdentity(mainPid), tracked.get(mainPid));
    await recordFixtureNavigation("before-crash");
    assert(await signalRecoveryProcess(mainPid, tracked.get(mainPid), "SIGKILL"));
    await waitUntil(async () => !await processIdentity(mainPid), 10_000, "owned Main exit");
    await waitUntil(async () => !await processIdentity(hostPid), 10_000, "owned utility exit with Main");
    application = undefined;
    mark("cold-reopen-same-profile");
    application = await launch();
    window = await openWorkspace(application, conversationId);
  } else {
    mark("await-agent-replacement");
    await waitUntil(async () => !await processIdentity(hostPid), 10_000, "injected Agent exit");
    await reopenConversation(window, true);
  }
  const notice = window.getByTestId("interrupted-task-notice");
  await notice.waitFor({ state: "visible", timeout: 30_000 });
  if (scenario === "agent-unconfirmed-tool") {
    mark("verify-unknown-tool-blocked");
    assert.match(await notice.innerText(), /1 个工具调用没有结果记录/u);
    assert.equal(await notice.getByRole("button", { name: "继续当前任务" }).count(), 0);
    assert.equal(await readFile(fixture.effectPath, "utf8"), "synthetic effect confirmed on disk");
    assert(!initialEntries.some(entry => entry.type === "message" && entry.message.role === "toolResult"));
  } else {
    mark("explicit-continue");
    await notice.getByRole("button", { name: "继续当前任务", exact: true }).click();
    await window.getByTestId("virtuoso-item-list").getByText(RECOVERY_RESPONSE, { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    await window.locator('[data-runtime-phase="ready"]').waitFor({ state: "visible", timeout: 30_000 });
    await notice.waitFor({ state: "hidden", timeout: 10_000 });
  }
  await window.screenshot({ path: join(evidence, "result.png") });
  const after = await observations();
  const finalSessions = await collectIsolatedSessionEvidence(directories.agentDir);
  assert.equal(finalSessions.length, 1);
  assert.equal(finalSessions[0].sessionId, originalId);
  const entries = await sessionEntries(finalSessions);
  const candidates = after.filter(entry => entry.kind === "candidate");
  assert.equal(after.filter(entry => entry.kind === "judge").length, 1, "Continuation must not classify again.");
  assert(candidates.every(entry => entry.model === "complex"));
  assert.equal(candidates.length, scenario === "app-after-tool" ? 3 : scenario === "agent-before-response" ? 2 : 1);
  assert.equal(after.filter(entry => entry.kind === "network-denied").length, 0);
  assert.equal(entries.filter(entry => entry.type === "message" && entry.message.role === "user").length, 1);
  assert.equal(after.filter(entry => entry.kind === "tool-effect").length, scenario === "agent-before-response" ? 0 : 1);
  receipt = { status: "PASS", scenario, artifactSha256, artifactSize: asar.length, originalSessionPreserved: true,
    userMessageCount: 1, judgeCalls: 1, candidateCalls: candidates.length, candidateModel: "complex",
    toolEffectCount: after.filter(entry => entry.kind === "tool-effect").length, realModelRequests: 0,
    continued: scenario !== "agent-unconfirmed-tool", unknownOutcomeBlocked: scenario === "agent-unconfirmed-tool" };
  mark("verified");
} catch (error) {
  failure = error;
  await window?.screenshot({ path: join(evidence, "failure.png") }).catch(() => undefined);
  const body = await window?.locator("body").innerText().catch(() => "unavailable");
  await writeFile(join(evidence, "failure.txt"), `stage=${stage}\n${error.stack}\n${body?.slice(0, 8000) ?? ""}\n`);
} finally {
  if (failure && process.platform === "win32") {
    const states = [];
    for (const [pid, identity] of tracked) {
      try { states.push({ pid, identityMatches: await processIdentity(pid) === identity, ...await readWindowsRecoveryExitState(pid) }); }
      catch (error) { states.push({ pid, inspectionError: error.message.slice(0, 512) }); }
    }
    await writeFile(join(evidence, "exit-state-before-cleanup.json"), JSON.stringify(states, null, 2) + "\n");
  }
  const protocol = await window?.evaluate(() => globalThis.__pi67RecoveryProtocol).catch(() => undefined);
  await writeFile(join(evidence, "observations.json"), JSON.stringify({ protocol, model: await observations() }, null, 2) + "\n");
  for (const entry of await observations()) {
    if (entry.kind !== "loaded") continue;
    try {
      const observed = await readRecoveryProcess(entry.pid);
      if (observed && tracked.get(observed.parentPid)
        && await processIdentity(observed.parentPid) === tracked.get(observed.parentPid)) {
        if (!tracked.has(entry.pid)) tracked.set(entry.pid, observed.identity);
      }
    } catch (error) { failure ??= error; }
  }
  if (application) {
    const result = await closeFixtureApplication(application);
    if (result.timedOut || result.error || result.mainAliveAfterClose) failure ??= new Error("Test application shutdown did not complete cleanly.");
  }
  // Only processes launched by this fixture, still matching their observed identity.
  for (const [pid, identity] of tracked) {
    try {
      await signalRecoveryProcess(pid, identity, "SIGTERM");
      await waitUntil(async () => !await processIdentity(pid), 5000, "fixture process cleanup");
    } catch (error) { failure ??= error; }
  }
  const allExited = (await Promise.all([...tracked.keys()].map(pid => processIdentity(pid).catch(() => "unverified")))).every(value => value === undefined);
  canonicalWatch?.close();
  const canonicalAfter = await snapshotDirectoryMetadata(canonicalRoot);
  const canonicalUnchanged = JSON.stringify(canonicalBefore) === JSON.stringify(canonicalAfter) && (canonicalWatch?.observations.length ?? 0) === 0;
  if (!canonicalUnchanged) failure ??= new Error("Canonical Session root changed; isolation acceptance is inconclusive.");
  let cleanupError;
  if (allExited) {
    try { await cleanupPackagedTestDirectories(directories.userDataDirectory); cleanupPassed = true; }
    catch (error) { cleanupError = error.message; failure ??= error; }
  }
  else failure ??= new Error("Owned test processes remain; isolated profile retained.");
  await writeFile(join(evidence, "receipt.json"), JSON.stringify({ ...receipt,
    status: failure ? "FAIL" : "PASS", scenario, stage, ...provenance, artifactSha256, artifactSize: asar.length, canonicalUnchanged, cleanupPassed,
    ownedPids: [...tracked.keys()], launches, journal, ...(cleanupError ? { cleanupError } : {}), ...(failure ? { error: failure.message } : {}) }, null, 2) + "\n");
}
console.log(`Recovery receipt: ${evidence}/receipt.json`);
if (failure) throw failure;

async function launch() {
  const app = await launchPackagedApplication({ agentDir: directories.agentDir, artifact, userDataDirectory: directories.userDataDirectory,
    environment: { HOME: directories.userDataDirectory, USERPROFILE: directories.userDataDirectory },
    hideNativeWindow: true, isolateNativeWindow: true, offline: true });
  application = app; // Retain the owned driver even if the first identity read fails.
  applicationMainPid = undefined;
  await track(app.process().pid);
  assert.equal(await realpath(await app.evaluate(({ app: main }) => main.getPath("userData"))), directories.userDataDirectory);
  const main = await readRecoveryMainProcess(app);
  tracked.set(main.pid, main.identity);
  applicationMainPid = main.pid;
  launches.push({ driverPid: main.driverPid, mainPid: main.pid });
  return app;
}
async function openWorkspace(app, conversationId) {
  const page = await app.firstWindow({ timeout: 30_000 });
  // Capture the new page even if bootstrap fails, rather than inspecting the closed pre-crash page.
  window = page;
  await page.waitForLoadState("domcontentloaded");
  assert.equal(page.url(), "app://pi67/index.html");
  await observeRecoveryProtocol(page);
  await recordFixtureNavigation("opened-profile");
  await installWorkspaceDialogResult(app, directories.workspace);
  if (conversationId) {
    // A crash may precede the navigation debounce; reopen the exact original sidebar entry.
    // Exercise that path deterministically even when this launch restored the selected conversation.
    await page.getByTestId("workspace-group").getByRole("button")
      .filter({ has: page.getByText("synthetic-workspace", { exact: true }) }).click();
    await page.getByText("当前工作区", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    // Session identity contains NUL separators, which cannot be interpolated into a CSS selector.
    const rows = page.getByTestId("conversation-row");
    let row;
    await waitUntil(async () => {
      const identities = await rows.evaluateAll(items => items.map(item => item.getAttribute("data-conversation-id")));
      assert(identities.filter(value => value === conversationId).length <= 1);
      const index = identities.indexOf(conversationId);
      if (index < 0) return false;
      row = rows.nth(index);
      return row.isVisible();
    }, 30_000, "original Session sidebar entry");
    assert.equal(await row.getAttribute("data-conversation-id"), conversationId);
    if (await row.getAttribute("aria-current") !== "page") await row.click();
  } else {
    const picker = page.getByRole("button", { name: "选择工作区", exact: true });
    await waitUntil(async () => await picker.isVisible() || await page.getByRole("button", { name: /^(打开对话|恢复任务)$/u }).isVisible()
      || await page.locator('[data-runtime-phase="ready"]').isVisible(), 30_000, "initial app state");
    if (await picker.isVisible()) await picker.click();
  }
  await reopenConversation(page);
  return page;
}
async function reopenConversation(page, requireRecoveryNotice = false) {
  let clicked = false;
  const isReady = () => page.locator('[data-runtime-phase="ready"]').isVisible();
  await waitUntil(async () => {
    const action = page.getByRole("button", { name: /^(打开对话|恢复任务)$/u });
    if (!clicked && await action.isVisible()) { clicked = true; await clickRecoveryAction(action, isReady); }
    return await isReady()
      && (!requireRecoveryNotice || await page.getByTestId("interrupted-task-notice").isVisible());
  }, 45_000, "Session ready after recovery");
}
async function observations() {
  const text = await readFile(fixture.observationPath, "utf8").catch(error => { if (error.code === "ENOENT") return ""; throw error; });
  return text.split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line));
}
async function sessionEntries(sessions) {
  return (await readFile(join(directories.agentDir, sessions[0].relativePath), "utf8")).trimEnd().split("\n").map(line => JSON.parse(line));
}
async function processIdentity(pid) { return (await readRecoveryProcess(pid))?.identity; }
async function recordFixtureNavigation(label) {
  const state = JSON.parse(await readFile(join(directories.userDataDirectory, "workbench/state-v5.json"), "utf8")
    .catch(error => { if (error.code === "ENOENT") return "{}"; throw error; }));
  // This runner creates the entire profile; keep only navigation metadata, never conversation content.
  await writeFile(join(evidence, `${label}.json`), JSON.stringify({ selectedSurface: state.selectedSurface,
    runtimeRecovery: state.runtimeRecovery, sessionCreationRecovery: state.sessionCreationRecovery }, null, 2) + "\n");
}
async function closeFixtureApplication(app) {
  return closeElectronApplicationWithinTimeout({ application: app, timeoutMs: 5000,
    mainPid: applicationMainPid ?? app.process().pid,
    // The caller performs checked termination after this bounded close attempt.
    terminateProcess: () => { throw new Error("Recovery cleanup requires a fresh process identity check."); } });
}
async function track(pid) {
  if (tracked.has(pid)) return;
  tracked.set(pid, undefined); // Unknown identity must not be mistaken for an empty, fully exited process set.
  const identity = await processIdentity(pid);
  assert(identity, "Owned process exited before identity capture.");
  tracked.set(pid, identity);
}
async function waitUntil(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out: ${label}`);
}
