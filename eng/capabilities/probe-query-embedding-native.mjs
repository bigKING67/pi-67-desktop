import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runtimeTreeIdentity } from "../../apps/desktop/src/openviking-runtime-tree.mts";
import { startNativeOpenViking } from "../../apps/desktop/src/openviking-native-process.mts";
import { loadLocalMemoryIdentity } from "../../apps/desktop/src/local-memory-identity.mts";
import { applyQueryEmbeddingPatch } from "./openviking-query-patch.mts";
import { verifyQueryPatchGuards } from "./query-patch-guards.test-support.mjs";

// Explicit input, one fresh copy, synthetic HTTP model + real local AGFS/vector DB.
// No signature generation, installed runtime writes, user DB, or provider keys.
assert(process.argv[2] && isAbsolute(process.argv[2]), "Pass an absolute installed runtime directory");
const installation = await realpath(process.argv[2]);
const source = join(installation, "runtime");
const before = await runtimeTreeIdentity(source);
assert.equal(before.sha256, JSON.parse(await readFile(join(installation, "manifest.json"), "utf8")).treeSha256);
const fixture = await realpath(await mkdtemp(join(tmpdir(), "newmoney-query-native-")));
const runtime = join(fixture, "runtime");
await cp(source, runtime, { recursive: true, verbatimSymlinks: true });
assert.equal((await runtimeTreeIdentity(runtime)).sha256, before.sha256);
const dataRoot = join(fixture, "profile");
const profile = await loadLocalMemoryIdentity(dataRoot);
let calls = 0;
let unexpected = 0;
const model = createServer(async (req, res) => {
  let input = "";
  for await (const chunk of req) input += chunk;
  const body = JSON.parse(input || "{}");
  res.setHeader("content-type", "application/json");
  if (req.url !== "/v1/embeddings" || body.model !== "synthetic-query-probe" || req.headers.authorization !== "Bearer synthetic") {
    unexpected += 1; res.statusCode = 400; res.end('{"error":{"message":"unexpected synthetic operation"}}'); return;
  }
  calls += 1;
  const rows = Array.isArray(body.input) ? body.input : [body.input];
  res.end(JSON.stringify({ object: "list", model: body.model, data: rows.map((_, index) => ({
    object: "embedding", index, embedding: [1, 0, 0, 0, 0, 0, 0, 0]
  })), usage: { prompt_tokens: 1, total_tokens: 1 } }));
});
await new Promise(resolve => model.listen(0, "127.0.0.1", resolve));
const configuration = { protocol: "openai-compatible", endpoint: `http://127.0.0.1:${model.address().port}/v1`,
  model: "synthetic-query-probe", apiKey: "synthetic" };
let native;
const report = { schema: "new-money.query-native-probe.v1", fixture, status: "PENDING", sourceTree: before.sha256,
  signed: false, installed: false, paidModels: false, packagedDesktop: "UNVERIFIED", semanticQuality: "UNVERIFIED",
  timingComparison: "NOT_A_BENCHMARK: baseline follows indexing; patched follows cold restart" };
async function start() {
  native = await startNativeOpenViking({ python: join(runtime, "bin/python3.12"), dataRoot, localProfileId: profile,
    embedding: { ...configuration, dimension: 8 }, extraction: configuration }, new AbortController().signal, () => {});
}
async function request(path, body, connection = native.connection, expected = 200) {
  const response = await fetch(`${native.connection.endpoint}${path}`, { method: "POST", redirect: "error",
    signal: AbortSignal.timeout(30_000), headers: { "X-API-Key": connection.apiKey, "content-type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json();
  assert.equal(response.status, expected, `${path}: ${value.error?.code ?? "unexpected status"}`);
  return value.result;
}
const query = { query: "Synthetic weekly structure", mode: "context", query_expansion: "off", rewrite: false,
  dedup_turns: 0, score_threshold: 0, max_tokens: 2000, detail: "full",
  quotas: { preferences: 2, entities: 2, events: 2, experiences: 2, resources: 2, skills: 0 } };
async function recall(connection) {
  const previous = calls;
  const started = performance.now();
  const value = await request("/api/v1/search/search", query, connection);
  const content = { entries: value.entries, rendered: value.rendered, digest: value.digest };
  assert.equal(value.stats?.errors?.length ?? 0, 0);
  return { calls: calls - previous, durationMs: Math.round(performance.now() - started), content,
    hash: createHash("sha256").update(JSON.stringify(content)).digest("hex") };
}
try {
  report.patchGuards = await verifyQueryPatchGuards(source, fixture);
  await start();
  await request("/api/v1/content/write", { uri: "viking://resources/synthetic-query-probe.md",
    content: "Synthetic weekly structure: progress, blockers, next steps.", mode: "create", wait: true, timeout: 20, processing_mode: "vectors_only" });
  const baseline = await recall();
  assert(baseline.calls > 1); assert(baseline.content.entries.length > 0);
  assert(baseline.content.rendered.includes("progress, blockers, next steps"));
  await native.stop(); native = undefined;
  report.patch = await applyQueryEmbeddingPatch(runtime);
  const patchedTree = await runtimeTreeIdentity(runtime);
  await assert.rejects(applyQueryEmbeddingPatch(runtime), /already exists/u);
  assert.equal((await runtimeTreeIdentity(runtime)).sha256, patchedTree.sha256);
  const safety = await promisify(execFile)(join(runtime, "bin/python3.12"), ["-I", "-B",
    fileURLToPath(new URL("./openviking-runtime/request_query_embedding_test.py", import.meta.url))], {
    cwd: fixture, env: { PATH: "/usr/bin:/bin", HOME: fixture, TMPDIR: fixture }, timeout: 30_000, maxBuffer: 65536
  });
  assert(safety.stdout.includes("QUERY_SCOPE_TESTS_PASS"));
  report.scopeTests = "PASS";
  await start();
  const patched = await recall();
  assert.equal(patched.calls, 1);
  assert.deepEqual(patched.content, baseline.content);
  const repeated = await recall();
  assert.equal(repeated.calls, 1); assert.deepEqual(repeated.content, baseline.content);
  const other = await native.provisionScope("synthetic-other-account");
  assert.equal((await recall(other)).content.entries.length, 0);
  await request("/api/v1/search/search", query, { apiKey: "invalid-synthetic" }, 401);
  const countBeforeConcurrent = calls;
  const concurrent = await Promise.all([recall(), recall()]);
  assert.equal(calls - countBeforeConcurrent, 2);
  for (const result of concurrent) assert.deepEqual(result.content, baseline.content);
  await native.stop(); native = undefined;
  assert.equal((await runtimeTreeIdentity(runtime)).sha256, patchedTree.sha256);
  assert.equal(unexpected, 0);
  Object.assign(report, { status: "PASS", baselineCalls: baseline.calls, patchedCalls: patched.calls,
    baselineMs: baseline.durationMs, patchedMs: patched.durationMs, entries: patched.content.entries.length,
    contentSha256: patched.hash, patchedTree: patchedTree.sha256, repeatedFreshScope: true,
    concurrentScopes: true, crossAccountIsolation: true, invalidCredentialRejected: true, restartPersistence: true });
} catch (error) {
  report.status = "FAILED";
  report.error = error instanceof Error ? error.message : "Native probe failed";
  process.exitCode = 1;
} finally {
  await native?.stop();
  await new Promise(resolve => model.close(resolve));
  report.sourceTreeUnchanged = (await runtimeTreeIdentity(source)).sha256 === before.sha256;
  if (!report.sourceTreeUnchanged) { report.status = "FAILED"; process.exitCode = 1; }
  await writeFile(join(fixture, "receipt.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
