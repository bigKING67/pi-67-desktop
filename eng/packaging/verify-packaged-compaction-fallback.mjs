import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPathContained,
  collectIsolatedSessionEvidence,
  sha256,
  snapshotDirectoryMetadata,
  watchDirectoryMutationDigests
} from "./packaged-context-isolation-receipt.mjs";
import {
  assertPackagedCompactionFallbackReceipt,
  PACKAGED_COMPACTION_FALLBACK_RECEIPT_SCHEMA
} from "./packaged-compaction-fallback-receipt.mjs";
import {
  packagedCompactionObserverSource,
  packagedCompactionProviderSource,
  startUnavailableOpenVikingTrap
} from "./packaged-compaction-fallback-fixture.mjs";
import {
  cleanupPackagedTestDirectories,
  createPackagedTestDirectories,
  installWorkspaceDialogResult,
  launchPackagedApplication,
  resolvePackagedArtifact
} from "./packaged-electron-fixture.mjs";
import { closeElectronApplicationWithinTimeout } from "./electron-shutdown-measurement.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const runId = randomUUID();
const providerApiKey = `pi67-compaction-provider-${randomUUID()}`;
const openVikingApiKey = `pi67-compaction-openviking-${randomUUID()}`;
const canonicalSessionRoot = join(homedir(), ".pi", "agent", "sessions");
const evidenceDirectory = process.env.PI67_COMPACTION_EVIDENCE_DIR?.trim()
  || join(repositoryRoot, "artifacts", "evidence", "packaged-compaction-fallback", runId);
const artifact = resolvePackagedArtifact();
const directories = await createPackagedTestDirectories("pi67-packaged-compaction-", "synthetic-workspace");
const providerObservationPath = join(directories.userDataDirectory, "provider-observations.jsonl");
const lifecycleObservationPath = join(directories.userDataDirectory, "compaction-lifecycle.jsonl");
const canonicalBefore = await snapshotDirectoryMetadata(canonicalSessionRoot);
if (!canonicalBefore.exists) {
  throw new Error("Canonical Pi Session root is absent; refusing to create or inspect it for a compaction receipt.");
}
const canonicalProbe = watchDirectoryMutationDigests(canonicalSessionRoot);
const unavailableOpenViking = await startUnavailableOpenVikingTrap();
let canonicalAfter = canonicalBefore;
let isolatedProfileRemoved = false;
let unavailableEndpointClosed = false;
let isolatedSessions = [];
let sessionEntries = [];
let providerObservations = [];
let lifecycleObservations = [];
let packagedLaunchCount = 0;
let firstApplication;
let secondApplication;
let runError;
let closeFailure;

try {
  await prepareCompactionProfile({
    ...directories,
    endpoint: unavailableOpenViking.endpoint,
    lifecycleObservationPath,
    providerApiKey,
    providerObservationPath
  });

  firstApplication = await launchCompactionApplication();
  packagedLaunchCount += 1;
  const firstWindow = await prepareWindow(firstApplication);
  await sendPromptAndWait(
    firstWindow,
    `Synthetic compaction preparation turn. ${"A".repeat(900)}`,
    "Synthetic pre-compaction turn."
  );
  await sendPromptAndWait(
    firstWindow,
    `Synthetic threshold turn. ${"B".repeat(900)}`,
    "Synthetic threshold turn."
  );
  await waitForAsync(async () => {
    const entries = await readIsolatedSessionEntries();
    return entries.filter((entry) => entry?.type === "compaction").length === 1;
  }, 30_000, "Pi default compaction entry");
  await sendPromptAndWait(
    firstWindow,
    "Continue after the threshold compaction.",
    "Synthetic post-compaction continuation."
  );
  await closeApplication(firstApplication, "first packaged compaction launch");
  firstApplication = undefined;

  secondApplication = await launchCompactionApplication();
  packagedLaunchCount += 1;
  const secondWindow = await prepareWindow(secondApplication);
  await secondWindow.getByTestId("virtuoso-item-list")
    .getByText("Synthetic post-compaction continuation.", { exact: true })
    .waitFor({ state: "visible", timeout: 30_000 });
  await sendPromptAndWait(
    secondWindow,
    "Continue after packaged restart and resume the same compacted Session.",
    "Synthetic resumed continuation."
  );
  await closeApplication(secondApplication, "second packaged compaction launch");
  secondApplication = undefined;

  isolatedSessions = await collectIsolatedSessionEvidence(directories.agentDir);
  if (isolatedSessions.length !== 1) {
    throw new Error(`Expected exactly one isolated Session, observed ${isolatedSessions.length}.`);
  }
  const sessionPath = join(directories.agentDir, isolatedSessions[0].relativePath);
  await Promise.all([
    assertPathContained(directories.userDataDirectory, directories.agentDir),
    assertPathContained(directories.userDataDirectory, directories.workspace),
    assertPathContained(directories.agentDir, sessionPath)
  ]);
  [sessionEntries, providerObservations, lifecycleObservations] = await Promise.all([
    readJsonl(sessionPath),
    readJsonl(providerObservationPath),
    readJsonl(lifecycleObservationPath)
  ]);
} catch (error) {
  runError = error;
} finally {
  const closeFailures = [];
  if (firstApplication) closeFailures.push(await closeApplicationResult(firstApplication, "first packaged compaction launch"));
  if (secondApplication) closeFailures.push(await closeApplicationResult(secondApplication, "second packaged compaction launch"));
  canonicalProbe.close();
  canonicalAfter = await snapshotDirectoryMetadata(canonicalSessionRoot);
  await unavailableOpenViking.close();
  unavailableEndpointClosed = await endpointUnavailable(unavailableOpenViking.endpoint);
  await cleanupPackagedTestDirectories(directories.userDataDirectory);
  isolatedProfileRemoved = !(await pathExists(directories.userDataDirectory));
  closeFailure = closeFailures.find(Boolean);
}
if (runError) throw runError;
if (closeFailure) throw closeFailure;

