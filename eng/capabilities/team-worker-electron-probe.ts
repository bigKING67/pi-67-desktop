import { app, utilityProcess } from "electron";
import { generateKeyPairSync, sign } from "node:crypto";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join } from "node:path";
import { TeamWorkerSupervisor } from "../../apps/desktop/src/team-worker-supervisor.js";
import { startNativeTeamModelWorker } from "../../apps/desktop/src/native-team-model-worker.mjs";
import { loadLocalMemoryIdentity } from "../../apps/desktop/src/local-memory-identity.mjs";
import { runtimeTreeIdentity } from "../../apps/desktop/src/openviking-runtime-tree.mjs";
import { prepareTeamWorker } from "../../apps/desktop/src/team-worker-preparation.js";
import { admitOpenVikingRuntime } from "../../apps/desktop/src/openviking-runtime-admission.js";
import { setTimeout as delay } from "node:timers/promises";

const directory = process.env.PI67_TEAM_PORT_PROBE_DIR, python = process.env.PI67_TEAM_MODEL_TEST_PYTHON;
const keys = generateKeyPairSync("ed25519");
let installation: { runtimeRoot: string; manifest: Buffer; signature: Buffer };
let slowPreparationMs = 0;
if (!directory || !python || !isAbsolute(directory) || !isAbsolute(python)) app.exit(1);
else {
  app.setPath("userData", directory);
  void app.whenReady().then(async () => {
    const runtimeRoot = await realpath(dirname(dirname(python)));
    const tree = await runtimeTreeIdentity(runtimeRoot, AbortSignal.timeout(60_000));
    const manifest = Buffer.from(JSON.stringify({ schema: "new-money.openviking-runtime.v1", platform: process.platform,
      arch: process.arch, pythonVersion: "3.12.10", openvikingVersion: "0.4.16", sdkVersion: "0.1.10", treeSha256: tree.sha256 }));
    // Ephemeral TEST trust only: do not sign, alter or adopt an installed bundle.
    installation = { runtimeRoot, manifest, signature: sign(null, manifest, keys.privateKey) };
    for (const mode of ["success", "deny", "cancel", "host-exit"] as const) await probe(mode);
    console.log(`TEAM_WORKER_ELECTRON_PASS: two-phase preflight ${slowPreparationMs}ms (>5s), fresh ephemeral-key runtime admission, isolated staging, Main permit, real utility Host authorization, pinned Python embedding, denial, cancellation, Host exit, absent process groups, empty staging cleanup`);
    app.exit(0);
  }).catch(() => { console.error("TEAM_WORKER_ELECTRON_FAILED: synthetic worker lifecycle check failed"); app.exit(1); });
}

async function probe(mode: "success" | "deny" | "cancel" | "host-exit") {
  const memoryRoot = join(directory!, `memory-${mode}`);
  const localProfileId = await loadLocalMemoryIdentity(memoryRoot);
  const teamId = "00000000-0000-4000-8000-000000000001";
  const prepared = await prepareTeamWorker({ memoryRoot, trustedKey: keys.publicKey,
    loadRuntime: async () => ({ ...installation, dataRoot: await realpath(memoryRoot) }) },
  { localProfileId, endpoint: "https://fixture.invalid", userId: "synthetic-user", teamId, scopeKind: "team", scopeId: teamId }, new AbortController().signal);
  await prepared.assertCurrent();
  const host = utilityProcess.fork(fileURLToPath(new URL("./team-worker-utility-probe.mjs", import.meta.url)), [mode], {
    stdio: "ignore", cwd: directory!, env: { PATH: process.env.PATH ?? "" }
  });
  let exited = false, pid: number | undefined;
  const exit = new Promise<void>(resolve => host.once("exit", () => { exited = true; resolve(); }));
  const workers = new TeamWorkerSupervisor(() => exited ? undefined : host, async (options, signal) => {
    const worker = await startNativeTeamModelWorker(options, signal); pid = worker.pid; return worker;
  });
  let resolveReport!: (value: { outcome: string; invoked: number }) => void;
  const report = new Promise<{ outcome: string; invoked: number }>(resolve => { resolveReport = resolve; });
  let resolveOutcome!: (value: string) => void, rejectOutcome!: () => void;
  const outcome = new Promise<string>((resolve, reject) => { resolveOutcome = resolve; rejectOutcome = () => reject(new Error("Worker probe protocol failed.")); });
  host.on("message", (message: unknown) => {
    if (workers.handleMessage(host, message)) return;
    if (!message || typeof message !== "object" || !("type" in message)) { rejectOutcome(); return; }
    if (message.type === "probe-done" && "outcome" in message && typeof message.outcome === "string" && "invoked" in message && typeof message.invoked === "number") {
      resolveReport({ outcome: message.outcome, invoked: message.invoked }); return;
    }
    if (message.type !== "probe-reserved" || !("requestId" in message) || typeof message.requestId !== "string") { rejectOutcome(); return; }
    try {
      const permit = workers.register(message.requestId, { python: prepared.runtime.python, cwd: prepared.directory, arguments: ["model"],
        bootstrap: fileURLToPath(new URL("../../eng/capabilities/openviking-runtime/native_team_worker_probe.py", import.meta.url)) }, new AbortController().signal, async signal => {
        const began = performance.now();
        // A deliberate scheduling stressor, not a performance benchmark. Force
        // >5s in one case even on a warm disk, then freshly verify before spawn.
        if (mode === "success") await delay(6_000, undefined, { signal });
        const current = await admitOpenVikingRuntime(installation, keys.publicKey, signal);
        if (current.tree.sha256 !== prepared.runtime.tree.sha256) throw new Error("Probe runtime changed.");
        await prepared.assertCurrent(); signal.throwIfAborted();
        if (mode === "success") {
          slowPreparationMs = Math.round(performance.now() - began);
          if (slowPreparationMs < 6_000) throw new Error("Slow preflight was not exercised.");
        }
      });
      void permit.completion.then(resolveOutcome, () => resolveOutcome("failed"));
      host.postMessage({ type: "probe-launch" });
    } catch { rejectOutcome(); }
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("Worker probe timed out.")), 30_000); });
  try {
    const result = await Promise.race([outcome, expired]);
    const expected = mode === "success" ? "completed" : mode === "deny" ? "failed" : "cancelled";
    if (result !== expected || !pid) throw new Error("Worker outcome mismatch.");
    try { process.kill(-pid, 0); throw new Error("Worker group survived."); }
    catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ESRCH") throw error; }
    if (mode !== "host-exit") {
      const actual = await Promise.race([report, expired]);
      if (actual.outcome !== expected || actual.invoked !== (mode === "deny" ? 0 : 1)) throw new Error("Host receipt mismatch.");
    }
  } finally {
    clearTimeout(timeout);
    try { await workers.shutdown(); }
    finally {
      if (!exited) host.kill();
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([exit, new Promise<never>((_resolve, reject) => { cleanupTimer = setTimeout(() => reject(new Error("Utility cleanup unconfirmed.")), 5_000); })]); }
      finally { clearTimeout(cleanupTimer); }
    }
    await prepared.discard();
  }
}
