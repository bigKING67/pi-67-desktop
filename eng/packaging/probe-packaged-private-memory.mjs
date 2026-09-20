import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { expect } from "@playwright/test";
import { createPackagedTestDirectories, launchPackagedApplication, cleanupPackagedTestDirectories,
  resolvePackagedArtifact } from "./packaged-electron-fixture.mjs";
import { openSettingsSection, openPackagedSmokeWorkspace, ensurePackagedNewSessionIntent } from "./packaged-electron-smoke-scenarios.mjs";
import { closeElectronApplicationWithinTimeout } from "./electron-shutdown-measurement.mjs";
import { startPrivateMemoryModel } from "./packaged-private-memory-model.mjs";

const installation = process.env.PI67_PRIVATE_SESSION_TEST_INSTALLATION;
if (process.platform !== "darwin" || process.arch !== "arm64" || !installation || !isAbsolute(installation)) {
  throw new Error("Requires macOS arm64 and an explicit absolute PI67_PRIVATE_SESSION_TEST_INSTALLATION.");
}
const artifact = resolvePackagedArtifact();
const asarSha256 = createHash("sha256").update(await readFile(join(artifact.resourcesPath, "app.asar"))).digest("hex");
const profile = await createPackagedTestDirectories("new-money-packaged-private-");
const model = await startPrivateMemoryModel();
const sendDurationsMs = [];
const initializationTimings = [];
let application; let stage = "prepare"; let passed = false;
const close = async () => {
  if (!application) return;
  const result = await closeElectronApplicationWithinTimeout({ application });
  if (result.timedOut || result.error || result.mainAliveAfterClose) throw new Error("Packaged private memory shutdown incomplete.");
  application = undefined;
};
const environment = { PI67_TEST_CAPTURE_AGENT_INIT: "1", PI67_MEMORY_PRIVACY_MODE: "private-learning", PI_AGENT_DIR: profile.agentDir,
  OPENVIKING_PENDING_DIR: join(profile.userDataDirectory, "pending"), OPENVIKING_CREDENTIAL_SOURCE: "env",
  OPENVIKING_CLI_CONFIG_FILE: join(profile.userDataDirectory, "absent-cli.json"),
  OPENVIKING_CONFIG_FILE: join(profile.userDataDirectory, "absent-ov.json") };