const compactionEntries = sessionEntries.filter((entry) => entry?.type === "compaction");
const compactionEntry = compactionEntries[0];
const beforeEvents = lifecycleObservations.filter((entry) => entry.kind === "before");
const afterEvents = lifecycleObservations.filter((entry) => entry.kind === "after");
const sessionStartEvents = lifecycleObservations.filter((entry) => entry.kind === "session-start");
const sessionIdHashes = new Set(sessionStartEvents.map((entry) => sha256(entry.sessionId)));
const sessionJsonl = sessionEntries.map((entry) => JSON.stringify(entry)).join("\n");
const summaries = providerObservations.filter((entry) => entry.kind === "summary");
const artifactMetadata = await stat(artifact.executablePath);
const receipt = {
  schema: PACKAGED_COMPACTION_FALLBACK_RECEIPT_SCHEMA,
  status: "passed",
  evidenceLevel: "packaged-electron-runtime",
  observedAt: new Date().toISOString(),
  runId,
  host: { platform: process.platform, arch: process.arch },
  artifact: {
    executablePath: relative(repositoryRoot, artifact.executablePath),
    byteLength: artifactMetadata.size,
    sha256: await sha256File(artifact.executablePath)
  },
  isolation: {
    agentDirectorySha256: sha256(directories.agentDir),
    userDataDirectorySha256: sha256(directories.userDataDirectory),
    workspaceSha256: sha256(directories.workspace),
    canonicalSessionRootPathSha256: sha256(canonicalSessionRoot),
    canonicalSessionRootBefore: canonicalBefore,
    canonicalSessionRootAfter: canonicalAfter,
    canonicalMutationEventCount: canonicalProbe.observations.length,
    canonicalMutationPathDigests: canonicalProbe.observations.map((entry) => entry.pathSha256),
    isolatedSessionCount: isolatedSessions.length,
    sessionPathContained: true,
    isolatedSession: isolatedSessions[0]
  },
  openViking: {
    state: "unavailable",
    transport: "isolated-loopback-tcp-reset",
    endpoint: unavailableOpenViking.endpoint,
    connectionAttempts: unavailableOpenViking.connectionAttempts,
    successfulResponses: 0
  },
  piCompaction: {
    trigger: beforeEvents[0]?.reason ?? null,
    entryCount: compactionEntries.length,
    fromExtension: compactionEntry?.fromHook === true,
    summaryMarkerObserved: compactionEntry?.summary?.includes("Synthetic Pi default compaction summary.") === true,
    summaryProviderCallCount: summaries.length,
    beforeEventCount: beforeEvents.length,
    afterEventCount: afterEvents.length,
    beforeReasons: beforeEvents.map((entry) => entry.reason),
    afterReasons: afterEvents.map((entry) => entry.reason),
    afterFromExtension: afterEvents.map((entry) => entry.fromExtension)
  },
  continuity: {
    continuedTurnObserved: sessionJsonl.includes("Synthetic post-compaction continuation."),
    resumeTurnObserved: sessionJsonl.includes("Synthetic resumed continuation."),
    packagedLaunchCount,
    sessionStartEventCount: sessionStartEvents.length,
    distinctSessionIdHashes: sessionIdHashes.size,
    sessionIdHashes: [...sessionIdHashes]
  },
  privacy: {
    credentialValueCountInJsonl: [providerApiKey, openVikingApiKey]
      .filter((value) => sessionJsonl.includes(value)).length
  },
  cleanup: { isolatedProfileRemoved, unavailableEndpointClosed }
};
assertPackagedCompactionFallbackReceipt(receipt);
await mkdir(evidenceDirectory, { recursive: true });
const receiptPath = join(evidenceDirectory, "receipt.json");
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({
  status: receipt.status,
  receiptPath,
  canonicalMutationEventCount: receipt.isolation.canonicalMutationEventCount,
  isolatedSessionCount: receipt.isolation.isolatedSessionCount,
  openVikingConnectionAttempts: receipt.openViking.connectionAttempts,
  compactionEntryCount: receipt.piCompaction.entryCount,
  compactionFromExtension: receipt.piCompaction.fromExtension,
  continuedTurnObserved: receipt.continuity.continuedTurnObserved,
  resumeTurnObserved: receipt.continuity.resumeTurnObserved,
  isolatedProfileRemoved,
  unavailableEndpointClosed
}));

