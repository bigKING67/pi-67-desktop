import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import { configureRuntimeProvider, selectProviderModel } from "./real-provider-startup-ui.mjs";
import { installProviderStartupReceipt, readProviderStartupSelection } from "./real-provider-startup-receipt.mjs";
import { _electron as electron } from "@playwright/test";
import { installWorkspaceDialogResult } from "../packaging/packaged-electron-fixture.mjs";
import {
  authorizeControlledProviderApproval,
  CONTROLLED_PROVIDER_TOOL_NAME
} from "./controlled-provider-approval.mjs";
import {
  createIsolatedProviderEnvironment,
  readControlledToolLifecycle,
  waitForControlledToolLifecycle
} from "./real-provider-long-turn-fixture.mjs";
import {
  installProtocolReceiptProbe,
  markProviderPromptSubmission,
  readRealProviderProtocolProbe,
  waitForRealProviderApprovalRequest
} from "./real-provider-protocol-receipt.mjs";

const PROVIDER_PROMPT = [
  `Call the tool ${CONTROLLED_PROVIDER_TOOL_NAME} exactly once with an empty object.`,
  "Wait until the tool returns, then reply only with PI67_LONG_TURN_PROVIDER_COMPLETED."
].join(" ");
const PRE_TOOL_TIMEOUT_MS = 180_000;
const POST_TOOL_SETTLE_TIMEOUT_MS = 180_000;

export async function runRealProviderPackagedScenario({
  artifact,
  config,
  directories,
  evidence,
  lifecyclePath,
  onStage
}) {
  let application;
  try {
    const expectedCwd = await realpath(directories.workspace);
    onStage("packaged-launch");
    application = await electron.launch({
      executablePath: artifact.executablePath,
      args: [`--user-data-dir=${directories.userDataDirectory}`],
      env: await createIsolatedProviderEnvironment(directories)
    });
    evidence.applicationLaunched = true;
    await installWorkspaceDialogResult(application, directories.workspace);

    const page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    onStage("renderer-boundary");
    await assertProviderRendererBoundary(page);
    evidence.rendererBoundaryVerified = true;
    await installProtocolReceiptProbe(page);
    await page.evaluate(installProviderStartupReceipt);
    onStage("runtime-initialize");
    await page.getByRole("button", { name: "选择工作区" }).click();
    await page.getByLabel("当前状态：Pi SDK 已就绪", { exact: true }).waitFor({
      state: "visible",
      timeout: 30_000
    });
    await page.waitForFunction(
      () => Number.isSafeInteger(globalThis.__pi67ProviderLongTurnProbe?.hostEpoch),
      undefined,
      { timeout: 10_000 }
    );
    evidence.runtimeReady = true;

    onStage("session-create");
    await page.getByRole("button", {
      name: `在 ${basename(directories.workspace)} 新建对话`, exact: true
    }).click();
    await page.getByTestId("new-session-intent").waitFor({ state: "visible" });
    await page.locator('[data-testid="conversation-row"][aria-current="page"][data-conversation-id^="provisional:"]')
      .waitFor({ state: "visible" });

    onStage("credential-install");
    await configureRuntimeProvider(page, config);
    evidence.credentialInstalled = true;
    onStage("model-select");
    // Credential setup may materialize the draft before model/thinking selection.
    await page.evaluate(() => { globalThis.__pi67ProviderStartupReceipt.armed = true; });
    await selectProviderModel(page, config);
    evidence.modelSelected = true;
    onStage("prompt-submit");
    await page.getByLabel("给 Pi 发送消息", { exact: true }).fill(PROVIDER_PROMPT);
    await markProviderPromptSubmission(page);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    evidence.promptSubmitted = true;
    onStage("prompt-ack");
    await page.waitForFunction(
      () => Number.isFinite(globalThis.__pi67ProviderLongTurnProbe?.acceptedAt),
      undefined,
      { timeout: 60_000 }
    );
    const selection = await readProviderStartupSelection(page, config);
    evidence.promptAccepted = true;

    onStage("tool-approval");
    const approval = page.getByRole("dialog", { name: "工具单次授权" });
    const firstOutcome = await Promise.race([
      approval.waitFor({ state: "visible", timeout: PRE_TOOL_TIMEOUT_MS }).then(() => "approval"),
      page.waitForFunction(
        () => globalThis.__pi67ProviderLongTurnProbe?.terminal !== undefined,
        undefined,
        { timeout: PRE_TOOL_TIMEOUT_MS }
      ).then(() => "terminal")
    ]);
    if (firstOutcome !== "approval") {
      throw new Error("Provider Operation terminated before the controlled Tool requested approval.");
    }
    await waitForRealProviderApprovalRequest(page);
    const approvalProtocol = await readRealProviderProtocolProbe(page);
    await authorizeControlledProviderApproval({
      dialog: approval,
      expectedCwd,
      protocol: approvalProtocol
    });
    evidence.toolApproved = true;
    onStage("tool-execution");
    await waitForControlledToolLifecycle(lifecyclePath, "started", 15_000);
    evidence.toolStarted = true;

    onStage("operation-terminal");
    await page.waitForFunction(
      () => globalThis.__pi67ProviderLongTurnProbe?.terminal !== undefined,
      undefined,
      { timeout: config.toolDelayMs + POST_TOOL_SETTLE_TIMEOUT_MS }
    );
    evidence.terminalObserved = true;
    const protocol = await readRealProviderProtocolProbe(page);
    if (protocol.terminal?.type === "operation.completed") {
      await page.getByText("PI67_LONG_TURN_PROVIDER_COMPLETED", { exact: true }).waitFor({
        state: "visible",
        timeout: 30_000
      });
      protocol.completionMarkerObserved = true;
    }
    const host = await resolveAgentHost(application);
    const rendererUrl = page.url();
    const appVersion = await application.evaluate(({ app }) => app.getVersion());
    const lifecycle = await readControlledToolLifecycle(lifecyclePath);
    evidence.toolCompleted = true;

    await application.close();
    application = undefined;
    return {
      appVersion,
      hostPid: host.pid,
      lifecycle,
      protocol,
      rendererUrl,
      selection
    };
  } finally {
    await application?.close().catch(() => undefined);
  }
}

async function assertProviderRendererBoundary(page) {
  const boundary = await page.evaluate(() => ({
    href: window.location.href,
    nodeProcessType: typeof globalThis.process,
    nodeRequireType: typeof globalThis.require
  }));
  if (boundary.href !== "app://pi67/index.html") {
    throw new Error("Packaged Provider certification requires app://pi67/index.html.");
  }
  if (boundary.nodeProcessType !== "undefined" || boundary.nodeRequireType !== "undefined") {
    throw new Error("Packaged Provider certification requires a sandboxed Renderer boundary.");
  }
}

async function resolveAgentHost(application) {
  const utilities = await application.evaluate(({ app }) => app.getAppMetrics()
    .filter((metric) => metric.type === "Utility")
    .map((metric) => ({ pid: metric.pid, name: metric.name })));
  const named = utilities.find((utility) => utility.name.includes("Pi-67 Agent Host"));
  if (named) return named;
  if (utilities.length === 1) return utilities[0];
  throw new Error("Packaged Agent Host process identity is ambiguous.");
}