for (const key of Object.keys(process.env)) {
  if ((key.startsWith("OPENVIKING_") || key.startsWith("OV_")) && !(key in environment)) environment[key] = "";
}
const launch = async () => {
  const launched = await launchPackagedApplication({ ...profile, artifact, environment, isolateNativeWindow: true, hideNativeWindow: false });
  let pending = "";
  launched.process().stderr.on("data", chunk => {
    const lines = `${pending}${String(chunk)}`.split(/\r?\n/u);
    pending = lines.pop() ?? "";
    if (pending.length > 8192) pending = "";
    for (const line of lines) {
      if (!line.startsWith("[agent-host:init] ") || line.length > 8192) continue;
      try {
        const value = JSON.parse(line.slice("[agent-host:init] ".length));
        if (!["resolve-session", "dispose-current", "create-session", "load-model-runtime", "validate-packages",
          "load-session-resources", "activate-session", "reload-configuration", "project-snapshot"].includes(value.stage)
          || value.outcome !== "completed" || !Number.isFinite(value.durationMs) || initializationTimings.length >= 100) continue;
        initializationTimings.push({ phase: stage, stage: value.stage, durationMs: Math.max(0, Math.round(value.durationMs)) });
      } catch { /* Ignore non-contract diagnostics, never store raw output. */ }
    }
  });
  return launched;
};
try {
  await Promise.all([
    writeFile(join(profile.agentDir, "settings.json"), JSON.stringify({ defaultProvider: "memory-fixture", defaultModel: "agent",
      compaction: { enabled: false }, retry: { enabled: false } }), { mode: 0o600 }),
    writeFile(join(profile.agentDir, "models.json"), JSON.stringify({ providers: { "memory-fixture": {
      baseUrl: model.endpoint, api: "openai-completions", models: ["agent", "extract"].map(id => ({ id,
        name: id, input: ["text"], reasoning: false, contextWindow: 100000, maxTokens: 1024 }))
    } } }), { mode: 0o600 }),
    writeFile(join(profile.agentDir, "auth.json"), JSON.stringify({ "memory-fixture": { type: "api_key", key: "synthetic-memory-only" } }), { mode: 0o600 }),
    writeFile(join(profile.agentDir, "openviking.json"), JSON.stringify({ enabled: true, privacyMode: "private-learning",
      syncTurns: true, captureAssistantTurns: true,
      takeover: { enabled: false }, recallQueryExpansion: "off", logLevel: "silent" }), { mode: 0o600 })
  ]);
  stage = "install-and-enable";
  console.info(`Packaged private memory: ${stage}`);
  application = await launch(); let window = await application.firstWindow();
  await window.getByRole("button", { name: "选择工作区" }).waitFor({ state: "visible", timeout: 30000 });
  await openPackagedSmokeWorkspace({ application, window, workspace: profile.workspace });
  const settings = await openSettingsSection(window, /上下文与记忆/u);
  await settings.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: /记忆/u }).click();
  const form = settings.getByTestId("context-memory-settings");
  await application.evaluate(({ dialog }, source) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] }); }, installation);
  await form.getByRole("button", { name: "安装私人记忆运行包", exact: true }).click();
  await expect(form.getByText("运行包已验签并安装。本次安装未改变记忆启用设置，也未调用模型。", { exact: true })).toBeVisible({ timeout: 180000 });
  for (const [label, value] of [["提取 Provider ID", "memory-fixture"], ["提取模型 ID", "extract"],
    ["Embedding 服务地址", model.endpoint], ["Embedding 模型 ID", "embedding"], ["向量维度", "8"],
    ["Embedding API Key", "synthetic-memory-only"]]) await form.getByLabel(label, { exact: true }).fill(value);
  await form.getByRole("button", { name: "保存模型配置", exact: true }).click();
  await expect(form.getByText("模型配置已保存，下次服务启动时生效。本次保存没有改变启用设置，也未调用模型。", { exact: true })).toBeVisible();
  await form.getByRole("button", { name: "启用（重启后生效）", exact: true }).click();
  await expect.poll(() => window.evaluate(() => window.pi67.system.localMemoryActivation.get())).toMatchObject({
    available: true, preference: "enabled", selectedAtLaunch: false, restartRequired: true, lifecycle: "idle" });
  expect(model.counts).toEqual({ agent: 0, embedding: 0, extraction: 0, rejected: 0 });
  await close();
  stage = "first-product-session";
  console.info(`Packaged private memory: ${stage}`);
  application = await launch(); window = await application.firstWindow();
  await window.getByRole("list", { name: "工作区与对话" }).waitFor({ state: "visible", timeout: 60000 });
  await ensurePackagedNewSessionIntent(window, 60000);
  const firstText = "NM-PACKAGED-PRIVATE-ONE: I prefer concise Chinese responses. 请记住这条测试偏好。";
  sendDurationsMs.push(await send(window, firstText, 1));
  const first = await readCapture(profile.agentDir, firstText, 2);
  expect(first.capture.data.syncedCaptureCount).toBe(2);
  const nativeFirst = await readNativeCapture(first.capture.data.ovSessionId, [firstText], 2);
  await expect.poll(() => window.evaluate(() => window.pi67.system.localMemoryActivation.get())).toMatchObject({
    preference: "enabled", selectedAtLaunch: true, lifecycle: "running" });
  await close();
  stage = "cold-session-recovery";
  console.info(`Packaged private memory: ${stage}`);
  // Preserve the initial shutdown's default recent tail. Only this restarted
  // test Session uses full archival, so the explicit UI action owns extraction.
  const memoryConfigPath = join(profile.agentDir, "openviking.json");
  const memoryConfig = JSON.parse(await readFile(memoryConfigPath, "utf8"));
  await writeFile(memoryConfigPath, JSON.stringify({ ...memoryConfig, commitKeepRecentCount: 0 }), { mode: 0o600 });
  application = await launch(); window = await application.firstWindow();
  await window.getByRole("list", { name: "工作区与对话" }).waitFor({ state: "visible", timeout: 60000 });
  await window.getByRole("textbox", { name: "给 Pi 发送消息" })
    .or(window.getByRole("button", { name: "恢复任务", exact: true }))
    .or(window.getByRole("button", { name: "打开对话", exact: true }))
    .first().waitFor({ state: "visible", timeout: 60000 });
  for (const label of ["恢复任务", "打开对话"]) {
    const action = window.getByRole("button", { name: label, exact: true });
    if (await action.isVisible()) { await action.click(); break; }
  }
  const secondText = "NM-PACKAGED-PRIVATE-TWO：重启后继续同一私人会话。";
  sendDurationsMs.push(await send(window, secondText, 2));
  const second = await readCapture(profile.agentDir, secondText, 4);
  expect(second.path).toBe(first.path); expect(second.header.id).toBe(first.header.id);
  expect(second.capture.data.ovSessionId).toBe(first.capture.data.ovSessionId);
  expect(second.capture.data.scopeKey).toBe(first.capture.data.scopeKey);
  expect(second.capture.data.syncedCaptureCount).toBe(4);
  const nativeSecond = await readNativeCapture(second.capture.data.ovSessionId, [firstText, secondText], 4);
  expect(nativeSecond.path).toBe(nativeFirst.path);
  expect(nativeSecond.entries.slice(0, 2)).toEqual(nativeFirst.entries);
  expect(second.entries.filter(entry => entry.type === "message" && entry.message.role === "user"
    && JSON.stringify(entry.message.content).includes(firstText))).toHaveLength(1);
  expect(model.counts.rejected).toBe(0); expect(model.counts.extraction).toBe(0);
  stage = "explicit-archive-and-extraction";
  console.info(`Packaged private memory: ${stage}`);
  const inspector = window.getByRole("complementary", { name: "任务检查器", exact: true });
  if (!await inspector.isVisible()) await window.getByTestId("inspector-toggle").click();
  await inspector.getByRole("tab", { name: "上下文", exact: true }).click();
  await inspector.getByRole("tab", { name: "记忆", exact: true }).click();
  await inspector.getByRole("button", { name: "立即归档", exact: true }).click();
  const preference = await readCompletedPreference(second.capture.data.ovSessionId);
  expect(model.evidence.preferenceExtractions).toBeGreaterThan(0);
  expect(model.evidence.summaries).toBeGreaterThan(0);
  expect(model.evidence.recalledPreference).toBe(false);
  await close();
  stage = "cold-new-session-recall";
  console.info(`Packaged private memory: ${stage}`);
  application = await launch(); window = await application.firstWindow();
  await window.getByRole("list", { name: "工作区与对话" }).waitFor({ state: "visible", timeout: 60000 });
  await ensurePackagedNewSessionIntent(window, 60000);
  const recallText = "NM-PACKAGED-RECALL: What communication style do I prefer?";
  sendDurationsMs.push(await send(window, recallText, 3));
  const recalled = await readCapture(profile.agentDir, recallText, 2);
  expect(recalled.header.id).not.toBe(first.header.id);
  expect(JSON.stringify(recalled.entries)).not.toContain("NM-PACKAGED-PRIVATE-ONE");
  expect(model.evidence.recalledPreference).toBe(true);
  expect(await readFile(preference.path, "utf8")).toBe(preference.content);
  expect(model.counts.rejected).toBe(0);
  const disabled = await window.evaluate(() => window.pi67.system.localMemoryActivation.setEnabled(false));
  expect(disabled).toMatchObject({ preference: "disabled", lifecycle: "stopped" });
  await close();
  passed = true;
} catch (error) {
  console.error(`Packaged private memory failed at ${stage}; isolated fixture retained: ${profile.userDataDirectory}`);
  if (application) {
    const failedWindow = await application.firstWindow();
    console.error(JSON.stringify({ modelCalls: model.counts,
      activation: await failedWindow.evaluate(() => window.pi67.system.localMemoryActivation.get()) }));
    const notifications = failedWindow.getByRole("button", { name: /打开通知中心/u });
    if (await notifications.isVisible()) {
      await notifications.click();
      const dialog = failedWindow.getByRole("dialog", { name: "通知中心", exact: true });
      await dialog.waitFor({ state: "visible", timeout: 5000 });
      console.error((await dialog.innerText()).slice(-2000));
    }
  }
  throw error;
} finally {
  try { await close(); } finally { await model.close(); }
  if (passed) await cleanupPackagedTestDirectories(profile.userDataDirectory);
}
console.info(JSON.stringify({ result: "PACKAGED_PRIVATE_SESSION_PASS", asarSha256, modelCalls: model.counts, sendDurationsMs,
  initializationTimings,
  memoryEvidence: model.evidence,
  evidence: "real Main/Host/Pi, signed import, encrypted settings, activation, cold capture recovery, UI archive, completed native extraction, cold new Session recall, cleanup; synthetic models only" }));

