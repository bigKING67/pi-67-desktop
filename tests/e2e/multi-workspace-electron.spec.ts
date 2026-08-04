import { _electron as electron, expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTROLLED_PROMPT_TEXT,
  writeControlledShutdownExtension
} from "../../eng/packaging/controlled-shutdown-fixture.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
);

test("runs independent real Pi tasks across Sessions and Workspaces", async () => {
  test.setTimeout(120_000);

  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "pi67-electron-multi-workspace-")));
  const primaryWorkspace = join(temporaryRoot, "workspace-primary");
  const secondaryWorkspace = join(temporaryRoot, "workspace-secondary");
  const agentDir = join(temporaryRoot, "agent");
  const extensionsDirectory = join(agentDir, "extensions");
  await Promise.all([
    mkdir(primaryWorkspace),
    mkdir(secondaryWorkspace),
    mkdir(extensionsDirectory, { recursive: true })
  ]);
  await writeControlledShutdownExtension({
    extensionPath: join(extensionsDirectory, "multi-workspace-runtime.ts"),
    childPidPath: join(temporaryRoot, "multi-workspace-child.pid"),
    lifecyclePath: join(temporaryRoot, "multi-workspace-lifecycle.txt")
  });
  await Promise.all([
    writeNamedSessionFixtures(primaryWorkspace, agentDir, ["Primary task one", "Primary task two"]),
    writeNamedSessionFixtures(secondaryWorkspace, agentDir, ["Secondary task one"])
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
    const selectedWorkspaces = [primaryWorkspace, secondaryWorkspace];
    await application.evaluate(({ dialog }, workspacePaths) => {
      let pickerIndex = 0;
      Object.defineProperty(dialog, "showOpenDialog", {
        configurable: true,
        value: async () => ({
          canceled: false,
          filePaths: [workspacePaths[Math.min(pickerIndex++, workspacePaths.length - 1)]!]
        })
      });
    }, selectedWorkspaces);

    const window = await application.firstWindow();
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1_200, 820);
    });
    await window.waitForLoadState("domcontentloaded");
    await window.getByRole("button", { name: "选择工作区" }).click();
    await expect(window.getByText("Pi SDK 已就绪", { exact: true })).toBeVisible({ timeout: 30_000 });
    const primaryGroup = window.getByRole("listitem", { name: "工作区：workspace-primary" });
    const primaryOne = primaryGroup.locator('[data-testid="conversation-row"]').filter({ hasText: "Primary task one" });
    const primaryTwo = primaryGroup.locator('[data-testid="conversation-row"]').filter({ hasText: "Primary task two" });
    await sendControlledPrompt(window, primaryOne, "Primary task one");
    await sendControlledPrompt(window, primaryTwo, "Primary task two");
    await expect(primaryGroup.getByText("运行中", { exact: true })).toHaveCount(2);

    const utilityProcessesBeforeSecondWorkspace = await utilityProcessCount(application);
    await window.getByTestId("workspace-add").click();
    const secondaryGroup = window.getByRole("listitem", { name: "工作区：workspace-secondary" });
    await expect(secondaryGroup).toBeVisible();
    await expect(window.getByLabel("Pi conversation")).toBeVisible({ timeout: 30_000 });
    const secondaryOne = secondaryGroup.locator('[data-testid="conversation-row"]')
      .filter({ hasText: "Secondary task one" });
    await sendControlledPrompt(window, secondaryOne, "Secondary task one");

    await expect(primaryGroup.getByText("运行中", { exact: true })).toHaveCount(2);
    await expect(secondaryGroup.getByText("运行中", { exact: true })).toHaveCount(1);
    await expect.poll(() => utilityProcessCount(application!)).toBe(utilityProcessesBeforeSecondWorkspace);
    await expect(window.getByText("无法打开工作区", { exact: true })).toHaveCount(0);
    await expect(window.getByText("无法切换任务", { exact: true })).toHaveCount(0);
    await expect(window.getByText("无法加载本会话修改记录", { exact: true })).toHaveCount(0);
  } finally {
    if (application) await application.close();
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});

async function utilityProcessCount(application: Awaited<ReturnType<typeof electron.launch>>): Promise<number> {
  return application.evaluate(({ app }) => app.getAppMetrics().filter((metric) => metric.type === "Utility").length);
}

async function sendControlledPrompt(window: Page, row: Locator, explicitTitle: string): Promise<void> {
  await row.click();
  await expect(window.getByLabel("Pi conversation")).toBeVisible({ timeout: 30_000 });
  await window.getByLabel("给 Pi 发送消息").fill(CONTROLLED_PROMPT_TEXT);
  await window.getByRole("button", { name: "发送", exact: true }).click();
  await expect(row.getByText("运行中", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(row.locator("strong")).toHaveText(explicitTitle);
  await expect(window.locator(".brand-lockup")).toContainText(explicitTitle);
  await expect(window.getByRole("article", { name: "用户消息", exact: true })
    .filter({ hasText: CONTROLLED_PROMPT_TEXT })).toBeVisible();
}

function piDefaultSessionDirectory(cwd: string, agentDir: string): string {
  const resolvedCwd = resolve(cwd);
  const safePath = `--${resolvedCwd.replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`;
  return join(resolve(agentDir), "sessions", safePath);
}

async function writeNamedSessionFixtures(
  cwd: string,
  agentDir: string,
  names: string[]
): Promise<void> {
  const directory = piDefaultSessionDirectory(cwd, agentDir);
  await mkdir(directory, { recursive: true });
  await Promise.all(names.map(async (name, index) => {
    const timestamp = new Date(Date.now() - index * 60_000).toISOString();
    const sessionId = randomUUID();
    const infoId = randomUUID();
    const messageId = randomUUID();
    const records = [
      { type: "session", version: 3, id: sessionId, timestamp, cwd },
      { type: "session_info", id: infoId, parentId: null, timestamp, name },
      {
        type: "message",
        id: messageId,
        parentId: infoId,
        timestamp,
        message: {
          role: "user",
          content: `Fixture for ${name}`,
          timestamp: Date.parse(timestamp)
        }
      }
    ];
    await writeFile(
      join(directory, `named-session-${String(index + 1).padStart(2, "0")}.jsonl`),
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8"
    );
  }));
}
