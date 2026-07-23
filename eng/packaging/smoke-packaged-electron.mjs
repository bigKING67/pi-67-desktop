import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const executablePath = process.platform === "darwin"
  ? join(root, "artifacts/release/mac-arm64/Pi-67 Desktop.app/Contents/MacOS/Pi-67 Desktop")
  : process.platform === "win32"
    ? join(root, "artifacts/release/win-unpacked/Pi-67 Desktop.exe")
    : undefined;

if (!executablePath) throw new Error(`Packaged smoke does not support ${process.platform}/${process.arch}.`);
await access(executablePath);

const application = await electron.launch({
  executablePath,
  env: { ...process.env, NODE_ENV: "test" }
});

try {
  const window = await application.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.getByRole("button", { name: "选择工作区" }).waitFor({ state: "visible", timeout: 15_000 });
  if (!(await window.getByRole("button", { name: "选择工作区" }).isEnabled())) {
    throw new Error("Packaged workspace action is unavailable before Agent Host demand.");
  }
  await window.getByText("选择工作区后按需启动").waitFor({ state: "visible", timeout: 15_000 });
  await window.evaluate(() => window.pi67.system.connectAgentHost());
  await window.getByText("Agent Host 已连接").waitFor({ state: "visible", timeout: 15_000 });
  if (window.url() !== "app://pi67/index.html") throw new Error(`Unexpected packaged renderer URL: ${window.url()}`);
  const security = await window.evaluate(() => ({
    hasNodeProcess: "process" in globalThis,
    hasRequire: "require" in globalThis,
    hasBridge: typeof window.pi67?.system === "object"
  }));
  if (security.hasNodeProcess || security.hasRequire || !security.hasBridge) {
    throw new Error(`Packaged renderer security boundary failed: ${JSON.stringify(security)}`);
  }
  console.log(`Packaged Electron smoke passed: ${process.platform}/${process.arch}, app://pi67, on-demand Agent Host connected.`);
} finally {
  await application.close();
}
