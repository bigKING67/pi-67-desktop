import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

// Explicit local integration check, not a release gate or a real-profile migration.
// Requires installed dependencies; bundles current Main sources using the existing toolchain.
const root = fileURLToPath(new URL("../../", import.meta.url));
const run = promisify(execFile);
if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("This native probe currently requires macOS arm64.");
}
await mkdir(join(root, "artifacts"), { recursive: true });
const temporary = await mkdtemp(join(root, "artifacts", "memory-settings-electron-"));
try {
  await run("corepack", ["pnpm", "--filter", "@pi67/protocol", "run", "build"], { cwd: root, timeout: 60_000 });
  await run("corepack", ["pnpm", "--filter", "@pi67/desktop", "exec", "tsdown",
    join(root, "eng/capabilities/local-memory-settings-electron-probe.ts"),
    "--no-config", "--format", "esm", "--dts", "false", "--out-dir", temporary,
    "--deps.never-bundle", "electron"], { cwd: root, timeout: 60_000 });
  const environment = { ...process.env, PI67_MEMORY_SETTINGS_PROBE_DIR: temporary };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = await run(electron, [join(temporary, "local-memory-settings-electron-probe.mjs")], {
    cwd: root, env: environment, timeout: 45_000, maxBuffer: 128 * 1024
  });
  const marker = result.stdout.split("\n").find((line) => line.startsWith("MEMORY_SETTINGS_ELECTRON_PASS:"));
  if (!marker) throw new Error("Probe did not produce its success receipt.");
  console.log(marker);
} catch {
  console.error("Native memory settings probe failed; no child output or credential values exposed.");
  process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
