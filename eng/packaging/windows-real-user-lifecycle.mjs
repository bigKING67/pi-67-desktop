import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  waitForProcessExit
} from "./controlled-shutdown-fixture.ts";
import { startControlledPrompt } from "./controlled-provider-interaction.mjs";
import {
  installWorkspaceDialogResult,
  launchPackagedApplication
} from "./packaged-electron-fixture.mjs";
import { captureProcessOutput } from "./packaged-electron-smoke-scenarios.mjs";
import { readSelectedConversationIdentity, waitForInstalledStartupSurface, waitForRealUserCreatedSession } from "./windows-installed-application-lifecycle.mjs";

export const REAL_USER_PROVIDER_TIMEOUT_MS = 10_000;
export const REAL_USER_CATALOG_TIMEOUT_MS = 5_000;
export const REAL_USER_CREATE_TARGET_MS = 5_000;
export const REAL_USER_CREATE_HARD_TIMEOUT_MS = 15_000;
const REAL_USER_RUNTIME_TIMEOUT_MS = 15_000;
export const REAL_USER_RESTART_COUNT = 3;

const POLL_INTERVAL_MS = 50;
const SESSION_JSONL_TIMEOUT_MS = 10_000;
const INITIALIZATION_STAGES = new Set([
  "resolve-session",
  "dispose-current",
  "create-session",
  "reload-configuration",
  "update-catalog",
  "project-snapshot"
]);

