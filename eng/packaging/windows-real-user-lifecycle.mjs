import { realpath, stat } from "node:fs/promises";
import * as systemPath from "node:path";
import {
  waitForProcessExit
} from "./controlled-shutdown-fixture.ts";
import {
  submitControlledPromptInput,
  waitForControlledModel,
  waitForControlledPromptRunning
} from "./controlled-provider-interaction.mjs";
import {
  measureElectronApplicationShutdown,
  productShutdownWithinBudget
} from "./electron-shutdown-measurement.mjs";
import {
  installWorkspaceDialogResult,
  launchPackagedApplication
} from "./packaged-electron-fixture.mjs";
import { captureProcessOutput } from "./packaged-electron-smoke-scenarios.mjs";
import {
  assertHealthyWorkbench,
  assertNoFailureNotifications,
  verifyGitMetadataIsHidden
} from "./windows-real-user-health.mjs";
import {
  readSelectedConversationIdentity,
  waitForInstalledStartupSurface
} from "./windows-installed-application-lifecycle.mjs";
import { assertSessionPathContained } from "./windows-installer-identity.mjs";
import {
  prepareRealUserSessionCreation,
  waitForSelectedProvisionalSessionIntent,
  waitForRealUserCreatedSession
} from "./windows-real-user-session-creation.mjs";
import { verifyProviderConfiguration } from "./windows-real-user-provider-configuration.mjs";
import {
  assertModelRuntimeInitialization,
  parseInitializationObservations
} from "./windows-real-user-initialization.mjs";

export { REAL_USER_PROVIDER_TIMEOUT_MS } from "./windows-real-user-provider-configuration.mjs";
export {
  assertModelRuntimeInitialization,
  parseInitializationObservations,
  REAL_USER_MODEL_RUNTIME_TIMEOUT_MS
} from "./windows-real-user-initialization.mjs";

export const REAL_USER_CATALOG_TIMEOUT_MS = 5_000;
export const REAL_USER_CREATE_TARGET_MS = 5_000;
export const REAL_USER_CREATE_HARD_TIMEOUT_MS = 15_000;
const REAL_USER_RUNTIME_TIMEOUT_MS = 15_000;
const REAL_USER_SHUTDOWN_BUDGET_MS = 5_000;
export const REAL_USER_RESTART_COUNT = 3;

const POLL_INTERVAL_MS = 50;
const SESSION_JSONL_TIMEOUT_MS = 10_000;

export async function verifyInstalledRealUserLifecycle({
  agentDir,
  artifact,
  environmentDriftAgentDir,
  userDataDirectory,
  workspace
}) {
  if (!environmentDriftAgentDir) {
    throw new Error("Windows real-user lifecycle requires an environment-drift Agent directory.");
  }
  const launches = [];
  let expectedSessionIdentity;
  let create;

  for (let launchIndex = 0; launchIndex <= REAL_USER_RESTART_COUNT; launchIndex += 1) {
    const result = await runRealUserLaunch({
      agentDir,
      artifact,
      environmentDriftAgentDir,
      expectedSessionIdentity,
      launchIndex,
      userDataDirectory,
      workspace
    });
    expectedSessionIdentity = result.sessionIdentity;
    create ??= result.create;
    launches.push(result.report);
  }

  if (!create || !expectedSessionIdentity) {
    throw new Error("Windows real-user lifecycle did not materialize a controlled Pi Session.");
  }
  return {
    create,
    launchCount: launches.length,
    launches,
    offlineMode: "disabled",
    restartCount: REAL_USER_RESTART_COUNT
  };
}

