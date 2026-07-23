import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const supportedHost = (process.platform === "darwin" && process.arch === "arm64")
  || (process.platform === "win32" && process.arch === "x64");
if (!supportedHost) throw new Error(`Packaged smoke does not support ${process.platform}/${process.arch}.`);
const packagedRoot = process.platform === "darwin"
  ? join(root, "artifacts/release/mac-arm64/Pi-67 Desktop.app/Contents")
  : join(root, "artifacts/release/win-unpacked");
const executablePath = process.platform === "darwin"
  ? join(packagedRoot, "MacOS/Pi-67 Desktop")
  : join(packagedRoot, "Pi-67 Desktop.exe");
const resourcesPath = process.platform === "darwin" ? join(packagedRoot, "Resources") : join(packagedRoot, "resources");
const clipboardModule = process.platform === "darwin"
  ? "@mariozechner/clipboard-darwin-arm64/clipboard.darwin-arm64.node"
  : "@mariozechner/clipboard-win32-x64-msvc/clipboard.win32-x64-msvc.node";
const unpackedModules = join(resourcesPath, "app.asar.unpacked/node_modules");
await Promise.all([
  access(executablePath),
  access(join(unpackedModules, clipboardModule)),
  access(join(unpackedModules, "@silvia-odwyer/photon-node/photon_rs_bg.wasm"))
]);

const userDataDirectory = await mkdtemp(join(tmpdir(), "pi67-packaged-smoke-"));
let application;

try {
  application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDirectory}`],
    env: { ...process.env, NODE_ENV: "test" }
  });
  const window = await application.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.getByRole("button", { name: "选择工作区" }).waitFor({ state: "visible", timeout: 15_000 });
  if (!(await window.getByRole("button", { name: "选择工作区" }).isEnabled())) {
    throw new Error("Packaged workspace action is unavailable before Agent Host demand.");
  }
  await window.getByText("选择工作区后按需启动").waitFor({ state: "visible", timeout: 15_000 });
  await window.evaluate(() => window.pi67.system.connectAgentHost());
  await window.getByText("Agent Host 已连接").waitFor({ state: "visible", timeout: 15_000 });
  await window.getByRole("button", { name: "打开命令面板" }).click();
  await window.getByRole("button", { name: /运行环境 Doctor/u }).click();
  await window.getByRole("dialog", { name: "运行环境 Doctor" }).waitFor({ state: "visible", timeout: 15_000 });
  await window.getByLabel("Doctor 检查结果").getByText("Pi SDK").waitFor({ state: "visible", timeout: 30_000 });
  await window.getByRole("button", { name: "关闭" }).click();
  if (window.url() !== "app://pi67/index.html") throw new Error(`Unexpected packaged renderer URL: ${window.url()}`);
  const security = await window.evaluate(() => ({
    hasNodeProcess: "process" in globalThis,
    hasRequire: "require" in globalThis,
    hasBridge: typeof window.pi67?.system === "object"
  }));
  if (security.hasNodeProcess || security.hasRequire || !security.hasBridge) {
    throw new Error(`Packaged renderer security boundary failed: ${JSON.stringify(security)}`);
  }
  await window.locator('html[data-theme-preference="system"]').waitFor({ state: "attached" });
  await window.getByRole("button", { name: /外观：跟随系统/u }).click();
  await window.getByRole("menuitemradio", { name: /浅色/u }).click();
  await window.locator('html[data-theme-preference="light"][data-theme="light"]').waitFor({ state: "attached" });
  await window.reload();
  await window.locator('html[data-theme-preference="light"][data-theme="light"]').waitFor({ state: "attached" });
  console.log(`Packaged Electron smoke passed: ${process.platform}/${process.arch}, native modules, app://pi67, theme persistence, sandbox, and real Agent Host command roundtrip.`);
} finally {
  try {
    if (application) await application.close();
  } finally {
    await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
