import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeTreeIdentity } from "../../apps/desktop/src/openviking-runtime-tree.mts";

// Explicit installation input, no user configuration discovery or signing.
const input = process.argv[2];
if (!input) throw new Error("Usage: node eng/capabilities/probe-query-embedding-coalescing.mjs /absolute/installation");
const installation = await realpath(input);
const runtime = join(installation, "runtime");
const manifest = JSON.parse(await readFile(join(installation, "manifest.json"), "utf8"));
const before = await runtimeTreeIdentity(runtime);
if (before.sha256 !== manifest.treeSha256) throw new Error("Installed tree does not match its manifest");
const fixture = await realpath(await mkdtemp(join(tmpdir(), "newmoney-embedding-probe-")));
const script = fileURLToPath(new URL("./openviking-runtime/query_embedding_coalescing_probe.py", import.meta.url));
const child = spawnSync(join(runtime, "bin/python3.12"), ["-B", "-s", script], {
  cwd: fixture, timeout: 60_000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8",
  env: { PATH: "/usr/bin:/bin", HOME: fixture, TMPDIR: fixture,
    NM_EMBEDDING_PROBE_ROOT: fixture, PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1",
    OTEL_SDK_DISABLED: "true", OTEL_TRACES_EXPORTER: "none", OTEL_METRICS_EXPORTER: "none" },
});
const after = await runtimeTreeIdentity(runtime);
if (before.sha256 !== after.sha256) throw new Error("Installed runtime changed during experiment");
if (child.status !== 0) {
  console.error(child.stderr.slice(-6000));
  throw new Error(`Synthetic probe failed (${child.status ?? child.signal}); fixture retained at ${fixture}`);
}
const report = JSON.parse(child.stdout.trim());
console.log(JSON.stringify({ ...report, runtimeTreeUnchanged: true, runtimeTreeSha256: before.sha256,
  fixture, platform: process.platform, arch: process.arch }, null, 2));
