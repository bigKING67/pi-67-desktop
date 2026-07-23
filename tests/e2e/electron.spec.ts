import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
);

test("boots the real sandboxed Electron shell over app://", async () => {
  const application = await electron.launch({
    args: ["."],
    cwd: root,
    env: { ...inheritedEnvironment, NODE_ENV: "test" }
  });
  try {
    const window = await application.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await expect(window).toHaveTitle("Pi-67 Desktop");
    expect(window.url()).toBe("app://pi67/index.html");
    await expect(window.getByText("Pi-first desktop workspace")).toBeVisible();
    await expect(window.getByRole("button", { name: "选择工作区" })).toBeEnabled();
    await expect(window.getByText("选择工作区后按需启动")).toBeVisible();
    await expect(window.locator("html")).toHaveAttribute("data-theme-preference", "system");
    await window.getByRole("button", { name: /外观：跟随系统/u }).click();
    await expect(window.getByRole("menu")).toBeVisible();
    await window.keyboard.press("Escape");

    const utilityProcessesBefore = await utilityProcessCount(application);
    await window.evaluate(() => {
      const scope = globalThis as unknown as { pi67: { system: { connectAgentHost(): Promise<void> } } };
      return scope.pi67.system.connectAgentHost();
    });
    await expect(window.getByText("Agent Host 已连接")).toBeVisible();
    await expect.poll(() => utilityProcessCount(application)).toBeGreaterThan(utilityProcessesBefore);

    await window.getByRole("button", { name: "打开命令面板" }).click();
    await window.getByRole("button", { name: /运行环境 Doctor/u }).click();
    await expect(window.getByRole("dialog", { name: "运行环境 Doctor" })).toBeVisible();
    await expect(window.getByLabel("Doctor 检查结果").getByText("Pi SDK")).toBeVisible({ timeout: 30_000 });
    await window.getByRole("button", { name: "关闭" }).click();

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
    await application.close();
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
      args: ["."],
      cwd: root,
      env: {
        ...inheritedEnvironment,
        NODE_ENV: "test",
        PI_CODING_AGENT_DIR: agentDir,
        PI_OFFLINE: "1"
      }
    });
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
    await expect(window.getByRole("button", { name: "显示上下文" })).toBeVisible();

    const trustButton = window.getByRole("button", { name: /信任并加载资源/u });
    await expect(trustButton).toBeEnabled();
    await trustButton.click();
    await expect(window.getByText("工作区尚未信任")).toHaveCount(0);
    await expect(window.getByText("Pi 资源已就绪", { exact: true })).toBeVisible({ timeout: 30_000 });

    const createSessionButton = window.getByRole("button", { name: "新建会话" });
    await expect(createSessionButton).toBeEnabled();
    await createSessionButton.click();
    await expect(createSessionButton).toBeDisabled();
    await expect(window.getByText("Pi 新会话已就绪", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(createSessionButton).toBeEnabled();
    await expect(window.getByText(/extension ctx is stale/iu)).toHaveCount(0);
  } finally {
    if (application) await application.close();
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

async function utilityProcessCount(application: Awaited<ReturnType<typeof electron.launch>>): Promise<number> {
  return application.evaluate(({ app }) => app.getAppMetrics().filter((metric) => metric.type === "Utility").length);
}
