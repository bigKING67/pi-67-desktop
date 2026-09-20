import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { repositoryRoot } from "./packaged-electron-fixture.mjs";

/** Only native picker selection is stubbed; IPC, trust and installer remain real. */
export async function verifyPackagedMemoryRuntime({ application, window, form, userDataDirectory }) {
  const install = form.getByRole("button", { name: "安装私人记忆运行包", exact: true });
  await expect(install).toBeEnabled({ timeout: 30_000 });
  const status = () => window.evaluate(() => window.pi67.system.localMemoryRuntime.getStatus());
  expect(await status()).toBe("missing");
  const invalid = join(userDataDirectory, "unsigned-runtime-fixture");
  await mkdir(invalid, { mode: 0o700 });
  for (const [purpose, title] of [["private", "私人记忆运行包"], ["team-index-v1", "团队索引运行包"], ["team-query-v1", "团队检索运行包"]]) {
    const action = form.getByRole("button", { name: `安装${title}`, exact: true });
    await expect(action).toBeEnabled();
    expect(await window.evaluate((kind) => window.pi67.system.localMemoryRuntime.getStatus(kind), purpose)).toBe("missing");
    await application.evaluate(({ dialog }) => {
      dialog.showOpenDialog = () => new Promise((resolve) => { dialog.finishRuntimePicker = () => resolve({ canceled: false, filePaths: ["/never-read"] }); });
    });
    await action.click();
    const cancel = form.getByRole("button", { name: "取消安装", exact: true });
    await expect(cancel).toBeEnabled();
    const others = form.getByRole("button", { name: /^安装.*运行包$/u });
    await expect(others).toHaveCount(2);
    for (const other of await others.all()) await expect(other).toBeDisabled();
    await cancel.click();
    await expect(form.getByRole("button", { name: "正在取消…", exact: true })).toBeDisabled();
    await application.evaluate(({ dialog }) => { dialog.finishRuntimePicker(); delete dialog.finishRuntimePicker; });
    await expect(form.getByText("已取消安装；已有运行包和私人记忆保持不变。", { exact: true })).toBeVisible();
    await expect(form.getByText(`${title}：`, { exact: true })).toBeVisible();
    await expect(action).toBeEnabled();
    await application.evaluate(({ dialog }, source) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] }); }, invalid);
    await action.click();
    await expect(form.getByText(/^安装未完成。/u)).toBeVisible({ timeout: 30_000 });
    expect(await window.evaluate((kind) => window.pi67.system.localMemoryRuntime.getStatus(kind), purpose)).toBe("missing");
  }
  expect(await status()).toBe("missing");
  expect(await readdir(join(userDataDirectory, "openviking/runtime"))).toEqual([]);
  // An explicit local opt-in exercises a genuine signed source without copying the
  // 600+ MiB runtime during every ordinary smoke. No signing key is accessed here.
  if (process.env.PI67_MEMORY_RUNTIME_SMOKE_SOURCE) {
    await application.evaluate(({ dialog }, source) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] }); }, process.env.PI67_MEMORY_RUNTIME_SMOKE_SOURCE);
    await install.click();
    await expect(form.getByText("运行包已验签并安装。本次安装未改变记忆启用设置，也未调用模型。", { exact: true })).toBeVisible({ timeout: 180_000 });
    expect(await status()).toBe("present"); await expect(install).toBeDisabled();
  }
  const evidenceRoot = join(repositoryRoot, "artifacts/memory-ui"); await mkdir(evidenceRoot, { recursive: true });
  const evidence = await mkdtemp(join(evidenceRoot, "runtime-"));
  const section = form.locator("section").filter({ has: window.getByRole("heading", { name: "本地运行包", exact: true }) });
  const navigation = window.getByRole("navigation", { name: "设置分类" });
  for (const [theme, label] of [["light", "浅色"], ["dark", "深色"]]) {
    await navigation.getByRole("button", { name: /^外观/u }).click();
    await window.getByRole("button", { name: new RegExp(`^${label}`, "u") }).click();
    await expect(window.locator("html")).toHaveAttribute("data-theme", theme);
    await navigation.getByRole("button", { name: /记忆/u }).click();
    await section.screenshot({ path: join(evidence, `${theme}.png`), timeout: 15_000, animations: "disabled" });
  }
  console.info(`Packaged runtime UI passed: three purposes, shared pending/cancel, unsigned rejection, clean staging${process.env.PI67_MEMORY_RUNTIME_SMOKE_SOURCE ? ", signed private installation" : ""}; screenshots: ${evidence}`);
}
