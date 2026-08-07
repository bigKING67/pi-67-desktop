import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isProcessAlive,
  readPositiveProcessId,
  waitForProcessExit,
  writeControlledShutdownExtension
} from "../../eng/packaging/controlled-shutdown-fixture.js";
import {
  forwardElectronDebugOutput,
  openRuntimeSettings,
  piDefaultSessionDirectory,
  utilityProcessCount,
  utilityProcessIds,
  writeNamedSessionFixture,
  writeRollbackSessionFixture
} from "./electron-test-fixtures.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
);

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
    const doctorDialog = window.getByRole("dialog", { name: "恢复与诊断" });
    await settings.getByRole("button", { name: /恢复与诊断/u }).click();
    await doctorDialog.getByRole("button", { name: "开始检查" }).click();
    const catalogCheck = doctorDialog.locator(".doctor-check").filter({ hasText: "Session 目录" });
    await expect(catalogCheck.getByText("通过", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(catalogCheck.getByText(/schema v3; ready/u)).toBeVisible();
    await doctorDialog.getByRole("button", { name: "关闭" }).click();
    await settings.getByRole("button", { name: "返回工作台" }).click();
    await expect(window.getByLabel("Pi conversation")).toBeVisible();
    await expect(window.getByRole("complementary", { name: "会话导航" })).toBeVisible();

    await expect(window.getByText("工作区尚未信任")).toHaveCount(0);

    const createSessionButton = window.getByRole("button", { name: "在 workspace 新建会话" });
    await expect(createSessionButton).toBeEnabled();
    await createSessionButton.click();
    await expect(window.getByTestId("new-session-intent")).toBeVisible();
    await window.getByLabel("给 Pi 发送消息").fill("验证真实 Electron Session 创建");
    await window.getByRole("button", { name: "发送", exact: true }).click();
    await expect(createSessionButton).toBeDisabled();
    await expect(window.getByTestId("new-session-intent")).toHaveCount(0, { timeout: 30_000 });
    await expect(window.getByText(/^发送失败：No API key found/u)).toBeVisible({ timeout: 30_000 });
    await expect(window.locator('[data-testid="conversation-row"]')).toHaveCount(2);
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

test("opens, switches, creates, and restores exact Sessions across a real Electron restart", async () => {
  test.setTimeout(150_000);

  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "pi67-electron-session-story-")));
  const workspace = join(temporaryRoot, "workspace");
  const agentDir = join(temporaryRoot, "agent");
  const profile = join(temporaryRoot, "profile");
  const sessionDirectory = piDefaultSessionDirectory(workspace, agentDir);
  await Promise.all([
    mkdir(workspace),
    mkdir(sessionDirectory, { recursive: true })
  ]);
  await writeNamedSessionFixture(join(sessionDirectory, "story-a.jsonl"), workspace, {
    sessionId: "019fdf10-1111-7111-8111-111111111111",
    name: "Session Story A",
    userText: "Open Session Story A.",
    assistantText: "Session Story A assistant response."
  });
  await writeNamedSessionFixture(join(sessionDirectory, "story-b.jsonl"), workspace, {
    sessionId: "019fdf10-2222-7222-8222-222222222222",
    name: "Session Story B",
    userText: "Open Session Story B.",
    assistantText: "Session Story B assistant response."
  });

  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    application = await electron.launch({
      args: [".", `--user-data-dir=${profile}`],
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

    let window = await application.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.getByRole("button", { name: "选择工作区" }).click();

    const sessionA = window.getByTestId("conversation-row").filter({ hasText: "Session Story A" });
    const sessionB = window.getByTestId("conversation-row").filter({ hasText: "Session Story B" });
    await expect(sessionA).toBeVisible({ timeout: 30_000 });
    await expect(sessionB).toBeVisible({ timeout: 30_000 });

    await sessionA.click();
    await expect(window.getByText("Session Story A assistant response.", { exact: true }))
      .toBeVisible({ timeout: 30_000 });
    await expect(window.getByLabel("给 Pi 发送消息")).toBeEnabled();

    await sessionB.click();
    await expect(window.getByText("Session Story B assistant response.", { exact: true }))
      .toBeVisible({ timeout: 30_000 });
    await expect(window.getByLabel("给 Pi 发送消息")).toBeEnabled();

    const createSessionButton = window.getByRole("button", { name: "在 workspace 新建会话" });
    await createSessionButton.click();
    await expect(window.getByTestId("new-session-intent")).toBeVisible();
    await window.getByLabel("给 Pi 发送消息").fill("创建第三个 Session 并验证重启恢复");
    await window.getByRole("button", { name: "发送", exact: true }).click();
    await expect(window.getByTestId("new-session-intent")).toHaveCount(0, { timeout: 30_000 });
    await expect(window.getByText(/^发送失败：No API key found/u)).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (
      await readdir(sessionDirectory)
    ).filter((name) => name.endsWith(".jsonl")).length).toBe(3);
    await expect(window.getByTestId("conversation-row")).toHaveCount(3);
    await expect(window.getByLabel("给 Pi 发送消息")).toBeEnabled();

    const selectedBeforeRestart = window.locator('[data-testid="conversation-row"][aria-current="page"]');
    await expect(selectedBeforeRestart).toHaveCount(1);
    const selectedConversationId = await selectedBeforeRestart.getAttribute("data-conversation-id");
    expect(selectedConversationId).toBeTruthy();
    await window.waitForTimeout(300);

    await application.close();
    application = undefined;

    application = await electron.launch({
      args: [".", `--user-data-dir=${profile}`],
      cwd: root,
      env: {
        ...inheritedEnvironment,
        NODE_ENV: "test",
        PI_CODING_AGENT_DIR: agentDir,
        PI_OFFLINE: "1"
      }
    });
    forwardElectronDebugOutput(application);
    window = await application.firstWindow();
    await window.waitForLoadState("domcontentloaded");

    const selectedAfterRestart = window.locator('[data-testid="conversation-row"][aria-current="page"]');
    await expect(selectedAfterRestart).toHaveAttribute(
      "data-conversation-id",
      selectedConversationId!,
      { timeout: 30_000 }
    );
    await expect(window.getByRole("button", { name: "打开会话", exact: true })).toBeVisible();
    await window.getByRole("button", { name: "打开会话", exact: true }).click();
    await expect(window.getByLabel("给 Pi 发送消息")).toBeEnabled({ timeout: 30_000 });
    await expect(window.getByRole("banner").getByText("Pi SDK 已就绪", { exact: true }))
      .toBeVisible({ timeout: 30_000 });

    await window.getByTestId("conversation-row").filter({ hasText: "Session Story A" }).click();
    await expect(window.getByText("Session Story A assistant response.", { exact: true }))
      .toBeVisible({ timeout: 30_000 });
    await expect(window.getByLabel("给 Pi 发送消息")).toBeEnabled();
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

    const composer = window.getByLabel("给 Pi 发送消息");
    await composer.fill("/tree");
    await composer.press("Enter");
    const sessionTree = window.getByRole("dialog", { name: "会话分支与回退" });
    const rollbackTarget = sessionTree.getByRole("button", { name: /Rollback fixture user message/u });
    await expect(rollbackTarget).toBeVisible();
    await rollbackTarget.click();

    await expect(window.getByRole("banner").getByText("Pi 会话已回退", { exact: true }))
      .toBeVisible({ timeout: 30_000 });
    await expect(sessionTree).toHaveCount(0);
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
