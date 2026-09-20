import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { assertPreparedDesktopToolchain } from "../packaging/prepare-toolchain.mjs";

// Official Host entry, isolated Main driver. Never imports the user's profile.
const root = fileURLToPath(new URL("../../", import.meta.url)), run = promisify(execFile);
const live = process.argv.length === 3 && process.argv[2] === "--live";
if ((!live && process.argv.length !== 2) || process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("Host Session probe requires macOS arm64; only --live is accepted.");
}
const liveDirectory = live ? process.env.PI67_NEWMONEY_LIVE_DIRECTORY : undefined;
if (live && (!liveDirectory || !isAbsolute(liveDirectory) || process.env.NODE_EXTRA_CA_CERTS !== join(liveDirectory, "cert.pem"))) {
  throw new Error("Live mode requires an absolute private fixture directory and its process-only certificate trust.");
}
await assertPreparedDesktopToolchain();
await mkdir(join(root, "artifacts"), { recursive: true });
const temporary = await mkdtemp(join(root, "artifacts", "agent-host-session-"));
let passed = false;
try {
  await run("corepack", ["pnpm", "--filter", "@pi67/agent-host...", "run", "build"], { cwd: root, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
  await run("corepack", ["pnpm", "--filter", "@pi67/desktop", "exec", "tsdown",
    join(root, "eng/capabilities/agent-host-session-electron-probe.ts"), "--no-config", "--format", "esm", "--dts", "false",
    "--out-dir", temporary, "--deps.never-bundle", "electron"], { cwd: root, timeout: 60_000 });
  const result = await run(electron, [join(temporary, "agent-host-session-electron-probe.mjs")], {
    cwd: root, timeout: live ? 280_000 : 180_000, maxBuffer: 128 * 1024,
    env: { PATH: process.env.PATH, PI67_HOST_SESSION_PROBE_DIR: temporary,
      ...(liveDirectory ? { PI67_NEWMONEY_LIVE_DIRECTORY: liveDirectory, NODE_EXTRA_CA_CERTS: join(liveDirectory, "cert.pem") } : {}),
      PI67_HOST_SESSION_PROBE_TOOLCHAIN: join(root, "artifacts/toolchain/current"),
      PI67_HOST_SESSION_PROBE_ENTRY: join(root, "apps/agent-host/dist/index.mjs") }
  });
  const marker = result.stdout.split("\n").find(line => line.startsWith(live ? "HOST_SESSION_LIVE_PASS:" : "HOST_SESSION_ENTRY_PASS:"));
  if (!marker) throw new Error("Host Session receipt missing.");
  console.log(marker); passed = true;
} catch (error) {
  if (typeof error?.stderr === "string") {
    for (const line of error.stderr.split("\n")) {
      if (/^HOST_SESSION_FAILED: stage=[a-z.-]+$/.test(line)
        || /^HOST_SESSION_RESPONSE_FAILED: type=[a-zA-Z.]+,code=[A-Z_]+$/.test(line)) console.error(line);
    }
  }
  console.error(`Host Session probe failed; isolated evidence at ${temporary}; no child payloads printed.`);
  process.exitCode = 1;
} finally {
  if (passed) await rm(temporary, { recursive: true, force: true });
}
