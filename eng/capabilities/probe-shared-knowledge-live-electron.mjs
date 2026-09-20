import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const root = fileURLToPath(new URL("../../", import.meta.url)), run = promisify(execFile);
const directory = process.env.PI67_NEWMONEY_LIVE_DIRECTORY;
const native = process.argv[2] === "--native";
const web = native && process.argv[3] === "--web";
if (process.argv.length !== (web ? 4 : native ? 3 : 2) || !directory || !isAbsolute(directory)) throw new Error("An explicit private live directory is required.");
if (native && (!process.env.PI67_TEAM_MODEL_TEST_PYTHON || !isAbsolute(process.env.PI67_TEAM_MODEL_TEST_PYTHON))) throw new Error("Pinned isolated Python is required.");
if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Probe requires macOS arm64.");
if (process.env.NODE_EXTRA_CA_CERTS !== join(directory, "cert.pem") || process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
  throw new Error("Test-process-only certificate trust is required.");
}
await mkdir(join(root, "artifacts"), { recursive: true });
const temporary = await mkdtemp(join(root, "artifacts", "shared-knowledge-live-electron-"));
let passed = false;
try {
  await run("corepack", ["pnpm", "--filter", "@pi67/protocol", "run", "build"], { cwd: root, timeout: 60_000 });
  await run("corepack", ["pnpm", "--filter", "@pi67/desktop", "exec", "tsdown",
    join(root, "eng/capabilities/shared-knowledge-live-electron-probe.ts"),
    join(root, "eng/capabilities/shared-knowledge-live-utility-probe.ts"),
    "--no-config", "--format", "esm", "--dts", "false", "--out-dir", temporary, "--deps.never-bundle", "electron"],
  { cwd: root, timeout: 60_000 });
  const env = { ...process.env, PI67_KNOWLEDGE_ELECTRON_PROBE_DIR: temporary,
    PI67_KNOWLEDGE_PROBE_NATIVE: native ? "1" : "0",
    PI67_KNOWLEDGE_PROBE_WEB: web ? "1" : "0",
    PI67_KNOWLEDGE_PROBE_BOOTSTRAP_DIR: join(root, "eng/capabilities/openviking-runtime") };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = await run(electron, [join(temporary, "shared-knowledge-live-electron-probe.mjs")], {
    cwd: root, env, timeout: web ? 1_500_000 : native ? 1_080_000 : 240_000, maxBuffer: 128 * 1024
  });
  const marker = result.stdout.split("\n").find(line => line.startsWith("SHARED_KNOWLEDGE_ELECTRON_PASS:"));
  if (!marker) throw new Error("Probe receipt missing.");
  if (native && !result.stdout.includes("SHARED_KNOWLEDGE_NATIVE_PASS:")) throw new Error("Native probe receipt missing.");
  if (web && !result.stdout.includes("SHARED_KNOWLEDGE_WEB_PASS:")) throw new Error("Web governance receipt missing.");
  if (web) console.log(result.stdout.split("\n").find(line => line.startsWith("SHARED_KNOWLEDGE_WEB_PASS:")));
  if (native) console.log(result.stdout.split("\n").find(line => line.startsWith("SHARED_KNOWLEDGE_NATIVE_PASS:")));
  passed = true; console.log(marker);
} catch (error) {
  if (typeof error?.stderr === "string") {
    for (const line of error.stderr.split("\n")) {
      if (/^LIVE_NATIVE_WORKER: code=-?\d{1,3}$/.test(line)
        || /^LIVE_QUERY_DIAGNOSTIC: step=\d{1,2},elapsedMs=\d{1,6},aborted=[01]$/.test(line)
        || /^LIVE_HTTP_DIAGNOSTIC: requests=\d{1,4},responses=\d{1,4},timeouts=\d{1,4},authorizationOk=\d{1,4},authorizationFailed=\d{1,4}$/.test(line)
        || /^LIVE_NATIVE_DIAGNOSTIC: modelCalls=\d{1,4},queryEmbeddings=\d{1,4},invokeAttempts=\d{1,4},invokeStage=\d{1,4}$/.test(line)) console.error(line);
    }
  }
  // Permit only a fixed stage identifier, never raw subprocess output/stack.
  const stage = typeof error?.stderr === "string" ? error.stderr.match(/^Live Electron stage failed: ([a-z-]+)$/m)?.[1] : undefined;
  console.error(`Live Electron probe failed${stage ? ` at ${stage}` : ""}; isolated evidence at ${temporary}; no child payloads printed.`);
  process.exitCode = 1;
} finally {
  if (passed) await rm(temporary, { recursive: true, force: true });
}