async function launchCompactionApplication() {
  return launchPackagedApplication({
    agentDir: directories.agentDir,
    artifact,
    environment: {
      HOME: directories.userDataDirectory,
      USERPROFILE: directories.userDataDirectory,
      OPENVIKING_URL: unavailableOpenViking.endpoint,
      OPENVIKING_API_KEY: openVikingApiKey,
      OPENVIKING_ACCOUNT: `pi67-compaction-account-${runId}`,
      OPENVIKING_USER: `pi67-compaction-user-${runId}`,
      OPENVIKING_PEER_ID: `pi67-compaction-peer-${runId}`,
      OPENVIKING_WORKSPACE_PEER: "0"
    },
    hideNativeWindow: true,
    isolateNativeWindow: true,
    offline: false,
    userDataDirectory: directories.userDataDirectory
  });
}

async function prepareWindow(application) {
  const window = await application.firstWindow({ timeout: 60_000 });
  await window.waitForLoadState("domcontentloaded");
  const workspacePicker = window.getByRole("button", { name: "选择工作区" });
  const openConversation = window.getByRole("button", { name: "打开对话" });
  const readyStatus = window.getByLabel("当前状态：Pi SDK 已就绪");
  let initialState;
  try {
    await waitForAsync(async () => {
      if (await readyStatus.isVisible()) initialState = "ready";
      else if (await workspacePicker.isVisible()) initialState = "workspace-picker";
      else if (await openConversation.isVisible()) initialState = "conversation-closed";
      return initialState !== undefined;
    }, 30_000, "packaged Workspace or ready state");
  } catch (error) {
    const bodyText = (await window.locator("body").innerText()).slice(0, 2_000);
    throw new Error(`Packaged startup state was not actionable: ${JSON.stringify({
      bodyText,
      url: window.url()
    })}`, { cause: error });
  }
  if (initialState === "workspace-picker") {
    await installWorkspaceDialogResult(application, directories.workspace);
    await workspacePicker.click();
  } else if (initialState === "conversation-closed") {
    await openConversation.click();
  }
  await readyStatus.waitFor({ state: "visible", timeout: 45_000 });
  return window;
}

async function sendPromptAndWait(window, prompt, expectedResponse) {
  await window.getByRole("textbox", { name: "给 Pi 发送消息" }).fill(prompt);
  await window.getByRole("button", { name: "发送", exact: true }).click();
  await window.getByTestId("virtuoso-item-list")
    .getByText(expectedResponse, { exact: true })
    .waitFor({ state: "visible", timeout: 45_000 });
  await window.locator('[data-runtime-phase="ready"]').waitFor({ state: "visible", timeout: 45_000 });
}

async function prepareCompactionProfile({
  agentDir,
  endpoint,
  extensionsDirectory,
  lifecycleObservationPath: lifecyclePath,
  providerApiKey: apiKey,
  providerObservationPath: providerPath
}) {
  await Promise.all([
    writeFile(join(agentDir, "settings.json"), `${JSON.stringify({
      compaction: { enabled: true, reserveTokens: 2500, keepRecentTokens: 128 }
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }),
    writeFile(join(agentDir, "openviking.json"), `${JSON.stringify({
      endpoint,
      enabled: true,
      privacyMode: "private-learning",
      recallQueryExpansion: "off",
      takeover: { enabled: true, tokenThreshold: 1000, keepRecentTurns: 1 },
      healthTimeoutMs: 250,
      recallTimeoutMs: 250,
      logLevel: "silent"
    }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }),
    writeFile(
      join(extensionsDirectory, "compaction-provider.ts"),
      packagedCompactionProviderSource(providerPath, apiKey),
      "utf8"
    ),
    writeFile(
      join(extensionsDirectory, "compaction-observer.ts"),
      packagedCompactionObserverSource(lifecyclePath),
      "utf8"
    )
  ]);
}

async function readIsolatedSessionEntries() {
  const sessions = await collectIsolatedSessionEvidence(directories.agentDir);
  if (sessions.length !== 1) return [];
  return readJsonl(join(directories.agentDir, sessions[0].relativePath));
}

async function readJsonl(path) {
  const contents = await readFile(path, "utf8").catch((error) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  });
  return contents.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

async function closeApplication(application, label) {
  const failure = await closeApplicationResult(application, label);
  if (failure) throw failure;
}

async function closeApplicationResult(application, label) {
  const close = await closeElectronApplicationWithinTimeout({ application, timeoutMs: 5_000 });
  if (close.timedOut || close.error || close.mainAliveAfterClose) {
    return new Error(`${label} did not close cleanly: ${JSON.stringify(close)}`);
  }
  return undefined;
}

async function waitForAsync(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function endpointUnavailable(endpoint) {
  try {
    await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(500) });
    return false;
  } catch {
    return true;
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function sha256File(path) {
  return sha256(await readFile(path));
}
