import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  forwardElectronDebugOutput,
  openModelServiceSettings,
  openRuntimeSettings,
  utilityProcessCount
} from "./electron-test-fixtures.js";

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
      const browserWindow = globalThis as unknown as {
        pi67: { system: { connectAgentHost(): Promise<void> } };
      };
      return browserWindow.pi67.system.connectAgentHost();
    });
    await expect.poll(() => utilityProcessCount(activeApplication)).toBeGreaterThan(utilityProcessesBefore);

    const settings = await openRuntimeSettings(window);
    const doctorDialog = window.getByRole("dialog", { name: "恢复与诊断" });
    await settings.getByRole("button", { name: /恢复与诊断/u }).click();
    await expect(doctorDialog).toBeVisible();
    await doctorDialog.getByRole("button", { name: "开始检查" }).click();
    await expect(doctorDialog.getByLabel("运行环境检查结果").getByText("Pi SDK"))
      .toBeVisible({ timeout: 30_000 });
    await expect(doctorDialog.getByLabel("恢复状态检查结果").getByText(/上次退出 首次运行/u))
      .toBeVisible();
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

test("keeps the Main-resolved Pi profile authoritative when the launch environment changes", async () => {
  test.setTimeout(90_000);

  const temporaryRoot = await mkdtemp(join(tmpdir(), "pi67-electron-provider-profile-"));
  const workspace = join(temporaryRoot, "workspace");
  const agentDir = join(temporaryRoot, "agent with spaces");
  const wrongAgentDir = join(temporaryRoot, "wrong-agent");
  await Promise.all([
    mkdir(workspace),
    mkdir(agentDir),
    mkdir(wrongAgentDir)
  ]);
  await Promise.all([
    writeFile(join(agentDir, "auth.json"), `${JSON.stringify({
      openai: { type: "api_key", key: "pi67-provider-profile-fixture" }
    }, null, 2)}\n`, "utf8"),
    writeFile(join(agentDir, "settings.json"), `${JSON.stringify({
      defaultProvider: "openai",
      defaultModel: "gpt-5"
    }, null, 2)}\n`, "utf8")
  ]);

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
    await application.evaluate(({ dialog }, fixture) => {
      process.env.PI_CODING_AGENT_DIR = fixture.wrongAgentDir;
      Object.defineProperty(dialog, "showOpenDialog", {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [fixture.workspace] })
      });
    }, { workspace, wrongAgentDir });

    const window = await application.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await window.getByRole("button", { name: "选择工作区" }).click();
    await expect(window.getByText("Pi SDK 已就绪", { exact: true })).toBeVisible({ timeout: 30_000 });

    const settings = await openModelServiceSettings(window);
    await expect(settings.getByText("正在读取 Pi 配置", { exact: true })).toHaveCount(0, {
      timeout: 30_000
    });
    const openAi = settings.getByRole("button", { name: /^OpenAI\b/u });
    await expect(openAi).toBeVisible();
    await expect(openAi).toContainText("已配置");
    await openAi.click();
    await settings.getByRole("button", { name: "更新 API Key", exact: true }).click();
    await expect(window.getByRole("dialog", { name: "配置 OpenAI API Key" })
      .getByText("已持久化到 Pi auth.json", { exact: true })).toBeVisible();
  } finally {
    await application?.close();
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