async function runRealUserLaunch({
  agentDir,
  artifact,
  environmentDriftAgentDir,
  expectedSessionIdentity,
  launchIndex,
  userDataDirectory,
  workspace
}) {
  let application;
  try {
    const launchStartedAt = performance.now();
    application = await launchPackagedApplication({
      agentDir,
      artifact,
      environment: { PI67_TEST_CAPTURE_AGENT_INIT: "1" },
      offline: false,
      userDataDirectory
    });
    const environmentDriftInjected = launchIndex === 0;
    if (environmentDriftInjected) {
      await application.evaluate((_electron, driftAgentDir) => {
        process.env.PI_CODING_AGENT_DIR = driftAgentDir;
      }, environmentDriftAgentDir);
    }
    const processOutput = captureProcessOutput(application.process());
    const mainPid = application.process().pid;
    const window = await application.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    if (window.url() !== "app://pi67/index.html") {
      throw new Error(`Windows real-user renderer did not use app://pi67: ${window.url()}.`);
    }
    const inheritedOfflineMode = await application.evaluate(() => process.env.PI_OFFLINE ?? null);
    if (inheritedOfflineMode !== null) {
      throw new Error("Windows real-user lifecycle unexpectedly inherited PI_OFFLINE.");
    }

    const startupSurface = await waitForInstalledStartupSurface(window, false);
    if (startupSurface === "workspace-picker") {
      if (launchIndex > 0) {
        throw new Error("Windows real-user restart lost the persisted Workspace registration.");
      }
      await installWorkspaceDialogResult(application, workspace);
      await window.getByRole("button", { name: "选择工作区" }).click();
    }

    const catalog = await waitForCatalogState(window, expectedSessionIdentity);
    let create;
    let sessionIdentity = expectedSessionIdentity;
    if (shouldCreateInitialRealUserSession({ catalog, expectedSessionIdentity, launchIndex })) {
      await assertHealthyWorkbench(window);
      const created = await createControlledConversation(window, agentDir);
      create = created.report;
      sessionIdentity = created.sessionIdentity;
    } else {
      await activateCatalogSession(window, expectedSessionIdentity);
    }
    const runtimeReadyMs = await waitForRealUserRuntimeReady(window);
    const launchToReadyMs = performance.now() - launchStartedAt;
    await assertHealthyWorkbench(window);
    const providerConfiguration = await verifyProviderConfiguration(window);
    const fileProjection = await verifyGitMetadataIsHidden(window);

    if (launchIndex === 0 && !create) {
      const created = await createControlledConversation(window, agentDir);
      create = created.report;
      sessionIdentity = created.sessionIdentity;
    }
    if (!sessionIdentity) {
      throw new Error("Windows real-user launch did not expose a materialized Session identity.");
    }

    await assertHealthyWorkbench(window);
    await assertNoFailureNotifications(window);
    const utilityPids = await application.evaluate(({ app }) => app.getAppMetrics()
      .filter((metric) => metric.type === "Utility")
      .map((metric) => metric.pid));
    if (utilityPids.length === 0) {
      throw new Error("Windows real-user lifecycle could not observe the Agent Host utility process.");
    }

    const shutdownMeasurement = await measureElectronApplicationShutdown({
      application,
      budgetMs: REAL_USER_SHUTDOWN_BUDGET_MS,
      mainPid,
      utilityPids
    });
    application = undefined;
    if (!productShutdownWithinBudget(shutdownMeasurement, REAL_USER_SHUTDOWN_BUDGET_MS)) {
      throw new Error(
        `Windows real-user product process shutdown exceeded ${REAL_USER_SHUTDOWN_BUDGET_MS}ms. `
        + `Shutdown diagnostics: ${JSON.stringify(shutdownMeasurement)}`
      );
    }
    if (mainPid !== undefined) await waitForProcessExit(mainPid);
    for (const pid of utilityPids) await waitForProcessExit(pid);
    const initialization = parseInitializationObservations(processOutput());
    const modelRuntimeInitialization = assertModelRuntimeInitialization(initialization);

    return {
      ...(create ? { create } : {}),
      report: {
        catalog,
        closeDurationMs: round(shutdownMeasurement.productExitDurationMs),
        driverCloseDurationMs: round(shutdownMeasurement.driverCloseDurationMs),
        fileProjection,
        initialization,
        launchToReadyMs: round(launchToReadyMs),
        lifecycleDurationMs: round(performance.now() - launchStartedAt),
        name: launchIndex === 0 ? "initial" : `restart-${launchIndex}`,
        profileAuthority: {
          environmentDriftInjected,
          mainOwnedAgentDirectoryVerified: environmentDriftInjected
        },
        providerConfiguration,
        shutdownProcesses: shutdownMeasurement.processes,
        modelRuntimeInitialization,
        runtimeReadyMs: round(runtimeReadyMs),
        startupSurface
      },
      sessionIdentity
    };
  } finally {
    if (application) await application.close();
  }
}

