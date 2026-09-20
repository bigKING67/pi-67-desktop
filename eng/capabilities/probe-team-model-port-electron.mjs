import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

// Explicit isolated Electron transport proof; --worker adds pinned native Python
// and synthetic Host grants/model responses. No product startup or user data.
const root = fileURLToPath(new URL("../../", import.meta.url)), run = promisify(execFile);
const worker = process.argv[2] === "--worker";
if (process.argv.length > (worker ? 3 : 2) || !worker && process.argv.length !== 2) throw new Error("Unsupported probe arguments.");
if (worker && !process.env.PI67_TEAM_MODEL_TEST_PYTHON) throw new Error("Pinned Python is required for the worker probe.");
const prefix = worker ? "team-worker" : "team-model-port";
if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Probe requires macOS arm64.");
await mkdir(join(root, "artifacts"), { recursive: true });
const temporary = await mkdtemp(join(root, "artifacts", "team-model-port-electron-"));
let passed = false;
try {
  await run("corepack", ["pnpm", "--filter", "@pi67/protocol", "run", "build"], { cwd: root, timeout: 60_000 });
  await run("corepack", ["pnpm", "--filter", "@pi67/desktop", "exec", "tsdown",
    join(root, `eng/capabilities/${prefix}-electron-probe.ts`), join(root, `eng/capabilities/${prefix}-utility-probe.ts`),
    "--no-config", "--format", "esm", "--dts", "false", "--out-dir", temporary, "--deps.never-bundle", "electron"],
  { cwd: root, timeout: 60_000 });
  const environment = { ...process.env, PI67_TEAM_PORT_PROBE_DIR: temporary };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = await run(electron, [join(temporary, `${prefix}-electron-probe.mjs`)], {
    cwd: root, env: environment, timeout: worker ? 150_000 : 60_000, maxBuffer: 128 * 1024
  });
  const marker = result.stdout.split("\n").find(line => line.startsWith(worker ? "TEAM_WORKER_ELECTRON_PASS:" : "TEAM_MODEL_PORT_ELECTRON_PASS:"));
  if (!marker) throw new Error("Probe receipt missing.");
  passed = true; console.log(marker);
} catch {
  console.error(`Native team port probe failed; isolated evidence retained at ${temporary}; no child payloads printed.`);
  process.exitCode = 1;
} finally {
  if (passed) await rm(temporary, { recursive: true, force: true });
}
