import { _electron as electron, expect, test } from "@playwright/test";
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

    const utilityProcessesBefore = await utilityProcessCount(application);
    await window.evaluate(() => {
      const scope = globalThis as unknown as { pi67: { system: { connectAgentHost(): Promise<void> } } };
      return scope.pi67.system.connectAgentHost();
    });
    await expect(window.getByText("Agent Host 已连接")).toBeVisible();
    await expect.poll(() => utilityProcessCount(application)).toBeGreaterThan(utilityProcessesBefore);

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

async function utilityProcessCount(application: Awaited<ReturnType<typeof electron.launch>>): Promise<number> {
  return application.evaluate(({ app }) => app.getAppMetrics().filter((metric) => metric.type === "Utility").length);
}