export async function waitForCatalogState(
  window,
  expectedSessionIdentity,
  timeoutMs = REAL_USER_CATALOG_TIMEOUT_MS
) {
  const startedAt = performance.now();
  const workspaceGroup = window.getByTestId("workspace-group").first();
  await workspaceGroup.waitFor({ state: "visible", timeout: timeoutMs });
  const observation = await waitForCondition(async () => {
    const current = await workspaceGroup.evaluate((element, expectedIdentity) => {
      const text = element.textContent ?? "";
      const sessionIdentities = [...element.querySelectorAll('[data-testid="conversation-row"]')]
        .map((row) => row.getAttribute("data-conversation-id"))
        .filter((identity) => identity?.startsWith("session:"));
      return {
        hasExpectedSession: expectedIdentity ? sessionIdentities.includes(expectedIdentity) : true,
        itemCount: sessionIdentities.length,
        text
      };
    }, expectedSessionIdentity);
    if (current.text.includes("Session 目录暂不可用")) {
      throw new Error("Windows real-user Session Catalog became unavailable.");
    }
    if (current.text.includes("Agent request acknowledgement timed out")) {
      throw new Error("Windows real-user Session Catalog exposed an acknowledgement timeout.");
    }
    if (!current.hasExpectedSession || current.text.includes("正在加载 Session")) return undefined;
    const explicitState = catalogStateFromText(current.text, current.itemCount);
    return explicitState ? { itemCount: current.itemCount, state: explicitState } : undefined;
  }, timeoutMs, "Windows real-user Session Catalog did not return an explicit state");
  const durationMs = performance.now() - startedAt;
  if (durationMs > timeoutMs) throw new Error(`Windows real-user Session Catalog exceeded ${timeoutMs}ms.`);
  return { ...observation, durationMs: round(durationMs) };
}

export function shouldCreateInitialRealUserSession({ catalog, expectedSessionIdentity, launchIndex }) {
  return launchIndex === 0
    && expectedSessionIdentity === undefined
    && catalog.itemCount === 0;
}

