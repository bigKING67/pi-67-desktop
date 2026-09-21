import { mkdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { createPackagedTestDirectories, launchPackagedApplication, cleanupPackagedTestDirectories } from "./packaged-electron-fixture.mjs";
import { openSettingsSection, openPackagedSmokeWorkspace } from "./packaged-electron-smoke-scenarios.mjs";
import { closeElectronApplicationWithinTimeout } from "./electron-shutdown-measurement.mjs";
import { verifyPackagedMemoryRuntime } from "./packaged-local-memory-runtime-smoke.mjs";

export async function runPackagedLocalMemorySettingsSmoke(artifact) {
  if (process.platform !== "darwin" || process.arch !== "arm64") return;
  const profile = await createPackagedTestDirectories("pi67-packaged-memory-");
  let application;
  let scenarioError;
  const launch = () => launchPackagedApplication({ ...profile, artifact, isolateNativeWindow: true, hideNativeWindow: false,
    environment: { PI67_MEMORY_PRIVACY_MODE: "off" } });
  const close = async () => {
    if (!application) return;
    const result = await closeElectronApplicationWithinTimeout({ application });
    if (result.timedOut || result.error || result.mainAliveAfterClose) throw new Error("Memory smoke process did not close.");
    application = undefined;
  };
  try {
    // Preserve the OS HOME only for Keychain access. Explicit Pi and Desktop profiles
    // isolate all product data; the general smoke's fake HOME cannot use real Keychain.
    application = await launch();
    const window = await application.firstWindow();
    await window.getByRole("button", { name: "选择工作区" }).waitFor({ state: "visible", timeout: 30_000 });
    await openPackagedSmokeWorkspace({ application, window, workspace: profile.workspace });
    const workspaceSettings = await openSettingsSection(window, /上下文与记忆/u);
    await verifyPackagedLocalMemorySettings({ application, window, workspaceSettings, userDataDirectory: profile.userDataDirectory });
    await close();
    application = await launch();
    await verifyPackagedLocalMemoryColdReadback(await application.firstWindow());
    const secondWindow = await application.firstWindow();
    const enabled = await secondWindow.evaluate(() => window.pi67.system.localMemoryActivation.get());
    if (!enabled.available || enabled.preference !== "enabled" || !enabled.selectedAtLaunch || enabled.restartRequired
      || enabled.lifecycle === "running") throw new Error("Private activation cold readback was not isolated or truthful.");
    const disabled = await secondWindow.evaluate(() => window.pi67.system.localMemoryActivation.setEnabled(false));
    if (!disabled.available || disabled.preference !== "disabled" || disabled.lifecycle !== "stopped") {
      throw new Error("Private activation did not stop and persist disable.");
    }
    await close(); application = await launch();
    const thirdWindow = await application.firstWindow();
    const final = await thirdWindow.evaluate(() => window.pi67.system.localMemoryActivation.get());
    if (!final.available || final.preference !== "disabled" || final.selectedAtLaunch || final.lifecycle !== "idle") {
      throw new Error("Private activation disable did not survive restart.");
    }
    console.info("Packaged private activation passed: default off, explicit save only, cold enable/disable, no native launch or paid model.");
  } catch (error) {
    scenarioError = error;
  }
  try {
    await close();
    await cleanupPackagedTestDirectories(profile.userDataDirectory);
  } catch (error) {
    if (scenarioError) throw new AggregateError([scenarioError, error], "Memory smoke scenario and cleanup both failed.");
    throw error;
  }
  if (scenarioError) throw scenarioError;
}

/** Synthetic-only packaged UI → preload → Main → OS storage regression. */
async function verifyPackagedLocalMemorySettings({ application, window, workspaceSettings, userDataDirectory }) {
  if (process.platform !== "darwin" || process.arch !== "arm64") return;
  const profile = await application.evaluate(({ app }) => ({
    explicit: app.commandLine.hasSwitch("user-data-dir"), path: app.getPath("userData")
  }));
  if (!profile.explicit || await realpath(profile.path) !== await realpath(userDataDirectory)) {
    throw new Error("Memory settings smoke requires an explicit isolated profile.");
  }
  const navigation = workspaceSettings.getByRole("navigation", { name: "设置分类" });
  const open = () => navigation.getByRole("button", { name: /记忆/u }).click();
  await open();
  const form = workspaceSettings.getByTestId("context-memory-settings");
  await verifyPackagedMemoryRuntime({ application, window, form, userDataDirectory });
  const activation = () => window.evaluate(() => window.pi67.system.localMemoryActivation.get());
  const initialActivation = await activation();
  if (!initialActivation.available || initialActivation.preference !== "disabled" || initialActivation.lifecycle !== "idle") {
    throw new Error("Private memory was not initially disabled.");
  }
  const initialHealth = await window.evaluate(() => window.pi67.system.localMemoryActivation.check());
  if (initialHealth.health !== "not-running" || initialHealth.activation.lifecycle !== "idle") {
    throw new Error("Private health check unexpectedly launched a service.");
  }
  await expect(form.getByLabel("OpenViking 服务地址")).toHaveCount(0);
  await expect(form.getByRole("button", { name: "检测本地服务", exact: true })).toBeDisabled();
  await form.getByRole("tab", { name: "高级", exact: true }).click();
  await expect(form.getByText("兼容服务（手动地址）", { exact: true })).toBeVisible();
  await expect(form.getByLabel("OpenViking 服务地址")).toBeVisible();
  await form.getByRole("tab", { name: "记忆与隐私", exact: true }).click();
  // Presence is deliberately NOT readiness. Use an invalid placeholder only in
  // this owned test profile; it can never pass native admission or invoke a model.
  // The optional signed-install smoke remains separate and is not overwritten.
  const status = await window.evaluate(() => window.pi67.system.localMemoryRuntime.getStatus("private"));
  if (status === "missing") {
    await form.getByRole("button", { name: "启用（重启后生效）", exact: true }).click();
    await expect(form.getByText("请先安装私人记忆运行包，再启用。团队运行包不能代替私人运行包。", { exact: true })).toBeVisible();
    await mkdir(join(userDataDirectory, "openviking/runtime/openviking-0.4.16-python-3.12.10-sdk-0.1.10-darwin-arm64"), { recursive: true, mode: 0o700 });
  }
  await form.getByRole("button", { name: "启用（重启后生效）", exact: true }).click();
  await expect(form.getByText("请先保存完整的本地记忆模型配置，再启用。", { exact: true })).toBeVisible();
  const key = form.getByLabel("Embedding API Key", { exact: true });
  await expect(key).toBeVisible({ timeout: 30_000 });
  await expect(key).toHaveAttribute("type", "password");
  await expect(key).toHaveValue("");
  const initial = await window.evaluate(() => window.pi67.system.localMemoryModels.get());
  if (initial.status !== "unconfigured") throw new Error("Memory smoke profile was not empty.");
  const synthetic = "synthetic-packaged-memory-not-a-provider-key";
  for (const [label, value] of [
    ["提取 Provider ID", "synthetic"], ["提取模型 ID", "synthetic"],
    ["Embedding 服务地址", "https://memory-smoke.invalid/v1"],
    ["Embedding 模型 ID", "synthetic"], ["向量维度", "8"], ["Embedding API Key", synthetic]
  ]) await form.getByLabel(label, { exact: true }).fill(value);
  await expect(form.getByRole("tab", { name: "团队经验", exact: true })).toBeDisabled();
  await navigation.getByRole("button", { name: "模型", exact: true }).click();
  const guard = window.getByRole("dialog", { name: "放弃未保存的修改" });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "继续编辑", exact: true }).click();
  await form.getByRole("button", { name: "保存模型配置", exact: true }).click();
  await expect(form.getByText("模型配置已保存，下次服务启动时生效。本次保存没有改变启用设置，也未调用模型。", { exact: true })).toBeVisible();
  await expect(key).toHaveValue("");
  const saved = await window.evaluate(() => window.pi67.system.localMemoryModels.get());
  if (saved.status !== "configured" || JSON.stringify(saved).includes(synthetic)) throw new Error("Unsafe memory settings snapshot.");
  const persisted = await readFile(join(userDataDirectory, "openviking/settings/models.enc.json"), "utf8");
  if (persisted.includes(synthetic)) throw new Error("Memory key was persisted in plaintext.");
  await form.getByRole("button", { name: "显示 Embedding API Key", exact: true }).click();
  await expect(key).toHaveAttribute("type", "text");
  await expect(key).toHaveValue(synthetic);
  await form.getByRole("button", { name: "隐藏 Embedding API Key", exact: true }).click();
  await expect(key).toHaveAttribute("type", "password");
  await expect(key).toHaveValue("");
  await form.getByRole("button", { name: "显示 Embedding API Key", exact: true }).click();
  await expect(key).toHaveValue(synthetic);
  await navigation.getByRole("button", { name: "模型", exact: true }).click();
  await expect(form).toHaveCount(0);
  await open();
  await expect(key).toHaveAttribute("type", "password");
  await expect(key).toHaveValue("");
  await expect(form.getByLabel("Embedding 模型 ID", { exact: true })).toHaveValue("synthetic");
  await form.getByRole("button", { name: "启用（重启后生效）", exact: true }).click();
  await expect(form.getByRole("button", { name: "关闭私人记忆", exact: true })).toBeVisible();
  const enabled = await activation();
  if (!enabled.available || enabled.preference !== "enabled" || enabled.selectedAtLaunch || !enabled.restartRequired
    || enabled.lifecycle !== "idle") throw new Error("Saving activation unexpectedly started the service.");
  const activationFile = JSON.parse(await readFile(join(userDataDirectory, "openviking/activation.json"), "utf8"));
  if (activationFile.version !== 1 || activationFile.enabled !== true || Object.keys(activationFile).length !== 2) {
    throw new Error("Unexpected activation persistence shape.");
  }
  console.info("Packaged memory settings passed: isolated profile, draft guard, encrypted save, secret-free readback, eye reveal/hide, remount concealment.");
}

async function verifyPackagedLocalMemoryColdReadback(window) {
  if (process.platform !== "darwin" || process.arch !== "arm64") return;
  const valid = await window.evaluate(async () => {
    const bridge = window.pi67.system.localMemoryModels;
    const snapshot = await bridge.get();
    const key = await bridge.revealKey({ endpoint: "https://memory-smoke.invalid/v1" });
    return snapshot.status === "configured" && snapshot.embedding.model === "synthetic"
      && key === "synthetic-packaged-memory-not-a-provider-key" && !JSON.stringify(snapshot).includes(key);
  });
  if (!valid) throw new Error("Packaged memory settings cold readback failed.");
  console.info("Packaged memory settings cold-process readback passed.");
}
