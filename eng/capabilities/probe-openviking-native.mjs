import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { OpenVikingSidecarSupervisor } from "../../apps/desktop/src/openviking-sidecar-supervisor.mts";
import { loadLocalMemoryIdentity } from "../../apps/desktop/src/local-memory-identity.mts";
import { bindLocalMemoryIndex } from "../../apps/desktop/src/local-memory-index-binding.mts";
import { startNativeOpenViking } from "../../apps/desktop/src/openviking-native-process.mts";

// Native storage/auth/index smoke with a synthetic model stub. No user config,
// credentials, Lab, external model or semantic-quality claim is involved.
const python = process.argv[2];
assert(python && isAbsolute(python), "Pass an absolute isolated Python executable");
const version = spawnSync(python, ["-I", "-B", "-c", "from importlib.metadata import version; print(version('openviking'))"], { encoding: "utf8" });
assert.equal(version.status, 0, "Cannot identify the isolated runtime");
assert.equal(version.stdout.trim(), "0.4.16", "This probe is version-pinned");
const root = await mkdtemp(join(tmpdir(), "new-money-native-probe-"));
const redactions = new Set();
let embeddingCalls = 0;
let supervisor;
let native;
let origin;
const localProfileId = await loadLocalMemoryIdentity(root);
const model = createServer(async (req, res) => {
  let input = "";
  for await (const chunk of req) input += chunk;
  const body = JSON.parse(input || "{}");
  res.setHeader("content-type", "application/json");
  if (body.model !== modelConfiguration.model || req.headers.authorization !== `Bearer ${modelConfiguration.apiKey}`) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: { message: "Synthetic model/key interpolation mismatch" } }));
    return;
  }
  if (req.url?.endsWith("/embeddings")) {
    embeddingCalls += 1;
    const rows = Array.isArray(body.input) ? body.input : [body.input];
    res.end(JSON.stringify({ object: "list", model: "synthetic", data: rows.map((_, index) => ({
      object: "embedding", index, embedding: Array.from({ length: 8 }, (_, i) => i === 0 ? 1 : 0)
    })), usage: { prompt_tokens: 1, total_tokens: 1 } }));
  } else {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: { message: "Unexpected model operation in vectors-only probe" } }));
  }
});
await new Promise(resolve => model.listen(0, "127.0.0.1", resolve));
const modelConfiguration = { protocol: "openai-compatible", endpoint: `http://127.0.0.1:${model.address().port}/v1`,
  model: "synthetic-$NEWMONEY_OV_ROOT_KEY", apiKey: 'synthetic-"\\key$UNSET' };

