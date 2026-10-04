import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { expect } from "@playwright/test";
import { createPackagedTestDirectories, launchPackagedApplication, cleanupPackagedTestDirectories,
  resolvePackagedArtifact, repositoryRoot } from "./packaged-electron-fixture.mjs";
import { openSettingsSection, openPackagedSmokeWorkspace } from "./packaged-electron-smoke-scenarios.mjs";
import { closeElectronApplicationWithinTimeout } from "./electron-shutdown-measurement.mjs";
import { startPrivateMemoryModel } from "./packaged-private-memory-model.mjs";

// Explicit local acceptance only. Real packaged Main, pinned signatures and native
// OpenViking; loopback model fixture and a deliberately simulated interrupted journal.
// No signing-key access, real profile writes, automatic reruns or private payload logs.
assert.equal(process.platform, "darwin"); assert.equal(process.arch, "arm64");
const [currentSource, oldSource, oldIndexSource, oldQuerySource] = process.argv.slice(2);
assert.ok([currentSource, oldSource, oldIndexSource, oldQuerySource].every(path => path && isAbsolute(path)));
const artifact = resolvePackagedArtifact(), hash = value => createHash("sha256").update(value).digest("hex");
const evidence = await mkdirEvidence();
const profile = await createPackagedTestDirectories("new-money-retirement-");
profile.userDataDirectory = await realpath(profile.userDataDirectory);
profile.agentDir = await realpath(profile.agentDir); profile.workspace = await realpath(profile.workspace);
const parent = join(profile.userDataDirectory, "openviking/runtime");
const currentName = "openviking-0.4.22-python-3.12.10-sdk-0.1.10-darwin-arm64";
const oldName = currentName.replace("0.4.22", "0.4.16");
const old = join(parent, oldName), current = join(parent, currentName);
const sourceIdentities = await Promise.all([currentSource, oldSource, oldIndexSource, oldQuerySource].map(async path => ({
  path, manifestSha256: hash(await readFile(join(path, "manifest.json")))
})));
const receipt = { schema: "new-money.packaged-runtime-retirement.v1", status: "INCOMPLETE", stage: "prepare",
  asarSha256: hash(await readFile(join(artifact.resourcesPath, "app.asar"))),
  executableSha256: hash(await readFile(artifact.executablePath)),
  isolatedProfile: profile.userDataDirectory, sourceIdentities, checks: {}, diagnostics: [],
  evidenceLimits: ["private native startup only; team success hooks covered by source tests",
    "interruption seeded as a partial payload plus authentic-identity journal, not an OS crash",
    "local model fixture; no paid provider or real user memory"] };
const save = () => writeFile(join(evidence, "receipt.json"), JSON.stringify(receipt, null, 2));
const exists = path => lstat(path).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
const exec = promisify(execFile);
const copy = async (source, target) => {
  assert.equal(await exists(target), false);
  await exec("/bin/cp", ["-cR", source, target]);
};
const model = await startPrivateMemoryModel();
let application, holder, window;
const close = async () => {
  if (!application) return;
  const result = await closeElectronApplicationWithinTimeout({ application });
  assert.ok(!result.timedOut && !result.error && !result.mainAliveAfterClose, "Packaged physical exit unconfirmed");
  application = undefined;
};
const stopHolder = async () => {
  if (!holder) return;
  const exit = once(holder, "exit"); holder.kill(); await exit; holder = undefined;
};
const environment = { PI_AGENT_DIR: profile.agentDir, PI67_MEMORY_PRIVACY_MODE: "off",
  OPENVIKING_PENDING_DIR: join(profile.userDataDirectory, "pending"), OPENVIKING_CREDENTIAL_SOURCE: "env",
  OPENVIKING_CLI_CONFIG_FILE: join(profile.userDataDirectory, "absent-cli.json"),
  OPENVIKING_CONFIG_FILE: join(profile.userDataDirectory, "absent-ov.json") };
