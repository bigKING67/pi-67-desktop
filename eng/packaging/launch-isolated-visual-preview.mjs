#!/usr/bin/env node
// Starts the latest unsigned macOS preview as an isolated, offline copy with a local
// CDP endpoint, so browser67 (`tmwd_mode: "remote_cdp"`) can capture and measure the
// packaged Renderer without touching the user's profile, Pi Profile or credentials.
// Usage: node eng/packaging/launch-isolated-visual-preview.mjs [--stop] [--port 9222]
import { spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1] ?? 9222) || 9222;
const base = join(tmpdir(), "pi67-visual-preview");
const marker = `--user-data-dir=${join(base, "userdata")}`;

const pidFile = join(tmpdir(), "pi67-visual-preview.pid");

function stopExisting() {
  try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGTERM"); } catch { /* none running */ }
  rmSync(pidFile, { force: true });
}

if (process.platform !== "darwin") {
  console.error("The isolated visual preview launcher supports macOS only.");
  process.exit(1);
}
stopExisting();
if (args.includes("--stop")) {
  console.log("Stopped the isolated visual preview.");
  process.exit(0);
}

rmSync(base, { force: true, recursive: true });
for (const directory of ["userdata", "agent/extensions", "workspace"]) mkdirSync(join(base, directory), { recursive: true });
const executable = join(root, "artifacts/release/mac-arm64/New Money.app/Contents/MacOS/New Money");
const log = openSync(join(base, "app.log"), "a");
const child = spawn(executable, ["--use-mock-keychain", marker, `--remote-debugging-port=${port}`], {
  detached: true,
  env: { ...process.env, PI_CODING_AGENT_DIR: join(base, "agent"), PI_OFFLINE: "1" },
  stdio: ["ignore", log, log]
});
child.unref();
writeFileSync(pidFile, String(child.pid));

const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    if (targets.some((target) => target.type === "page" && target.url.startsWith("app://pi67"))) {
      console.log(`Isolated visual preview ready: cdp_endpoint=http://127.0.0.1:${port} pid=${child.pid}`);
      console.log("Use browser67 with tmwd_mode=remote_cdp and target_url_contains=app://pi67; stop with --stop.");
      process.exit(0);
    }
  } catch { /* not listening yet */ }
  await new Promise((settle) => setTimeout(settle, 500));
}
console.error(`The packaged app did not expose app://pi67 on port ${port}; see ${join(base, "app.log")}.`);
process.exit(1);