async function send(window, text, number) {
  await window.getByRole("textbox", { name: "给 Pi 发送消息" }).fill(text, { timeout: 60000 });
  const startedAt = Date.now();
  await window.getByRole("button", { name: "发送", exact: true }).click();
  await expect(window.getByTestId("virtuoso-scroller").getByText(`本地私人记忆合成回复 ${number}。`, { exact: true }))
    .toBeVisible({ timeout: 30000 });
  await window.getByRole("button", { name: "停止", exact: true }).waitFor({ state: "hidden", timeout: 30000 });
  const elapsed = Date.now() - startedAt;
  expect(elapsed).toBeLessThanOrEqual(30000);
  return elapsed;
}
async function readCapture(agentDir, prompt, expectedCaptures) {
  let result;
  await expect.poll(async () => {
    const files = await readdir(join(agentDir, "sessions"), { recursive: true });
    for (const relative of files.filter(name => name.endsWith(".jsonl"))) {
      const path = join(agentDir, "sessions", relative);
      const entries = (await readFile(path, "utf8")).trim().split("\n").map(line => JSON.parse(line));
      if (!entries.some(entry => entry.type === "message" && entry.message.role === "user"
        && JSON.stringify(entry.message.content).includes(prompt))) continue;
      const capture = entries.filter(entry => entry.type === "custom" && entry.customType === "ov-sync-state-v2").at(-1);
      if (!capture || capture.data.syncedCaptureCount < expectedCaptures) continue;
      const provenance = entries.filter(entry => entry.type === "custom" && entry.customType === "pi67.memory-provenance.v1");
      expect(provenance).toHaveLength(1); expect(provenance[0].data.kind).toBe("private");
      result = { path, entries, capture, header: entries[0] }; return true;
    }
    return false;
  }, { timeout: 30000 }).toBe(true);
  return result;
}
async function readNativeCapture(sessionId, prompts, count) {
  const root = join(profile.userDataDirectory, "openviking", "data");
  let result;
  await expect.poll(async () => {
    const files = (await readdir(root, { recursive: true }))
      .filter(path => path.endsWith(`/sessions/${sessionId}/messages.jsonl`));
    expect(files).toHaveLength(1);
    const path = join(root, files[0]);
    const entries = (await readFile(path, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    for (const prompt of prompts) expect(entries.filter(entry => entry.role === "user"
      && entry.parts.some(part => part.type === "text" && part.text === prompt))).toHaveLength(1);
    result = { path, entries }; return entries.length;
  }, { timeout: 30000 }).toBe(count);
  return result;
}
async function readCompletedPreference(sessionId) {
  const root = join(profile.userDataDirectory, "openviking", "data");
  let result;
  await expect.poll(async () => {
    const files = await readdir(root, { recursive: true });
    const completed = files.filter(file => file.endsWith(`/sessions/${sessionId}/history/archive_001/.done`));
    const preferences = files.filter(file => file.endsWith("/memories/preferences/desktop/communication_style.md"));
    if (completed.length !== 1 || preferences.length !== 1) return false;
    const done = JSON.parse(await readFile(join(root, completed[0]), "utf8"));
    expect(done.completed_memory_steps.long_term).toHaveLength(4);
    expect(done.starting_message_id).not.toBe(done.ending_message_id);
    const path = join(root, preferences[0]);
    const content = await readFile(path, "utf8");
    expect(content).toContain("NM-PACKAGED-PRIVATE-ONE");
    result = { path, content }; return true;
  }, { timeout: 60000 }).toBe(true);
  return result;
}
