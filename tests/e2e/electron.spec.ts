import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isProcessAlive,
  readPositiveProcessId,
  waitForProcessExit,
  writeControlledShutdownExtension
} from "../../eng/packaging/controlled-shutdown-fixture.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
);

test("boots the real sandboxed Electron shell over app://", async () => {
  test.setTimeout(90_000);

  const temporaryRoot = await mkdtemp(join(tmpdir(), "pi67-electron-shell-"));
  const agentDir = join(temporaryRoot, "agent");
  await mkdir(agentDir);

  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    application = await electron.launch({
      args: [".", `--user-data-dir=${join(temporaryRoot, "profile")}`],
      cwd: root,
      env: {
        ...inheritedEnvironment,
        NODE_ENV: "test",
        PI_CODING_AGENT_DIR: agentDir,
        PI_OFFLINE: "1"
      }
    });
    const activeApplication = application;
    forwardElectronDebugOutput(activeApplication);
    const window = await activeApplication.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await expect(window).toHaveTitle("π");
    expect(window.url()).toBe("app://pi67/index.html");
    await expect(window.getByRole("heading", { name: "开始一个 Pi 会话" })).toBeVisible();
    await expect(window.getByText("选择一个工作区，继续已有 Pi 会话或开始新会话。")).toBeVisible();
    await expect(window.getByRole("button", { name: "选择工作区" })).toBeEnabled();
    await expect(window.getByText("数据保存在本机")).toBeVisible();
    await expect(window.locator("html")).toHaveAttribute("data-theme-preference", "system");

    const utilityProcessesBefore = await utilityProcessCount(activeApplication);
    await window.evaluate(() => {
      const scope = globalThis as unknown as { pi67: { system: { connectAgentHost(): Promise<void> } } };
      return scope.pi67.system.connectAgentHost();
    });
    await expect.poll(() => utilityProcessCount(activeApplication)).toBeGreaterThan(utilityProcessesBefore);

    const settings = await openRuntimeSettings(window);
    const doctorDialog = window.getByRole("dialog", { name: "运行环境诊断" });
    await settings.getByRole("button", { name: /运行环境诊断/u }).click();
    await expect(doctorDialog).toBeVisible();
    await doctorDialog.getByRole("button", { name: "运行检查" }).click();
    await expect(doctorDialog.getByLabel("运行环境检查结果").getByText("Pi SDK")).toBeVisible({ timeout: 30_000 });
    await doctorDialog.getByRole("button", { name: "关闭" }).click();

    const security = await window.evaluate(() => {
      const scope = globalThis as unknown as Record<string, unknown>;
      return {
        hasNodeProcess: "process" in scope,
        hasRequire: "require" in scope,
        hasBridge: typeof (scope.pi67 as { system?: unknown } | undefined)?.system === "object"
      };
    });
    expect(security).toEqual({ hasNodeProcess: false, hasRequire: false, hasBridge: true });
  } finally {
    await application?.close();
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test("initializes and trusts a workspace through the on-demand real Agent Host", async () => {
  test.setTimeout(90_000);

  const temporaryRoot = await mkdtemp(join(tmpdir(), "pi67-electron-workspace-"));
  const workspace = join(temporaryRoot, "workspace");
  const agentDir = join(temporaryRoot, "agent");
  await Promise.all([mkdir(workspace), mkdir(agentDir)]);

  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    application = await electron.launch({
      args: [".", `--user-data-dir=${join(temporaryRoot, "profile")}`],
      cwd: root,
      env: {
        ...inheritedEnvironment,
        NODE_ENV: "test",
        PI_CODING_AGENT_DIR: agentDir,
        PI_OFFLINE: "1"
      }
    });
    forwardElectronDebugOutput(application);
    await application.evaluate(({ dialog }, selectedWorkspace) => {
      Object.defineProperty(dialog, "showOpenDialog", {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [selectedWorkspace] })
      });
    }, workspace);

    const window = await application.firstWindow();
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1_024, 684);
    });
    await window.waitForLoadState("domcontentloaded");
    await window.getByRole("button", { name: "选择工作区" }).click();
    await expect(window.getByText("Pi SDK 已就绪", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(window.getByLabel("Pi conversation")).toBeVisible();
    await expect(window.getByLabel("π 设置")).toHaveCount(0);
    await expect(window.locator('[data-testid="conversation-row"]')).toHaveCount(1);
    await expect(window.getByTestId("inspector-toggle")).toBeVisible();

    const settings = await openRuntimeSettings(window);
    const doctorDialog = window.getByRole("dialog", { name: "运行环境诊断" });
    await settings.getByRole("button", { name: /运行环境诊断/u }).click();
    await doctorDialog.getByRole("button", { name: "运行检查" }).click();
    const catalogCheck = doctorDialog.locator(".doctor-check").filter({ hasText: "Session 目录" });
    await expect(catalogCheck.getByText("通过", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(catalogCheck.getByText(/schema v1; ready/u)).toBeVisible();
    await doctorDialog.getByRole("button", { name: "关闭" }).click();
    await settings.getByRole("button", { name: "返回工作台" }).click();
    await expect(window.getByLabel("Pi conversation")).toBeVisible();
    await expect(window.getByRole("complementary", { name: "会话导航" })).toBeVisible();

    await expect(window.getByText("工作区尚未信任")).toHaveCount(0);

    const createSessionButton = window.getByRole("button", { name: "在 workspace 新建会话" });
    await expect(createSessionButton).toBeEnabled();
    await createSessionButton.click();
    await expect(createSessionButton).toBeDisabled();
    await expect(window.getByRole("banner").getByText("Pi 新会话已就绪", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(createSessionButton).toBeEnabled();

    const utilityProcessesBeforePortRenewal = await utilityProcessCount(application);
    const renewedPort = await window.evaluate(() => new Promise<{ hostEpoch: number; portCount: number }>((resolve, reject) => {
      const browserWindow = globalThis as unknown as Window & typeof globalThis;
      const timeout = browserWindow.setTimeout(() => {
        browserWindow.removeEventListener("message", onMessage);
        reject(new Error("Timed out waiting for the renewed Agent Host Port."));
      }, 10_000);
      const onMessage = (event: MessageEvent) => {
        const data = event.data as { source?: unknown; type?: unknown; hostEpoch?: unknown } | undefined;
        if (
          event.source !== browserWindow
          || data?.source !== "pi67-preload"
          || data.type !== "agent-port"
          || !Number.isSafeInteger(data.hostEpoch)
        ) return;
        browserWindow.clearTimeout(timeout);
        browserWindow.removeEventListener("message", onMessage);
        resolve({ hostEpoch: Number(data.hostEpoch), portCount: event.ports.length });
      };
      browserWindow.addEventListener("message", onMessage);
      const scope = globalThis as unknown as {
        pi67: { system: { connectAgentHost(options?: { replaceCurrent?: boolean }): Promise<void> } }
      };
      void scope.pi67.system.connectAgentHost({ replaceCurrent: true }).catch((error: unknown) => {
        browserWindow.clearTimeout(timeout);
        browserWindow.removeEventListener("message", onMessage);
        reject(error instanceof Error ? error : new Error("Agent Host reconnect failed."));
      });
    }));
    expect(renewedPort.portCount).toBe(1);
    await expect.poll(() => utilityProcessCount(application!)).toBe(utilityProcessesBeforePortRenewal);
    await expect(window.getByRole("banner").getByText("Pi 会话已恢复", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(createSessionButton).toBeEnabled();
    await expect(window.getByText(/extension ctx is stale/iu)).toHaveCount(0);

    await application.evaluate(({ powerMonitor }) => powerMonitor.emit("resume"));
    await expect(window.getByRole("banner").getByText("系统恢复后 Pi 状态已重新同步", { exact: true }))
      .toBeVisible({ timeout: 30_000 });
    await expect(createSessionButton).toBeEnabled();
  } finally {
    if (application) await application.close();
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test("refreshes the session tree after rollback without a transition BUSY warning", async () => {
  test.setTimeout(90_000);

  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "pi67-electron-tree-refresh-")));
  const workspace = join(temporaryRoot, "workspace");
  const agentDir = join(temporaryRoot, "agent");
  const sessionDirectory = piDefaultSessionDirectory(workspace, agentDir);
  await Promise.all([
    mkdir(workspace),
    mkdir(sessionDirectory, { recursive: true })
  ]);
  await writeRollbackSessionFixture(join(sessionDirectory, "rollback-race.jsonl"), workspace);

  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    application = await electron.launch({
      args: [".", `--user-data-dir=${join(temporaryRoot, "profile")}`],
      cwd: root,
      env: {
        ...inheritedEnvironment,
        NODE_ENV: "test",
        PI_CODING_AGENT_DIR: agentDir,
        PI_OFFLINE: "1"
      }
    });
    forwardElectronDebugOutput(application);
    await application.evaluate(({ dialog }, selectedWorkspace) => {
      Object.defineProperty(dialog, "showOpenDialog", {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [selectedWorkspace] })
      });
    }, workspace);

    const window = await application.firstWindow();
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1_024, 684);
    });
    await window.waitForLoadState("domcontentloaded");
    await window.getByRole("button", { name: "选择工作区" }).click();
    await expect(window.getByText("Pi SDK 已就绪", { exact: true })).toBeVisible({ timeout: 30_000 });

    const fixtureSession = window
      .locator('[data-testid="conversation-row"]')
      .filter({ hasText: "Rollback race fixture" });
    await expect(fixtureSession).toBeVisible({ timeout: 30_000 });
    await fixtureSession.click();
    await expect(window.getByRole("banner").getByText("Pi SDK 已就绪", { exact: true }))
      .toBeVisible({ timeout: 30_000 });
    await expect(window.getByText("Rollback fixture assistant response.", { exact: true })).toBeVisible();

    const settings = await openRuntimeSettings(window);
    await settings.getByRole("button", { name: "返回工作台" }).click();
    await expect(window.getByText("Rollback fixture assistant response.", { exact: true })).toBeVisible();

    await window.getByTestId("inspector-toggle").click();
    const contextPane = window.getByRole("complementary", { name: "会话上下文" });
    await window.getByRole("tab", { name: "会话" }).click();
    const sessionTree = window.locator(".session-tree");
    const rollbackTarget = sessionTree.getByRole("button", { name: /Rollback fixture user message/u });
    await expect(rollbackTarget).toBeVisible();
    await rollbackTarget.click();

    await expect(window.getByRole("banner").getByText("Pi 会话已回退", { exact: true }))
      .toBeVisible({ timeout: 30_000 });
    await expect(contextPane).not.toContainText("等待同步");
    await expect(window.getByText("无法刷新会话树", { exact: true })).toHaveCount(0);
    await expect(window.getByText("A session transition is in progress.", { exact: true })).toHaveCount(0);

    const notificationTrigger = window.locator('button[aria-describedby="notification-center-tooltip"]');
    await notificationTrigger.click();
    const notificationCenter = window.getByRole("dialog", { name: "通知中心" });
    await expect(notificationCenter).toBeVisible();
    await expect(notificationCenter).not.toContainText("无法刷新会话树");
    await expect(notificationCenter).not.toContainText("A session transition is in progress.");
  } finally {
    if (application) await application.close();
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

test("closes an active Extension command and its child process within the shutdown budget", async () => {
  test.setTimeout(90_000);

  const temporaryRoot = await mkdtemp(join(tmpdir(), "pi67-electron-shutdown-"));
  const workspace = join(temporaryRoot, "workspace");
  const agentDir = join(temporaryRoot, "agent");
  const extensionsDirectory = join(agentDir, "extensions");
  const childPidPath = join(temporaryRoot, "child.pid");
  const lifecyclePath = join(temporaryRoot, "lifecycle.txt");
  await Promise.all([mkdir(workspace), mkdir(extensionsDirectory, { recursive: true })]);
  await writeControlledShutdownExtension({
    extensionPath: join(extensionsDirectory, "shutdown-fixture.ts"),
    childPidPath,
    lifecyclePath
  });

  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let childPid: number | undefined;
  try {
    application = await electron.launch({
      args: [".", `--user-data-dir=${join(temporaryRoot, "profile")}`],
      cwd: root,
      env: {
        ...inheritedEnvironment,
        NODE_ENV: "test",
        PI_CODING_AGENT_DIR: agentDir,
        PI_OFFLINE: "1"
      }
    });
    forwardElectronDebugOutput(application);
    await application.evaluate(({ dialog }, selectedWorkspace) => {
      Object.defineProperty(dialog, "showOpenDialog", {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [selectedWorkspace] })
      });
    }, workspace);

    const window = await application.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.getByRole("button", { name: "选择工作区" }).click();
    await expect(window.getByText("Pi SDK 已就绪", { exact: true })).toBeVisible({ timeout: 30_000 });
    await window.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    const command = window.getByRole("option", {
      name: "/hold-open Start a controlled child process until Pi shuts down"
    });
    await expect(command).toBeVisible({ timeout: 10_000 });
    await command.click();

    childPid = await readPositiveProcessId(childPidPath);
    expect(isProcessAlive(childPid)).toBe(true);
    const utilityPids = await utilityProcessIds(application);
    expect(utilityPids.length).toBeGreaterThan(0);

    const closeStartedAt = Date.now();
    await application.close();
    application = undefined;
    const closeDurationMs = Date.now() - closeStartedAt;

    expect(closeDurationMs).toBeLessThanOrEqual(5_000);
    await waitForProcessExit(childPid);
    expect(isProcessAlive(childPid)).toBe(false);
    for (const pid of utilityPids) {
      await waitForProcessExit(pid);
      expect(isProcessAlive(pid)).toBe(false);
    }
    expect(await readFile(lifecyclePath, "utf8")).toContain("shutdown:quit");
  } finally {
    if (application) await application.close();
    if (childPid !== undefined && isProcessAlive(childPid)) process.kill(childPid);
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

async function utilityProcessCount(application: Awaited<ReturnType<typeof electron.launch>>): Promise<number> {
  return application.evaluate(({ app }) => app.getAppMetrics().filter((metric) => metric.type === "Utility").length);
}

async function utilityProcessIds(application: Awaited<ReturnType<typeof electron.launch>>): Promise<number[]> {
  return application.evaluate(({ app }) => app.getAppMetrics()
    .filter((metric) => metric.type === "Utility")
    .map((metric) => metric.pid));
}

function forwardElectronDebugOutput(application: Awaited<ReturnType<typeof electron.launch>>): void {
  if (process.env.PI67_DEBUG_AGENT_STDERR !== "1") return;
  application.process().stdout?.on("data", (chunk) => process.stdout.write(chunk));
  application.process().stderr?.on("data", (chunk) => process.stderr.write(chunk));
}

async function openRuntimeSettings(window: Page) {
  await window.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
  const settings = window.getByLabel("π 设置");
  await expect(settings).toBeVisible();
  await expect(window.getByRole("complementary", { name: "会话导航" })).toHaveCount(0);
  await expect(window.getByTestId("inspector-toggle")).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "返回工作台" })).toBeVisible();
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: /^运行服务/u }).click();
  return settings;
}

async function writeRollbackSessionFixture(path: string, cwd: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const records = [
    {
      type: "session",
      version: 3,
      id: "019fa284-b143-70e9-bb16-a8f4bf341f37",
      timestamp,
      cwd
    },
    {
      type: "session_info",
      id: "fixture-info",
      parentId: null,
      timestamp,
      name: "Rollback race fixture"
    },
    {
      type: "message",
      id: "fixture-user",
      parentId: "fixture-info",
      timestamp,
      message: {
        role: "user",
        content: "Rollback fixture user message.",
        timestamp: Date.now()
      }
    },
    {
      type: "message",
      id: "fixture-assistant",
      parentId: "fixture-user",
      timestamp,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Rollback fixture assistant response." }],
        api: "openai-responses",
        provider: "pi67-test",
        model: "fixture",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: "stop",
        timestamp: Date.now() + 1
      }
    }
  ];
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function piDefaultSessionDirectory(cwd: string, agentDir: string): string {
  const resolvedCwd = resolve(cwd);
  const safePath = `--${resolvedCwd.replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`;
  return join(resolve(agentDir), "sessions", safePath);
}
