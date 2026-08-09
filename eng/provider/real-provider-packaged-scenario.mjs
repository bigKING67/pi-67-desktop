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
  waitForRealProviderApprovalRequest,
  waitForRealProviderControlResponse
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
    onStage("runtime-initialize");
    await page.getByRole("button", { name: "选择工作区" }).click();
    await page.getByText("Pi SDK 已就绪", { exact: true }).waitFor({
      state: "visible",
      timeout: 30_000
    });
    await page.waitForFunction(
      () => Number.isSafeInteger(globalThis.__pi67ProviderLongTurnProbe?.hostEpoch),
      undefined,
      { timeout: 10_000 }
    );
    evidence.runtimeReady = true;

    onStage("workspace-trust");
    const trustButton = page.getByRole("button", { name: /信任并加载资源/u });
    await trustButton.waitFor({ state: "visible", timeout: 10_000 });
    await trustButton.click();
    await page.getByText("Pi 资源已就绪", { exact: true }).waitFor({
      state: "visible",
      timeout: 30_000
    });

    onStage("session-create");
    await page.getByRole("button", { name: "新建 Session" }).click();
    await page.getByRole("banner").getByText("Pi 新会话已就绪", { exact: true }).waitFor({
      state: "visible",
      timeout: 30_000
    });

    onStage("credential-install");
    await configureRuntimeProvider(page, config);
    evidence.credentialInstalled = true;
    onStage("model-select");
    const selection = await selectProviderModel(page, config);
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
      { timeout: 10_000 }
    );
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
      expectedCwd: directories.workspace,
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

async function configureRuntimeProvider(page, config) {
  await page.getByRole("button", { name: "打开更多菜单" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: /Provider 与凭据/u }).click();
  const dialog = page.getByRole("dialog", { name: "Provider 与凭据" });
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  const providerButton = dialog.locator(".provider-list button").filter({
    hasText: config.providerId
  });
  await providerButton.waitFor({ state: "visible", timeout: 10_000 });
  await providerButton.click();
  await dialog.getByLabel("Provider API 密钥", { exact: true }).fill(config.apiKey);
  await dialog.getByRole("button", {
    name: /启用本次运行密钥|替换本次运行密钥/u
  }).click();
  await dialog.getByText("来源：当前运行内存（完全退出后失效）", { exact: true }).waitFor({
    state: "visible",
    timeout: 30_000
  });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
}

async function selectProviderModel(page, config) {
  const modelValue = `${config.providerId}/${config.modelId}`;
  const model = page.getByLabel("Pi 模型", { exact: true });
  await model.locator(`option[value=${JSON.stringify(modelValue)}]`).waitFor({
    state: "attached",
    timeout: 30_000
  });
  await model.selectOption(modelValue);
  await waitForRealProviderControlResponse(page, "model.select");

  const thinking = page.getByLabel("Pi 思考级别", { exact: true });
  const thinkingOption = thinking.locator(
    `option[value=${JSON.stringify(config.thinkingLevel)}]`
  );
  await thinkingOption.waitFor({ state: "attached", timeout: 30_000 });
  await thinking.selectOption(config.thinkingLevel);
  await waitForRealProviderControlResponse(page, "thinking.set");
  await page.waitForFunction(
    ({ expectedModel, expectedThinking }) => {
      const modelSelect = document.querySelector("select[aria-label='Pi 模型']");
      const thinkingSelect = document.querySelector("select[aria-label='Pi 思考级别']");
      return modelSelect?.value === expectedModel && thinkingSelect?.value === expectedThinking;
    },
    { expectedModel: modelValue, expectedThinking: config.thinkingLevel },
    { timeout: 30_000 }
  );
  return {
    modelValue,
    effectiveThinkingLevel: await thinking.inputValue()
  };
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