export async function activateCatalogSession(
  window,
  expectedSessionIdentity,
  timeoutMs = REAL_USER_RUNTIME_TIMEOUT_MS
) {
  const deadline = performance.now() + timeoutMs;
  const conversation = window.getByLabel("Pi conversation");
  const rows = window.locator('[data-testid="conversation-row"]');
  let observation = { provisionalRowCount: 0, rowCount: 0, sessionRowCount: 0 };

  while (performance.now() <= deadline) {
    if (await conversation.isVisible()) {
      if (!expectedSessionIdentity) return;
      const selectedIdentity = await readSelectedConversationIdentity(window);
      if (selectedIdentity === expectedSessionIdentity) return;
    }

    const rowCount = await rows.count();
    for (let index = 0; index < rowCount; index += 1) {
      const row = rows.nth(index);
      const identity = await row.getAttribute("data-conversation-id");
      if (
        (expectedSessionIdentity && identity === expectedSessionIdentity)
        || (!expectedSessionIdentity && identity?.startsWith("session:"))
      ) {
        await row.click({ timeout: Math.max(1, Math.ceil(deadline - performance.now())) });
        return;
      }
    }

    observation = await rows.evaluateAll((visibleRows) => ({
      provisionalRowCount: visibleRows.filter((row) => row.getAttribute("data-conversation-id")?.startsWith("provisional:"))
        .length,
      rowCount: visibleRows.length,
      sessionRowCount: visibleRows.filter((row) => row.getAttribute("data-conversation-id")?.startsWith("session:"))
        .length
    }));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Windows real-user lifecycle could not activate a Catalog-backed Session: ${JSON.stringify(observation)}`
  );
}

async function waitForRealUserRuntimeReady(window) {
  const startedAt = performance.now();
  const ready = window.locator('[data-runtime-phase="ready"]');
  const failed = window.locator('[data-runtime-phase="failed"]');
  await ready.or(failed).waitFor({ state: "visible", timeout: REAL_USER_RUNTIME_TIMEOUT_MS });
  if (await failed.isVisible()) {
    throw new Error("Windows real-user Pi Runtime entered a failed phase.");
  }
  const remaining = remainingTimeout(startedAt, REAL_USER_RUNTIME_TIMEOUT_MS);
  await window.getByLabel("Pi conversation").waitFor({ state: "visible", timeout: remaining });
  return performance.now() - startedAt;
}

async function createControlledConversation(window, agentDir) {
  const { createAction, existingIdentities, existingSessionFileNames } = await prepareRealUserSessionCreation(
    window,
    agentDir,
    REAL_USER_CREATE_HARD_TIMEOUT_MS
  );
  const intentStartedAt = performance.now();
  await createAction.click({ timeout: REAL_USER_CREATE_HARD_TIMEOUT_MS });
  await waitForSelectedProvisionalSessionIntent(
    window,
    agentDir,
    existingIdentities,
    existingSessionFileNames,
    intentStartedAt + REAL_USER_CREATE_HARD_TIMEOUT_MS
  );
  const intentDurationMs = performance.now() - intentStartedAt;

  const materializationStartedAt = performance.now();
  await submitControlledPromptInput(window);
  const createdSession = await waitForRealUserCreatedSession(
    window,
    existingIdentities,
    existingSessionFileNames,
    agentDir,
    materializationStartedAt + REAL_USER_CREATE_HARD_TIMEOUT_MS
  );
  const materializationDurationMs = performance.now() - materializationStartedAt;
  if (materializationDurationMs > REAL_USER_CREATE_HARD_TIMEOUT_MS) {
    throw new Error("Windows real-user session.create succeeded after its 15s hard gate.");
  }
  await canonicalContainedSessionPath(createdSession.sessionPath, agentDir);

  await waitForControlledModel(window, REAL_USER_CREATE_HARD_TIMEOUT_MS);
  await waitForControlledPromptRunning(window);
  await window.getByRole("button", { name: "停止", exact: true }).click({ timeout: 10_000 });
  await window.getByRole("button", { name: "停止", exact: true })
    .waitFor({ state: "hidden", timeout: 10_000 });
  await window.locator('[data-runtime-phase="ready"]').waitFor({ state: "visible", timeout: 10_000 });
  await waitForCondition(async () => (
    (await window.locator('[data-testid="conversation-row"][aria-current="page"]')
      .getByText("运行中", { exact: true }).count()) === 0
  ), 10_000, "Windows real-user controlled operation remained marked as running");

  return {
    report: {
      durationMs: round(materializationDurationMs),
      hardGateMs: REAL_USER_CREATE_HARD_TIMEOUT_MS,
      intentDurationMs: round(intentDurationMs),
      jsonlMaterialized: true,
      materializationTrigger: "first-prompt",
      operationOutcome: "user-stopped",
      provisionalIntentObserved: true,
      targetMet: materializationDurationMs <= REAL_USER_CREATE_TARGET_MS,
      targetMs: REAL_USER_CREATE_TARGET_MS
    },
    sessionIdentity: createdSession.sessionIdentity
  };
}

function catalogStateFromText(text, itemCount) {
  if (text.includes("Session 索引正在恢复")) return "fallback-recovering";
  if (text.includes("Session 索引暂时不可用")) return "fallback";
  if (text.includes("正在建立 Session 目录")) return "rebuilding";
  if (text.includes("未能读取全部 Session")) return "incomplete-empty";
  if (text.includes("这个工作区还没有会话")) return "ready-empty";
  if (itemCount > 0) return "ready";
  return undefined;
}

export async function canonicalContainedSessionPath(sessionPath, agentDir) {
  const canonicalAgentDir = await realpath(systemPath.resolve(agentDir)).catch(() => {
    throw new Error("Windows real-user isolated Agent directory could not be canonicalized.");
  });
  const resolvedSessionPath = systemPath.resolve(sessionPath);
  await waitForSessionJsonl(resolvedSessionPath);
  const canonicalSessionPath = await realpath(resolvedSessionPath).catch(() => {
    throw new Error("Windows real-user Pi Session JSONL could not be canonicalized.");
  });
  assertSessionPathContained(canonicalAgentDir, canonicalSessionPath);
  return canonicalSessionPath;
}

async function waitForSessionJsonl(sessionPath) {
  await waitForCondition(async () => {
    const metadata = await stat(sessionPath).catch(() => undefined);
    return metadata?.isFile() && metadata.size > 0 ? true : undefined;
  }, SESSION_JSONL_TIMEOUT_MS, "Windows real-user Pi Session JSONL did not materialize");
}

async function waitForCondition(action, timeoutMs, failureMessage) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() <= deadline) {
    const result = await action();
    if (result !== undefined && result !== false) return result;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
  }
  throw new Error(`${failureMessage} after ${timeoutMs}ms.`);
}

function remainingTimeout(startedAt, timeoutMs) {
  const remaining = Math.ceil(timeoutMs - (performance.now() - startedAt));
  if (remaining <= 0) throw new Error(`Windows real-user hard gate exceeded ${timeoutMs}ms.`);
  return remaining;
}

function round(value) {
  return Math.round(value * 10) / 10;
}