export async function verifyInstalledRealUserLifecycle({
  agentDir,
  artifact,
  userDataDirectory,
  workspace
}) {
  const launches = [];
  let expectedSessionIdentity;
  let create;

  for (let launchIndex = 0; launchIndex <= REAL_USER_RESTART_COUNT; launchIndex += 1) {
    const result = await runRealUserLaunch({
      agentDir,
      artifact,
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
      offline: false,
      userDataDirectory
    });
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

    const closeStartedAt = performance.now();
    await application.close();
    application = undefined;
    const closeDurationMs = performance.now() - closeStartedAt;
    if (closeDurationMs > 5_000) {
      throw new Error(`Windows real-user shutdown exceeded 5000ms: ${closeDurationMs.toFixed(1)}ms.`);
    }
    if (mainPid !== undefined) await waitForProcessExit(mainPid);
    for (const pid of utilityPids) await waitForProcessExit(pid);

    return {
      ...(create ? { create } : {}),
      report: {
        catalog,
        closeDurationMs: round(closeDurationMs),
        fileProjection,
        initialization: parseInitializationObservations(processOutput()),
        launchToReadyMs: round(launchToReadyMs),
        lifecycleDurationMs: round(performance.now() - launchStartedAt),
        name: launchIndex === 0 ? "initial" : `restart-${launchIndex}`,
        providerConfiguration,
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

async function activateCatalogSession(window, expectedSessionIdentity) {
  if (await window.getByLabel("Pi conversation").isVisible()) {
    if (!expectedSessionIdentity) return;
    const selectedIdentity = await readSelectedConversationIdentity(window);
    if (selectedIdentity === expectedSessionIdentity) return;
  }
  const rows = window.locator('[data-testid="conversation-row"]');
  const rowCount = await rows.count();
  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    const identity = await row.getAttribute("data-conversation-id");
    if (
      (expectedSessionIdentity && identity === expectedSessionIdentity)
      || (!expectedSessionIdentity && identity?.startsWith("session:"))
    ) {
      await row.click({ timeout: REAL_USER_RUNTIME_TIMEOUT_MS });
      return;
    }
  }
  const observation = await rows.evaluateAll((visibleRows) => ({
    provisionalRowCount: visibleRows.filter((row) => row.getAttribute("data-conversation-id")?.startsWith("provisional:"))
      .length,
    rowCount: visibleRows.length,
    sessionRowCount: visibleRows.filter((row) => row.getAttribute("data-conversation-id")?.startsWith("session:"))
      .length
  }));
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

export async function verifyProviderConfiguration(window) {
  const startedAt = performance.now();
  await window.keyboard.press("Control+,");
  const settings = window.getByLabel("π 设置");
  await settings.waitFor({ state: "visible", timeout: remainingTimeout(startedAt, REAL_USER_PROVIDER_TIMEOUT_MS) });
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^模型服务/u })
    .click({ timeout: remainingTimeout(startedAt, REAL_USER_PROVIDER_TIMEOUT_MS) });
  const panel = settings.getByTestId("provider-configuration-panel");
  const unavailable = settings.getByText("Pi 配置尚不可用", { exact: true });
  await panel.or(unavailable).waitFor({
    state: "visible",
    timeout: remainingTimeout(startedAt, REAL_USER_PROVIDER_TIMEOUT_MS)
  });
  if (await unavailable.isVisible()) {
    throw new Error("Windows real-user Provider configuration became unavailable.");
  }
  await panel.getByRole("textbox", { name: "搜索 Pi Provider" }).waitFor({
    state: "visible",
    timeout: remainingTimeout(startedAt, REAL_USER_PROVIDER_TIMEOUT_MS)
  });
  await settings.getByRole("button", { name: "返回工作台", exact: true })
    .click({ timeout: remainingTimeout(startedAt, REAL_USER_PROVIDER_TIMEOUT_MS) });
  await settings.waitFor({
    state: "hidden",
    timeout: remainingTimeout(startedAt, REAL_USER_PROVIDER_TIMEOUT_MS)
  });
  const durationMs = performance.now() - startedAt;
  if (durationMs > REAL_USER_PROVIDER_TIMEOUT_MS) {
    throw new Error(`Windows real-user Provider configuration exceeded ${REAL_USER_PROVIDER_TIMEOUT_MS}ms.`);
  }
  return { durationMs: round(durationMs), outcome: "ready" };
}

async function createControlledConversation(window, agentDir) {
  const existingIdentities = new Set(await window.locator('[data-testid="conversation-row"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-conversation-id")).filter(Boolean)));
  const startedAt = performance.now();
  await window.getByRole("button", { name: /^在 .+ 新建会话$/u }).first()
    .click({ timeout: REAL_USER_CREATE_HARD_TIMEOUT_MS });
  const sessionIdentity = await waitForRealUserCreatedSession(
    window,
    existingIdentities,
    startedAt + REAL_USER_CREATE_HARD_TIMEOUT_MS
  );
  const createDurationMs = performance.now() - startedAt;
  if (createDurationMs > REAL_USER_CREATE_HARD_TIMEOUT_MS) {
    throw new Error("Windows real-user session.create succeeded after its 15s hard gate.");
  }
  const sessionPath = sessionPathFromIdentity(sessionIdentity, agentDir);
  await waitForSessionJsonl(sessionPath);

  await startControlledPrompt(window);
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
      durationMs: round(createDurationMs),
      hardGateMs: REAL_USER_CREATE_HARD_TIMEOUT_MS,
      jsonlMaterialized: true,
      operationOutcome: "user-stopped",
      targetMet: createDurationMs <= REAL_USER_CREATE_TARGET_MS,
      targetMs: REAL_USER_CREATE_TARGET_MS
    },
    sessionIdentity
  };
}

async function verifyGitMetadataIsHidden(window) {
  let inspector = window.getByRole("complementary", { name: "任务检查器", exact: true });
  if (!(await inspector.isVisible())) {
    await window.getByRole("button", { name: "显示任务检查器", exact: true }).click({ timeout: 10_000 });
    inspector = window.getByRole("complementary", { name: "任务检查器", exact: true });
  }
  await inspector.waitFor({ state: "visible", timeout: 10_000 });
  await inspector.getByRole("tab", { name: "文件", exact: true }).click({ timeout: 10_000 });
  await inspector.locator(".inspector-file-name").getByText("README.md", { exact: true })
    .waitFor({ state: "visible", timeout: 10_000 });
  const rootNames = await inspector.locator(".inspector-file-name").allTextContents();
  if (rootNames.includes(".git")) throw new Error("Windows real-user file projection exposed .git metadata.");

  const search = inspector.getByRole("textbox", { name: "搜索工作区文件" });
  await search.fill(".git");
  await search.press("Enter");
  await inspector.getByText("没有匹配的文件。", { exact: true })
    .waitFor({ state: "visible", timeout: 10_000 });
  const searchNames = await inspector.locator(".inspector-file-name").allTextContents();
  if (searchNames.some((name) => name === ".git" || name.startsWith(".git/"))) {
    throw new Error("Windows real-user file search exposed .git metadata.");
  }
  await search.fill("");
  return { gitMetadataHidden: true, readmeVisible: true };
}

async function assertHealthyWorkbench(window) {
  const observation = await window.evaluate(() => {
    const bodyText = document.body.innerText;
    const rows = [...document.querySelectorAll('[data-testid="conversation-row"]')];
    return {
      ghostCount: rows.filter((row) => row.getAttribute("data-conversation-id")?.startsWith("provisional:"))
        .length,
      rawAcknowledgementTimeout: bodyText.includes("Agent request acknowledgement timed out"),
      rawEnoent: /ENOENT|no such file or directory/iu.test(bodyText),
      runningCount: rows.filter((row) => row.textContent?.includes("运行中")).length
    };
  });
  if (observation.ghostCount > 0) throw new Error("Windows real-user lifecycle exposed a provisional ghost Session.");
  if (observation.rawAcknowledgementTimeout) throw new Error("Windows real-user lifecycle exposed a raw acknowledgement timeout.");
  if (observation.rawEnoent) throw new Error("Windows real-user lifecycle exposed a raw ENOENT error.");
  if (observation.runningCount > 0) throw new Error("Windows real-user lifecycle exposed a false running Session.");
}

async function assertNoFailureNotifications(window) {
  await window.getByRole("button", { name: /打开通知中心/u }).click({ timeout: 10_000 });
  const dialog = window.getByRole("dialog", { name: "通知中心" });
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  const text = (await dialog.textContent()) ?? "";
  if (/Agent request acknowledgement timed out|ENOENT|no such file or directory/iu.test(text)) {
    throw new Error("Windows real-user notification history exposed a raw transport or ENOENT error.");
  }
  if (text.includes("无法读取 Pi Provider 配置")) {
    throw new Error("Windows real-user notification history contains a Provider configuration failure.");
  }
  await window.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
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

function sessionPathFromIdentity(identity, agentDir) {
  const match = /^session:[^:]+:(.+)$/u.exec(identity);
  if (!match) throw new Error("Windows real-user Session identity is malformed.");
  const sessionPath = resolve(match[1]);
  const relativePath = relative(resolve(agentDir), sessionPath);
  if (isAbsolute(relativePath) || /^\.\.(?:[\\/]|$)/u.test(relativePath)) {
    throw new Error("Windows real-user Session JSONL resolved outside the isolated Agent directory.");
  }
  return sessionPath;
}

async function waitForSessionJsonl(sessionPath) {
  await waitForCondition(async () => {
    const metadata = await stat(sessionPath).catch(() => undefined);
    return metadata?.isFile() && metadata.size > 0 ? true : undefined;
  }, SESSION_JSONL_TIMEOUT_MS, "Windows real-user Pi Session JSONL did not materialize");
}

export function parseInitializationObservations(output) {
  return output.split(/\r?\n/u).flatMap((line) => {
    if (!line.startsWith("[agent-host:init] ")) return [];
    try {
      const observation = JSON.parse(line.slice("[agent-host:init] ".length));
      return INITIALIZATION_STAGES.has(observation.stage)
        && ["started", "completed", "failed"].includes(observation.outcome)
        && Number.isFinite(observation.durationMs)
        ? [{
            durationMs: Math.max(0, Math.round(observation.durationMs)),
            outcome: observation.outcome,
            stage: observation.stage
          }]
        : [];
    } catch {
      return [];
    }
  });
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
