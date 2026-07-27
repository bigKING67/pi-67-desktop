import { join } from "node:path";
import {
  assertSingleShutdownQuitLifecycle,
  isProcessAlive,
  readPositiveProcessId,
  resetControlledShutdownLifecycle,
  waitForProcessExit,
  writeControlledShutdownExtension
} from "./controlled-shutdown-fixture.ts";
import {
  assertPackagedRuntimeAssets,
  cleanupPackagedTestDirectories,
  createPackagedTestDirectories,
  installWorkspaceDialogResult,
  launchPackagedApplication,
  resolvePackagedArtifact
} from "./packaged-electron-fixture.mjs";

const artifact = resolvePackagedArtifact();
await assertPackagedRuntimeAssets(artifact);
const {
  agentDir,
  extensionsDirectory,
  userDataDirectory,
  workspace
} = await createPackagedTestDirectories("pi67-packaged-smoke-");
const childPidPath = join(userDataDirectory, "child.pid");
const lifecyclePath = join(userDataDirectory, "lifecycle.txt");
await writeControlledShutdownExtension({
  extensionPath: join(extensionsDirectory, "shutdown-fixture.ts"),
  childPidPath,
  lifecyclePath
});
let application;
let childPid;

try {
  application = await launchPackagedApplication({
    agentDir,
    artifact,
    userDataDirectory
  });
  const window = await application.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.getByRole("button", { name: "选择工作区" }).waitFor({ state: "visible", timeout: 15_000 });
  if (!(await window.getByRole("button", { name: "选择工作区" }).isEnabled())) {
    throw new Error("Packaged workspace action is unavailable before Agent Host demand.");
  }
  await window.getByLabel("当前状态：等待选择工作区").waitFor({ state: "visible", timeout: 15_000 });
  await window.evaluate(() => window.pi67.system.connectAgentHost());
  await window.getByRole("button", { name: "打开更多菜单" }).click();
  await window.getByRole("menu").getByRole("menuitem", { name: /运行环境诊断/u }).click();
  const doctorDialog = window.getByRole("dialog", { name: "运行环境诊断" });
  await doctorDialog.waitFor({ state: "visible", timeout: 15_000 });
  await doctorDialog.getByRole("button", { name: "运行检查" }).click();
  const doctorResults = doctorDialog.getByLabel("运行环境检查结果");
  const doctorError = doctorDialog.locator(".doctor-error");
  await doctorResults.or(doctorError).waitFor({ state: "visible", timeout: 30_000 });
  if (await doctorError.isVisible()) {
    throw new Error(`Packaged Agent Host Doctor failed: ${(await doctorError.textContent())?.trim() ?? "unknown error"}`);
  }
  await doctorResults.getByText("Pi SDK").waitFor({ state: "visible", timeout: 30_000 });
  const sqliteCheck = doctorResults.locator(".doctor-check").filter({ hasText: "内置 SQLite" });
  await sqliteCheck.getByText("通过", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await sqliteCheck.getByText(/temporary-file create\/open\/close\/reopen verified\./u)
    .waitFor({ state: "visible", timeout: 30_000 });
  const sessionCatalogCheck = doctorResults.locator(".doctor-check").filter({ hasText: "Session 目录" });
  await sessionCatalogCheck.getByText("需注意", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await sessionCatalogCheck.getByText(/schema v1; unavailable/u).waitFor({ state: "visible", timeout: 30_000 });
  await doctorDialog.getByRole("button", { name: "关闭" }).click();
  await installWorkspaceDialogResult(application, workspace);
  await window.getByRole("button", { name: "选择工作区" }).click();
  await window.getByLabel("当前状态：Pi SDK 已就绪").waitFor({ state: "visible", timeout: 30_000 });
  await window.getByText("还没有保存的 Pi 会话。", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await window.getByRole("button", { name: "打开更多菜单" }).click();
  await window.getByRole("menu").getByRole("menuitem", { name: /运行环境诊断/u }).click();
  await doctorDialog.getByRole("button", { name: /重新运行检查/u }).click();
  await sessionCatalogCheck.getByText("通过", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await sessionCatalogCheck.getByText(/schema v1; ready/u).waitFor({ state: "visible", timeout: 30_000 });
  await doctorDialog.getByRole("button", { name: "关闭" }).click();
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
  await window.getByRole("button", { name: "打开更多菜单" }).click();
  await window.getByRole("menu").getByRole("menuitem", { name: /外观：浅色/u }).click();
  await window.locator('html[data-theme-preference="light"][data-theme="light"]').waitFor({ state: "attached" });
  await window.reload();
  await window.locator('html[data-theme-preference="light"][data-theme="light"]').waitFor({ state: "attached" });
  await window.getByRole("button", { name: "选择工作区" }).click();
  await window.getByLabel("当前状态：Pi SDK 已就绪").waitFor({ state: "visible", timeout: 30_000 });
  await application.evaluate(({ powerMonitor }) => powerMonitor.emit("resume"));
  await window.getByLabel("当前状态：系统恢复后 Pi 状态已重新同步")
    .waitFor({ state: "visible", timeout: 30_000 });
  // Renderer reload reinitializes the Pi runtime and legitimately shuts down the
  // previous runtime generation. Scope the exactly-once probe to final app quit.
  await resetControlledShutdownLifecycle(lifecyclePath);
  await window.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  const controlledCommand = window.getByRole("option", {
    name: "/hold-open Start a controlled child process until Pi shuts down"
  });
  await controlledCommand.waitFor({ state: "visible", timeout: 10_000 });
  await controlledCommand.click();
  childPid = await readPositiveProcessId(childPidPath);
  if (!isProcessAlive(childPid)) throw new Error("Controlled Extension child exited before packaged shutdown.");
  const utilityPids = await application.evaluate(({ app }) => app.getAppMetrics()
    .filter((metric) => metric.type === "Utility")
    .map((metric) => metric.pid));
  if (utilityPids.length === 0) throw new Error("Packaged Agent Host utility process was not observable.");

  const closeStartedAt = Date.now();
  await application.close();
  application = undefined;
  const closeDurationMs = Date.now() - closeStartedAt;
  if (closeDurationMs > 5_000) {
    throw new Error(`Packaged application shutdown exceeded 5000ms: ${closeDurationMs}ms.`);
  }
  await waitForProcessExit(childPid);
  for (const pid of utilityPids) await waitForProcessExit(pid);
  await assertSingleShutdownQuitLifecycle(lifecyclePath, "Packaged Pi Runtime");
  console.log(`Packaged Electron smoke passed: ${process.platform}/${process.arch}, native modules, app://pi67, theme persistence, sandbox, node:sqlite utility lifecycle, Session Catalog rebuild, synthetic powerMonitor resume resync, real Agent Host roundtrip, and bounded active-command shutdown (${closeDurationMs}ms).`);
} finally {
  try {
    if (application) await application.close();
    if (childPid !== undefined && isProcessAlive(childPid)) process.kill(childPid);
  } finally {
    await cleanupPackagedTestDirectories(userDataDirectory);
  }
}
