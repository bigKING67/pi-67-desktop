import * as systemPath from "node:path";
import {
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
import { captureProcessOutput } from "./packaged-electron-smoke-scenarios.mjs";
import {
  assertHealthyWorkbench,
  assertNoFailureNotifications,
  verifyGitMetadataIsHidden
} from "./windows-real-user-health.mjs";
import {
  INSTALLED_RUNTIME_READINESS_TIMEOUT_MS,
  INSTALLED_SHUTDOWN_BUDGET_MS,
  waitForInstalledStartupSurface
} from "./windows-installed-application-lifecycle.mjs";
import { bootstrapFreshProfileLaunch } from "./windows-clean-profile-bootstrap.mjs";
import {
  activateCatalogSession,
  REAL_USER_RUNTIME_TIMEOUT_MS
} from "./windows-real-user-catalog-activation.mjs";
import { createControlledConversation } from "./windows-real-user-conversation.mjs";
import {
  shouldCreateInitialRealUserSession,
  waitForCatalogRequestStart,
  waitForCatalogState
} from "./windows-real-user-catalog-state.mjs";
import { inspectRealUserSessionCatalogDiscovery } from "./windows-real-user-catalog-discovery.mjs";
import { inspectRealUserSessionFile } from "./windows-real-user-session-creation.mjs";
import { resolveRealUserWorkspaceAuthority } from "./windows-real-user-workspace-authority.mjs";
export { canonicalContainedSessionPath } from "./windows-real-user-conversation.mjs";
import { verifyProviderConfiguration } from "./windows-real-user-provider-configuration.mjs";
import {
  assertModelRuntimeInitialization,
  parseInitializationObservations
} from "./windows-real-user-initialization.mjs";

export { REAL_USER_PROVIDER_TIMEOUT_MS } from "./windows-real-user-provider-configuration.mjs";
export { activateCatalogSession } from "./windows-real-user-catalog-activation.mjs";
export {
  assertModelRuntimeInitialization,
  parseInitializationObservations,
  REAL_USER_MODEL_RUNTIME_TIMEOUT_MS
} from "./windows-real-user-initialization.mjs";
export {
  REAL_USER_CATALOG_TIMEOUT_MS,
  shouldCreateInitialRealUserSession,
  waitForCatalogRequestStart,
  waitForCatalogState
} from "./windows-real-user-catalog-state.mjs";

export const REAL_USER_CREATE_TARGET_MS = 5_000;
export const REAL_USER_CREATE_HARD_TIMEOUT_MS = 15_000;
export const REAL_USER_MODEL_HYDRATION_TIMEOUT_MS = 30_000;
export const REAL_USER_WORKBENCH_CONVERGENCE_TIMEOUT_MS = 10_000;
export const REAL_USER_RESTART_COUNT = 3;

const POLL_INTERVAL_MS = 50;

export async function verifyInstalledRealUserLifecycle({
  agentDir,
  artifact,
  environmentDriftAgentDir,
  initializeFirstLaunch,
  lane,
  userDataDirectory,
  workspace
}) {
  if (!environmentDriftAgentDir) {
    throw new Error("Windows real-user lifecycle requires an environment-drift Agent directory.");
  }
  const launches = [];
  let expectedSessionIdentity;
  let expectedSessionPath;
  let expectedWorkspaceCwd;
  let create;
  const bootstrap = initializeFirstLaunch
    ? await bootstrapFreshProfileLaunch({
      agentDir,
      artifact,
      environmentDriftAgentDir,
      initializeFirstLaunch,
      lane,
      userDataDirectory,
      workspace
    })
    : undefined;

  for (let launchIndex = 0; launchIndex <= REAL_USER_RESTART_COUNT; launchIndex += 1) {
    const result = await runRealUserLaunch({
      agentDir,
      artifact,
      environmentDriftAgentDir,
      expectedSessionIdentity,
      expectedSessionPath,
      expectedWorkspaceCwd,
      lane,
      launchIndex,
      userDataDirectory,
      workspace
    });
    expectedSessionIdentity = result.sessionIdentity;
    expectedSessionPath = result.sessionPath;
    expectedWorkspaceCwd = result.workspaceCwd;
    create ??= result.create;
    launches.push(result.report);
  }

  if (!create || !expectedSessionIdentity) {
    throw new Error("Windows real-user lifecycle did not materialize a controlled Pi Session.");
  }
  return {
    create,
    ...(bootstrap ? { bootstrap } : {}),
    launchCount: launches.length + (bootstrap ? 1 : 0),
    launches,
    lane,
    offlineMode: "disabled",
    restartCount: REAL_USER_RESTART_COUNT
  };
}

async function runRealUserLaunch({
  agentDir,
  artifact,
  environmentDriftAgentDir,
  expectedSessionIdentity,
  expectedSessionPath,
  expectedWorkspaceCwd,
  lane,
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
    const workspaceCwd = await resolveRealUserWorkspaceAuthority(
      window,
      workspace,
      expectedWorkspaceCwd
    );

    const catalogRequestStart = await waitForCatalogRequestStart(window, INSTALLED_RUNTIME_READINESS_TIMEOUT_MS);
    const catalog = await waitForCatalogState(window, expectedSessionIdentity, undefined, {
      launchIndex,
      inspectExpectedSessionFile: () => inspectRealUserSessionFile(expectedSessionPath),
      inspectSessionCatalogDiscovery: () => inspectRealUserSessionCatalogDiscovery({
        agentDir,
        expectedSessionIdentity,
        sessionPath: expectedSessionPath,
        workspace: workspaceCwd
      })
    });
    let create;
    let sessionIdentity = expectedSessionIdentity;
    let sessionPath = expectedSessionPath;
    if (shouldCreateInitialRealUserSession({ catalog, expectedSessionIdentity, launchIndex })) {
      try {
        await waitForRealUserRuntimeReady(
          window,
          undefined,
          INSTALLED_RUNTIME_READINESS_TIMEOUT_MS
        );
      } catch (error) {
        const diagnostic = {
          initialization: parseInitializationObservations(processOutput()),
          surface: await inspectRealUserRuntimeSurface(window, systemPath.dirname(agentDir))
            .catch(() => ({ available: false }))
        };
        throw new Error(
          `Windows real-user initial Pi Runtime authority did not become ready. Diagnostics: ${JSON.stringify(diagnostic)}`,
          { cause: error }
        );
      }
      await assertHealthyWorkbench(window);
      const created = await createControlledConversation(window, agentDir, conversationContract());
      create = created.report;
      sessionIdentity = created.sessionIdentity;
      sessionPath = created.sessionPath;
    } else {
      sessionIdentity = await activateCatalogSession(window, expectedSessionIdentity);
    }
    const runtimeReadyMs = await waitForRealUserRuntimeReady(window, sessionIdentity);
    const launchToReadyMs = performance.now() - launchStartedAt;
    await waitForHealthyWorkbenchConvergence(window);
    const providerConfiguration = await verifyProviderConfiguration(window);
    const fileProjection = await verifyGitMetadataIsHidden(window);

    if (launchIndex === 0 && !create) {
      const created = await createControlledConversation(window, agentDir, conversationContract());
      create = created.report;
      sessionIdentity = created.sessionIdentity;
      sessionPath = created.sessionPath;
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
      budgetMs: INSTALLED_SHUTDOWN_BUDGET_MS,
      mainPid,
      utilityPids
    });
    application = undefined;
    if (!productShutdownWithinBudget(shutdownMeasurement, INSTALLED_SHUTDOWN_BUDGET_MS)) {
      throw new Error(
        `Windows real-user product process shutdown exceeded ${INSTALLED_SHUTDOWN_BUDGET_MS}ms. `
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
        catalogRequestStart,
        closeDurationMs: round(shutdownMeasurement.productExitDurationMs),
        driverCloseDurationMs: round(shutdownMeasurement.driverCloseDurationMs),
        fileProjection,
        initialization,
        launchToReadyMs: round(launchToReadyMs),
        lifecycleDurationMs: round(performance.now() - launchStartedAt),
        name: launchIndex === 0 ? "initial" : `restart-${launchIndex}`,
        lane,
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
      sessionIdentity,
      sessionPath,
      workspaceCwd
    };
  } finally {
    if (application) await application.close();
  }
}

export async function waitForRealUserRuntimeReady(
  window,
  expectedSessionIdentity,
  timeoutMs = REAL_USER_RUNTIME_TIMEOUT_MS
) {
  const startedAt = performance.now();
  const ready = window.locator('[data-runtime-phase="ready"]');
  const failed = window.locator('[data-runtime-phase="failed"]');
  await ready.or(failed).waitFor({ state: "visible", timeout: timeoutMs });
  if (await failed.isVisible()) {
    throw new Error("Windows real-user Pi Runtime entered a failed phase.");
  }
  const remaining = remainingTimeout(startedAt, timeoutMs);
  await window.getByLabel("Pi conversation").waitFor({ state: "visible", timeout: remaining });
  await waitForCondition(async () => {
    const observation = await window.evaluate((expectedIdentity) => {
      const selectedIdentity = document.querySelector(
        '[data-testid="conversation-row"][aria-current="page"]'
      )?.getAttribute("data-conversation-id");
      return {
        runtimePhase: document.querySelector("[data-runtime-phase]")?.getAttribute("data-runtime-phase") ?? null,
        selectionMatches: expectedIdentity === undefined || selectedIdentity === expectedIdentity
      };
    }, expectedSessionIdentity);
    if (observation.runtimePhase === "failed") {
      throw new Error("Windows real-user Pi Runtime entered a failed phase.");
    }
    return observation.runtimePhase === "ready" && observation.selectionMatches
      ? observation
      : undefined;
  }, remainingTimeout(startedAt, timeoutMs),
  "Windows real-user Pi Runtime did not become ready for the activated Catalog Session");
  return performance.now() - startedAt;
}

export async function inspectRealUserRuntimeSurface(window, privateRoot) {
  const observation = await window.evaluate(() => {
    const bodyText = document.body.innerText;
    const runtimeStatus = document.querySelector('[aria-label^="当前状态："]');
    const errorNotifications = [...document.querySelectorAll('[aria-label="通知"] [role="alert"]')];
    return {
      acknowledgementTimedOut: bodyText.includes("Agent request acknowledgement timed out"),
      errorNotificationCount: errorNotifications.length,
      errorNotificationMessages: errorNotifications.slice(0, 3).map((notification) => (
        notification.textContent?.trim().slice(0, 500) ?? ""
      )),
      errorNotificationTitles: errorNotifications.slice(0, 3).map((notification) => (
        notification.querySelector("strong")?.textContent?.trim().slice(0, 160) ?? null
      )),
      providerConfigurationFailed: bodyText.includes("无法读取 Pi Provider 配置"),
      runtimePhase: runtimeStatus?.getAttribute("data-runtime-phase") ?? null,
      runtimeStatus: runtimeStatus?.getAttribute("aria-label")?.slice(0, 160) ?? null,
      workspaceOpenFailed: bodyText.includes("无法打开工作区")
    };
  });
  const sanitize = (value) => typeof value === "string"
    ? value.replaceAll(privateRoot, "<temporary-root>")
    : value;
  return {
    ...observation,
    errorNotificationMessages: observation.errorNotificationMessages.map(sanitize),
    runtimeStatus: sanitize(observation.runtimeStatus)
  };
}

export async function waitForHealthyWorkbenchConvergence(
  window,
  timeoutMs = REAL_USER_WORKBENCH_CONVERGENCE_TIMEOUT_MS
) {
  const deadline = performance.now() + timeoutMs;
  let observation;
  do {
    observation = await window.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid="conversation-row"]')];
      const runningRows = rows.filter((row) => row.querySelector('[data-status="running"]'));
      return {
        rowCount: rows.length,
        runningCount: runningRows.length,
        selectedRunningCount: runningRows.filter((row) => row.getAttribute("aria-current") === "page").length
      };
    });
    if (observation.runningCount === 0) {
      await assertHealthyWorkbench(window);
      return observation;
    }
    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) break;
    await new Promise((resolvePromise) => setTimeout(
      resolvePromise,
      Math.max(1, Math.min(POLL_INTERVAL_MS, remainingMs))
    ));
  } while (performance.now() <= deadline);

  throw new Error(
    `Windows real-user lifecycle exposed a false running Session after ${timeoutMs}ms: `
    + JSON.stringify(observation)
  );
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

function conversationContract() {
  return {
    createHardTimeoutMs: REAL_USER_CREATE_HARD_TIMEOUT_MS,
    createTargetMs: REAL_USER_CREATE_TARGET_MS,
    modelHydrationTimeoutMs: REAL_USER_MODEL_HYDRATION_TIMEOUT_MS
  };
}
