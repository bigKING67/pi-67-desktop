import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { expect } from "@playwright/test";
import { runtimeTreeIdentity } from "../../apps/desktop/src/openviking-runtime-tree.mts";
import { createPackagedTestDirectories, launchPackagedApplication, cleanupPackagedTestDirectories,
  resolvePackagedArtifact } from "./packaged-electron-fixture.mjs";
import { openSettingsSection, openPackagedSmokeWorkspace } from "./packaged-electron-smoke-scenarios.mjs";
import { closeElectronApplicationWithinTimeout } from "./electron-shutdown-measurement.mjs";

// Explicit local acceptance: only the native directory picker is replaced.
// Product Main, IPC, pinned trust anchor and purpose admission remain real.
const inputs = [
  { purpose: "team-index-v1", label: "团队索引运行包", source: process.env.PI67_TEAM_INDEX_TEST_INSTALLATION },
  { purpose: "team-query-v1", label: "团队检索运行包", source: process.env.PI67_TEAM_QUERY_TEST_INSTALLATION }
];
assert.ok(process.platform === "darwin" && process.arch === "arm64");
assert.ok(inputs.every(item => item.source && isAbsolute(item.source)), "Two explicit absolute signed sources required");
assert.notEqual(inputs[0].source, inputs[1].source);
for (const item of inputs) {
  const receipt = JSON.parse(await readFile(join(item.source, "assembly-receipt.json"), "utf8"));
  assert.equal(receipt.signatureVerification, "SOURCE_PINNED_KEY_PASS");
  assert.equal(receipt.status, "PASS");
  item.tree = await runtimeTreeIdentity(join(item.source, "runtime"));
  assert.deepEqual(item.tree, receipt.tree);
}
const artifact = resolvePackagedArtifact();
const asarSha256 = createHash("sha256").update(await readFile(join(artifact.resourcesPath, "app.asar"))).digest("hex");
const profile = await createPackagedTestDirectories("new-money-packaged-team-runtimes-");
const environment = { PI_AGENT_DIR: profile.agentDir };
for (const key of Object.keys(process.env)) {
  if (key.startsWith("OPENVIKING_") || key.startsWith("OV_")) environment[key] = "";
}
let application, window, stage = "launch", passed = false;
const close = async () => {
  if (!application) return;
  const result = await closeElectronApplicationWithinTimeout({ application });
  assert.ok(!result.timedOut && !result.error && !result.mainAliveAfterClose, "Physical exit unconfirmed");
  application = undefined;
};
const launch = async () => {
  application = await launchPackagedApplication({ ...profile, artifact, environment, isolateNativeWindow: true });
  window = await application.firstWindow();
};
const status = purpose => window.evaluate(kind => window.pi67.system.localMemoryRuntime.getStatus(kind), purpose);
const inactive = async () => {
  assert.equal(await status("private"), "missing");
  const activation = await window.evaluate(() => window.pi67.system.localMemoryActivation.get());
  assert.equal(activation.selectedAtLaunch, false);
  assert.notEqual(activation.preference, "enabled");
  assert.notEqual(activation.lifecycle, "running");
};
try {
  await launch();
  await openPackagedSmokeWorkspace({ application, window, workspace: profile.workspace });
  const settings = await openSettingsSection(window, /上下文与记忆/u);
  const form = settings.getByTestId("context-memory-settings");
  await inactive();
  for (const item of inputs) {
    stage = `install-${item.purpose}`; console.info(`Packaged team runtime: ${stage}`);
    assert.equal(await status(item.purpose), "missing");
    await application.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
    }, item.source);
    const button = form.getByRole("button", { name: `安装${item.label}`, exact: true });
    await button.click();
    await expect(button).toBeDisabled({ timeout: 180_000 });
    await expect.poll(() => status(item.purpose), { timeout: 180_000 }).toBe("present");
    await expect(form.getByText("运行包已验签并安装。本次安装未改变记忆启用设置，也未调用模型。", { exact: true })).toBeVisible();
    await inactive();
  }
  await close(); stage = "cold-recovery"; await launch();
  await window.getByRole("list", { name: "工作区与对话" }).waitFor({ state: "visible", timeout: 60_000 });
  for (const item of inputs) assert.equal(await status(item.purpose), "present");
  await inactive(); await close();
  stage = "tree-isolation";
  const parent = join(profile.userDataDirectory, "openviking/runtime");
  const names = await readdir(parent);
  assert.equal(names.length, 2, "Unexpected private installation, staging or lock");
  for (const item of inputs) {
    const matches = names.filter(name => name.endsWith(`-${item.purpose}`));
    assert.equal(matches.length, 1);
    assert.deepEqual(await runtimeTreeIdentity(join(parent, matches[0], "runtime")), item.tree);
    assert.deepEqual(await runtimeTreeIdentity(join(item.source, "runtime")), item.tree);
  }
  passed = true;
} catch {
  console.error(`PACKAGED_TEAM_RUNTIMES_FAILED: stage=${stage}; isolated profile=${profile.userDataDirectory}; no raw payloads logged`);
  process.exitCode = 1;
} finally {
  try { await close(); } catch { passed = false; process.exitCode = 1; }
  if (passed) {
    await cleanupPackagedTestDirectories(profile.userDataDirectory);
    assert.ok(!existsSync(profile.userDataDirectory));
    console.info(`PACKAGED_TEAM_RUNTIMES_PASS: asar=${asarSha256}; two signed UI imports, cold presence, exact trees, private disabled, physical exit and profile cleanup; no native team retrieval claim`);
  }
}