async function request(path, key, body, expected = 200, method = body ? "POST" : "GET") {
  const response = await fetch(`${origin}${path}`, {
    method, redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { "X-API-Key": key, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const value = await response.json();
  assert.equal(response.status, expected, `${path}: unexpected HTTP status`);
  return value;
}

async function start() {
  assert.equal(await loadLocalMemoryIdentity(root), localProfileId);
  await bindLocalMemoryIndex(root, { ...modelConfiguration, dimension: 8 });
  supervisor = new OpenVikingSidecarSupervisor((signal, onExit) => startNativeOpenViking({
    python, dataRoot: root, localProfileId, embedding: { ...modelConfiguration, dimension: 8 },
    extraction: modelConfiguration
  }, signal, onExit));
  native = await supervisor.ensureStarted();
  origin = native.connection.endpoint;
  redactions.add(native.connection.apiKey);
}

async function stop() {
  await supervisor?.stop();
}

const receipt = { schema: "new-money.native-openviking-probe.v1", platform: process.platform,
  arch: process.arch, version: "0.4.16", model: "synthetic-vectors-only", root,
  checks: [], semanticQuality: "UNVERIFIED", packagedDesktop: "UNVERIFIED" };
try {
  await start();
  receipt.checks.push("native-start");
  const accounts = [native.connection.apiKey];
  for (const name of ["project-alpha", "project-beta"]) {
    const value = await native.provisionScope(name);
    redactions.add(value.apiKey);
    accounts.push(value.apiKey);
  }
  await request("/api/v1/admin/accounts", accounts[0], undefined, 403);
  receipt.checks.push("private-key-not-root");
  const privateUri = "viking://resources/private-synthetic-note.md";
  await request("/api/v1/content/write", accounts[0], { uri: privateUri,
    content: "Synthetic private profile persistence fixture.", mode: "create",
    wait: true, timeout: 20, processing_mode: "vectors_only" });
  const uri = "viking://resources/synthetic-sop.md";
  await request("/api/v1/content/write", accounts[1], { uri,
    content: "# 合成 SOP\nProject alpha synthetic isolation fixture.", mode: "create",
    wait: true, timeout: 20, processing_mode: "vectors_only" });
  const readPath = `/api/v1/content/read?uri=${encodeURIComponent(uri)}`;
  const own = await request(readPath, accounts[1]);
  assert(JSON.stringify(own).includes("Project alpha"));
  for (const key of [accounts[0], accounts[2]]) await request(readPath, key, undefined, 404);
  receipt.checks.push("scoped-write-read", "private-project-isolation", "cross-project-isolation");
  const query = { query: "Project alpha", target_uri: "viking://resources/",
    limit: 10, score_threshold: 0 };
  const ownSearch = await request("/api/v1/search/find", accounts[1], query);
  assert(JSON.stringify(ownSearch.result).includes("synthetic-sop"));
  for (const key of [accounts[0], accounts[2]]) {
    const otherSearch = await request("/api/v1/search/find", key, query);
    assert(!JSON.stringify(otherSearch.result).includes("synthetic-sop"));
  }
  receipt.checks.push("vector-search-scope-isolation");
  assert(embeddingCalls > 0, "Actual native index path must call the synthetic embedder");
  receipt.checks.push("literal-model-and-key-interpolation");
  await stop();
  await assert.rejects(bindLocalMemoryIndex(root, { ...modelConfiguration, dimension: 16 }), /rebuild/);
  await assert.rejects(bindLocalMemoryIndex(root, { ...modelConfiguration, model: "different-model", dimension: 8 }), /rebuild/);
  receipt.checks.push("embedding-change-requires-rebuild");
  assert(!(await readdir(root)).some(name => name.startsWith(".run-")), "Ephemeral credential config must be removed");
  await start();
  accounts[1] = (await native.provisionScope("project-alpha")).apiKey;
  redactions.add(accounts[1]);
  receipt.checks.push("stable-private-profile");
  const privateAfter = await request(`/api/v1/content/read?uri=${encodeURIComponent(privateUri)}`, native.connection.apiKey);
  assert(JSON.stringify(privateAfter).includes("Synthetic private profile persistence"));
  receipt.checks.push("private-content-persistence", "ephemeral-config-cleanup");
  const after = await request(readPath, accounts[1]);
  assert(JSON.stringify(after).includes("Project alpha"));
  receipt.checks.push("restart-persistence");
  await request(`/api/v1/fs?uri=${encodeURIComponent(uri)}`, accounts[1], undefined, 200, "DELETE");
  await request(readPath, accounts[1], undefined, 404);
  const revokedSearch = await request("/api/v1/search/find", accounts[1], query);
  assert(!JSON.stringify(revokedSearch.result).includes("synthetic-sop"));
  receipt.checks.push("physical-resource-revocation");
  receipt.status = "PASS";
} catch (error) {
  receipt.status = "FAILED";
  // This probe uses only random synthetic keys; redact them nonetheless.
  receipt.error = [...redactions].reduce((message, key) => message.replaceAll(key, "[REDACTED]"), String(error));
  process.exitCode = 1;
} finally {
  await stop();
  await new Promise(resolve => model.close(resolve));
  receipt.embeddingCalls = embeddingCalls;
  await writeFile(join(root, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
}
