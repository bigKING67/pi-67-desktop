import { app, safeStorage } from "electron";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DesktopSafeStorage } from "../../apps/desktop/src/desktop-safe-storage.js";
import { LocalMemoryModelSettingsStore } from "../../apps/desktop/src/local-memory-model-settings.js";
import { LocalMemorySettingsController } from "../../apps/desktop/src/local-memory-settings-controller.js";

// Standalone Main-process probe: never imports the product entrypoint or real profile.
const directory = process.env.PI67_MEMORY_SETTINGS_PROBE_DIR;
if (!directory || resolve(directory) !== directory) app.exit(1);
else {
  app.setPath("userData", directory);
  void app.whenReady().then(async () => {
    const encryption = new DesktopSafeStorage(safeStorage);
    if (encryption.ensureAvailable() !== "available") throw new Error("Secure storage unavailable");
    const store = new LocalMemoryModelSettingsStore(join(directory, "memory"), encryption);
    const controller = new LocalMemorySettingsController(store);
    const key = "synthetic-memory-probe-not-a-provider-credential";
    const endpoint = "https://memory-probe.invalid/v1";
    const input = { extraction: { provider: "synthetic", model: "synthetic" }, embedding: {
      protocol: "openai-compatible", endpoint, model: "synthetic", dimension: 8,
      apiKey: { action: "replace", value: key }
    } };
    const check = (condition: boolean) => { if (!condition) throw new Error("Probe assertion failed"); };
    check((await controller.get()).status === "unconfigured");
    const saved = await controller.save(input);
    check(saved.status === "configured" && !JSON.stringify(saved).includes(key));
    const raw = await readFile(store.path, "utf8");
    const envelope = JSON.parse(raw) as { ciphertext: string };
    check(!raw.includes(key) && !Buffer.from(envelope.ciphertext, "base64").includes(Buffer.from(key)));
    check(((await stat(store.path)).mode & 0o777) === 0o600);
    const reopened = new LocalMemorySettingsController(new LocalMemoryModelSettingsStore(
      join(directory, "memory"), new DesktopSafeStorage(safeStorage)
    ));
    check(JSON.stringify(await reopened.get()) === JSON.stringify(saved));
    check(await reopened.revealKey({ endpoint }) === key);
    let rejected = false;
    try { await reopened.revealKey({ endpoint: "https://another-probe.invalid/v1" }); }
    catch { rejected = true; }
    check(rejected);
    await reopened.save({ ...input, embedding: { ...input.embedding, apiKey: { action: "keep" } } });
    check(await reopened.revealKey({ endpoint }) === key);
    console.log("MEMORY_SETTINGS_ELECTRON_PASS: OS encryption, ciphertext-only file, owner permissions, secret-free snapshots, reopen, explicit endpoint-bound reveal, retained key");
    app.exit(0);
  }).catch(() => {
    console.error("MEMORY_SETTINGS_ELECTRON_FAILED: secure storage or settings contract failed; no credential values logged");
    app.exit(1);
  });
}
