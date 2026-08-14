import {
  measureElectronApplicationShutdown,
  productShutdownWithinBudget
} from "./electron-shutdown-measurement.mjs";
import {
  installWorkspaceDialogResult,
  launchPackagedApplication
} from "./packaged-electron-fixture.mjs";
import {
  INSTALLED_RUNTIME_READINESS_TIMEOUT_MS,
  INSTALLED_SHUTDOWN_BUDGET_MS,
  waitForInstalledStartupSurface
} from "./windows-installed-application-lifecycle.mjs";
import { resolveRealUserWorkspaceAuthority } from "./windows-real-user-workspace-authority.mjs";

export async function bootstrapFreshProfileLaunch({
  agentDir,
  artifact,
  environmentDriftAgentDir,
  initializeFirstLaunch,
  lane,
  userDataDirectory,
  workspace
}) {
  let application;
  try {
    const startedAt = performance.now();
    application = await launchPackagedApplication({
      agentDir,
      artifact,
      environment: { PI67_TEST_CAPTURE_AGENT_INIT: "1" },
      offline: false,
      userDataDirectory
    });
    await application.evaluate((_electron, driftAgentDir) => {
      process.env.PI_CODING_AGENT_DIR = driftAgentDir;
    }, environmentDriftAgentDir);
    const mainPid = application.process().pid;
    const window = await application.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    const startupSurface = await waitForInstalledStartupSurface(window, false);
    if (startupSurface !== "workspace-picker") {
      throw new Error("Windows clean-profile bootstrap did not start from the Workspace picker.");
    }
    await installWorkspaceDialogResult(application, workspace);
    await window.getByRole("button", { name: "选择工作区" }).click();
    const workspaceCwd = await resolveRealUserWorkspaceAuthority(window, workspace, undefined);
    await initializeFirstLaunch({
      provisioningTimeoutMs: INSTALLED_RUNTIME_READINESS_TIMEOUT_MS
    });
    const runtime = window.locator(
      '[data-runtime-phase="stopped"], [data-runtime-phase="ready"], [data-runtime-phase="failed"]'
    );
    await runtime.first().waitFor({
      state: "visible",
      timeout: INSTALLED_RUNTIME_READINESS_TIMEOUT_MS
    });
    if (await window.locator('[data-runtime-phase="failed"]').isVisible()) {
      throw new Error("Windows clean-profile bootstrap entered a failed Runtime phase.");
    }
    const utilityPids = await application.evaluate(({ app }) => app.getAppMetrics()
      .filter((metric) => metric.type === "Utility")
      .map((metric) => metric.pid));
    if (utilityPids.length === 0) {
      throw new Error("Windows clean-profile bootstrap did not observe the Agent Host utility process.");
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
        `Windows clean-profile bootstrap product process shutdown exceeded ${INSTALLED_SHUTDOWN_BUDGET_MS}ms. `
        + `Shutdown diagnostics: ${JSON.stringify(shutdownMeasurement)}`
      );
    }
    return {
      closeDurationMs: round(shutdownMeasurement.productExitDurationMs),
      driverCloseDurationMs: round(shutdownMeasurement.driverCloseDurationMs),
      durationMs: round(performance.now() - startedAt),
      lane,
      profileMode: "fresh",
      shutdownProcesses: shutdownMeasurement.processes,
      startupSurface,
      workspaceAuthorityEstablished: Boolean(workspaceCwd)
    };
  } finally {
    if (application) await application.close();
  }
}

function round(value) {
  return Math.round(value * 10) / 10;
}
