import { _electron as electron, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function utilityProcessCount(
  application: Awaited<ReturnType<typeof electron.launch>>
): Promise<number> {
  return application.evaluate(({ app }) => (
    app.getAppMetrics().filter((metric) => metric.type === "Utility").length
  ));
}

export async function utilityProcessIds(
  application: Awaited<ReturnType<typeof electron.launch>>
): Promise<number[]> {
  return application.evaluate(({ app }) => app.getAppMetrics()
    .filter((metric) => metric.type === "Utility")
    .map((metric) => metric.pid));
}

export function forwardElectronDebugOutput(
  application: Awaited<ReturnType<typeof electron.launch>>
): void {
  if (process.env.PI67_DEBUG_AGENT_STDERR !== "1") return;
  application.process().stdout?.on("data", (chunk) => process.stdout.write(chunk));
  application.process().stderr?.on("data", (chunk) => process.stderr.write(chunk));
}

export async function openRuntimeSettings(window: Page) {
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

export async function openModelServiceSettings(window: Page) {
  await window.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
  const settings = window.getByLabel("π 设置");
  await expect(settings).toBeVisible();
  await settings.getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "模型", exact: true }).click();
  return settings;
}

export async function writeRollbackSessionFixture(path: string, cwd: string): Promise<void> {
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

export async function writeNamedSessionFixture(path: string, cwd: string, fixture: {
  sessionId: string;
  name: string;
  userText: string;
  assistantText: string;
}): Promise<void> {
  const timestamp = new Date().toISOString();
  const records = [
    {
      type: "session",
      version: 3,
      id: fixture.sessionId,
      timestamp,
      cwd
    },
    {
      type: "session_info",
      id: `${fixture.sessionId}-info`,
      parentId: null,
      timestamp,
      name: fixture.name
    },
    {
      type: "message",
      id: `${fixture.sessionId}-user`,
      parentId: `${fixture.sessionId}-info`,
      timestamp,
      message: {
        role: "user",
        content: fixture.userText,
        timestamp: Date.now()
      }
    },
    {
      type: "message",
      id: `${fixture.sessionId}-assistant`,
      parentId: `${fixture.sessionId}-user`,
      timestamp,
      message: {
        role: "assistant",
        content: [{ type: "text", text: fixture.assistantText }],
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

export function piDefaultSessionDirectory(cwd: string, agentDir: string): string {
  const resolvedCwd = resolve(cwd);
  const safePath = `--${resolvedCwd.replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`;
  return join(resolve(agentDir), "sessions", safePath);
}