for (const key of Object.keys(process.env)) if ((key.startsWith("OPENVIKING_") || key.startsWith("OV_")) && !(key in environment)) environment[key] = "";
const launch = async () => {
  application = await launchPackagedApplication({ ...profile, artifact, environment, isolateNativeWindow: true, hideNativeWindow: false });
  for (const stream of [application.process().stdout, application.process().stderr]) {
    let pending = "";
    stream.on("data", chunk => {
      const lines = (pending + String(chunk)).split(/\r?\n/u);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const match = /^\[openviking-retirement\] (private|team-index-v1|team-query-v1) (completed|deferred)$/u.exec(line.trim());
        if (match) receipt.diagnostics.push({ stage: receipt.stage, purpose: match[1], outcome: match[2] });
      }
    });
  }
  window = await application.firstWindow();
  const selected = await application.evaluate(({ app }) => app.getPath("userData"));
  assert.equal(await realpath(selected), profile.userDataDirectory);
};
const healthy = async () => {
  await expect.poll(() => window.evaluate(() => window.pi67.system.localMemoryActivation.get()), { timeout: 90000 })
    .toMatchObject({ selectedAtLaunch: true, lifecycle: "running" });
  const startup = JSON.parse(await readFile(join(profile.userDataDirectory, "openviking/startup-diagnostics.json"), "utf8"));
  assert.equal(startup.outcome, "completed");
};
try {
  await save(); await mkdir(parent, { recursive: true, mode: 0o700 });
  await copy(currentSource, current);
  // Source assembly receipts are development metadata; copy only the installed contract.
  for (const [source, suffix] of [[oldSource, ""], [oldIndexSource, "-team-index-v1"], [oldQuerySource, "-team-query-v1"]]) {
    const target = join(parent, oldName + suffix); await mkdir(target, { mode: 0o700 });
    await copy(join(source, "runtime"), join(target, "runtime"));
    for (const name of ["manifest.json", "manifest.sig"]) await copy(join(source, name), join(target, name));
  }
  await writeFile(join(profile.agentDir, "models.json"), JSON.stringify({ providers: { "memory-fixture": {
    baseUrl: model.endpoint, api: "openai-completions", models: ["agent", "extract"].map(id => ({ id, name: id,
      input: ["text"], reasoning: false, contextWindow: 100000, maxTokens: 1024 })) } } }), { mode: 0o600 });
  await writeFile(join(profile.agentDir, "auth.json"), JSON.stringify({ "memory-fixture": { type: "api_key", key: "synthetic-memory-only" } }), { mode: 0o600 });
  await writeFile(join(profile.agentDir, "settings.json"), JSON.stringify({ defaultProvider: "memory-fixture", defaultModel: "agent" }), { mode: 0o600 });
  receipt.stage = "configure-disabled"; await save(); await launch();
  await openPackagedSmokeWorkspace({ application, window, workspace: profile.workspace });
  const settings = await openSettingsSection(window, /上下文与记忆/u);
  await settings.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: /记忆/u }).click();
  const form = settings.getByTestId("context-memory-settings");
  for (const [label, value] of [["提取 Provider ID", "memory-fixture"], ["提取模型 ID", "extract"],
    ["Embedding 服务地址", model.endpoint], ["Embedding 模型 ID", "embedding"], ["向量维度", "8"], ["Embedding API Key", "synthetic-memory-only"]]) {
    await form.getByLabel(label, { exact: true }).fill(value);
  }
  await form.getByRole("button", { name: "保存模型配置", exact: true }).click();
  await expect(form.getByText("模型配置已保存，下次服务启动时生效。本次保存没有改变启用设置，也未调用模型。", { exact: true })).toBeVisible();
  assert.ok(await exists(join(old, "runtime"))); receipt.checks.disabledPreservesOld = true;
  await form.getByRole("button", { name: "启用（重启后生效）", exact: true }).click();
  await expect.poll(() => window.evaluate(() => window.pi67.system.localMemoryActivation.get())).toMatchObject({ preference: "enabled", restartRequired: true });
  await close();
  receipt.stage = "occupied-old"; await save();
  holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd: join(old, "runtime"), stdio: "ignore" });
  await once(holder, "spawn");
  await launch(); await healthy();
  await expect.poll(() => receipt.diagnostics.some(row => row.stage === "occupied-old" && row.outcome === "deferred"), { timeout: 90000 }).toBe(true);
  assert.ok(await exists(join(old, "runtime"))); receipt.checks.occupiedOldPreserved = true;
  await close(); await stopHolder();
  receipt.stage = "verified-retirement"; await save(); await launch(); await healthy();
  await expect.poll(() => exists(join(old, "runtime")), { timeout: 90000 }).toBe(false);
  assert.ok(await exists(join(old, "retirement.json"))); receipt.checks.realPrivateStartupRetiresOld = true;
  for (const suffix of ["-team-index-v1", "-team-query-v1"]) assert.ok(await exists(join(parent, oldName + suffix, "runtime")));
  receipt.checks.otherPurposesPreserved = true; await close();
  receipt.stage = "seed-interrupted-payload"; await save();
  await copy(join(oldSource, "runtime"), join(old, "runtime"));
  // Retain the real pending receipt from product execution, then simulate a
  // partial recursive delete while the isolated application is physically stopped.
  await rm(join(old, "runtime/bin"), { recursive: true });
  receipt.stage = "resume-interrupted-payload"; await save(); await launch(); await healthy();
  await expect.poll(() => exists(join(old, "runtime")), { timeout: 90000 }).toBe(false);
  receipt.checks.simulatedInterruptionResumed = true; await close();
  const currentManifest = hash(await readFile(join(current, "manifest.json")));
  assert.equal(currentManifest, sourceIdentities[0].manifestSha256);
  for (const item of sourceIdentities) assert.equal(hash(await readFile(join(item.path, "manifest.json"))), item.manifestSha256);
  receipt.checks.sourceManifestsUnchanged = true;
  receipt.modelCounts = model.counts;
  await cleanupPackagedTestDirectories(profile.userDataDirectory);
  receipt.checks.isolatedProfileRemoved = !await exists(profile.userDataDirectory);
  receipt.status = "PASS"; receipt.stage = "complete";
} catch (error) {
  receipt.status = "FAIL"; receipt.failureType = error?.name ?? "Error"; receipt.failureCode = error?.code;
  console.error(`PACKAGED_RUNTIME_RETIREMENT_FAILED stage=${receipt.stage}; receipt=${join(evidence, "receipt.json")}`);
  process.exitCode = 1;
} finally {
  try { await close(); await stopHolder(); } catch { receipt.status = "FAIL"; receipt.cleanup = "physical-exit-unconfirmed"; process.exitCode = 1; }
  await model.close(); await save();
}
console.info(`PACKAGED_RUNTIME_RETIREMENT_${receipt.status}: ${join(evidence, "receipt.json")}`);
async function mkdirEvidence() {
  const directory = join(repositoryRoot, "artifacts/runtime-retirement-packaged");
  await mkdir(directory, { recursive: true });
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(join(directory, "run-"));
}
