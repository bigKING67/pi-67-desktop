import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { assertArtifactSafe } from "../openviking-ab/metrics.mjs";
import { flattenCases, loadCorpus, memoryUri, otherPeerPrefix } from "./corpus.mjs";
import { assertNoSecretLiterals, buildSummary, scoreCase } from "./metrics.mjs";
import { renderReport } from "./report.mjs";
import { readCredentials, resolvePython, startDisposableServer } from "./server.mjs";

const evalDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(evalDirectory, "../../..");
const extensionDirectory = join(repositoryRoot, "packages/openviking-pi-extension");
/** Product Extension configuration fields a variant may override; each maps to shipped config.json. */
const VARIANT_FIELDS = new Set(["scoreThreshold", "recallLimit", "experienceRecallLimit", "sharedExperienceLimit", "recallTokenBudget"]);
const options = parseArguments(process.argv.slice(2));
const { corpus, sha256: corpusSha256 } = loadCorpus();
const cases = flattenCases(corpus);
const arms = [
  "product",
  ...(options.withExpansion ? ["product-expansion"] : []),
  ...options.variants.map((variant) => variant.name),
  ...(options.skipCeiling ? [] : ["find-ceiling"]),
];

if (options.dryRun) {
  const counts = {};
  for (const item of cases) counts[`${item.split}:${item.type}`] = (counts[`${item.split}:${item.type}`] ?? 0) + 1;
  process.stdout.write(`${JSON.stringify({
    schema: "pi67.openviking-recall-baseline-dry-run.v1", corpusSha256,
    memories: corpus.memories.length, cases: cases.length, arms, repetitions: options.repetitions,
    train: cases.filter((item) => item.split === "train").length,
    test: cases.filter((item) => item.split === "test").length, counts,
    productRequestTemplate: (await productRecall(false)).template,
  }, null, 2)}\n`);
} else {
  await runLive();
}

async function runLive() {
  const credentials = readCredentials(options.credentialsPath, { withExpansion: options.withExpansion });
  const secrets = [credentials.secret.embeddingKey, credentials.secret.vlmKey];
  const python = resolvePython(options.pythonPath);
  const runId = `${new Date().toISOString().replace(/[-:.]/gu, "").slice(0, 15)}Z-${randomUUID().slice(0, 8)}`;
  const output = options.outputDirectory ? resolve(options.outputDirectory) : join(repositoryRoot, "artifacts/evidence/openviking-recall-baseline", runId);
  const startedAt = new Date().toISOString();
  const server = await startDisposableServer({ python, credentials, withExpansion: options.withExpansion });
  const scratch = mkdtempSync(join(tmpdir(), "pi67-ov-baseline-state-"));
  let cleanup = null;
  const results = [];
  try {
    const client = createClient(server.endpoint, corpus.identity);
    await seedMemories(client);
    const recalls = {
      product: await productRecall(false),
      ...(options.withExpansion ? { "product-expansion": await productRecall(true) } : {}),
    };
    for (const variant of options.variants) recalls[variant.name] = await productRecall(false, variant.overrides);
    const otherPrefix = otherPeerPrefix(corpus);
    let failures = 0;
    for (let repetition = 1; repetition <= options.repetitions; repetition += 1) {
      for (const arm of arms) {
        if (arm === "find-ceiling" && repetition > 1) continue;
        for (const item of cases) {
          const result = await runCase(client, arm, recalls[arm], item, repetition, scratch);
          result.score = scoreCase(item, result.returnedUris, otherPrefix);
          results.push(result);
          if (result.errorCode && ++failures > options.failureBudget) throw new Error(`Failure budget exceeded (${failures}).`);
        }
        process.stderr.write(`repetition ${repetition} arm ${arm}: ${cases.length} cases\n`);
      }
    }
  } finally {
    cleanup = await server.stop();
    rmSync(scratch, { recursive: true, force: true });
  }

  const summary = buildSummary(results);
  const receipt = {
    schema: "pi67.openviking-recall-baseline-receipt.v1",
    runId, startedAt, finishedAt: new Date().toISOString(),
    source: { gitHead: git(["rev-parse", "HEAD"]), dirty: git(["status", "--porcelain"]) !== "", runnerSha256: hashSources() },
    corpus: { sha256: corpusSha256, memories: corpus.memories.length, cases: cases.length, splitSeed: corpus.splitSeed },
    server: { version: server.version, runtime: relative(repositoryRoot, python), mode: "dev-loopback-disposable" },
    embedding: { host: new URL(credentials.public.embedding.apiBase).host, model: credentials.public.embedding.model, dimension: credentials.public.embedding.dimension },
    vlm: credentials.public.vlm ? { host: new URL(credentials.public.vlm.apiBase).host, model: credentials.public.vlm.model } : null,
    arms, repetitions: options.repetitions, productRequestTemplate: (await productRecall(false)).template,
    variants: await Promise.all(options.variants.map(async (variant) => ({
      ...variant, requestTemplate: (await productRecall(false, variant.overrides)).template,
    }))),
    cleanup, summary,
  };
  const artifacts = {
    "results.ndjson": `${results.map((result) => JSON.stringify(result)).join("\n")}\n`,
    "receipt.json": `${JSON.stringify(receipt, null, 2)}\n`,
    "report.md": renderReport(receipt),
  };
  for (const content of Object.values(artifacts)) {
    assertArtifactSafe(content);
    assertNoSecretLiterals(content, secrets);
  }
  await mkdir(output, { recursive: true, mode: 0o700 });
  for (const [name, content] of Object.entries(artifacts)) await writeFile(join(output, name), content, { mode: 0o600 });
  process.stdout.write(`${artifacts["report.md"]}\nEvidence: ${relative(repositoryRoot, output)}\n`);
  if (!cleanup.dataRootRemoved || !cleanup.processExited) process.exitCode = 1;
}

/**
 * Loads the shipped Extension configuration through the product loader with an
 * isolated HOME and no OpenViking/Pi environment, so no user config or
 * credential file can be read. The request is then built by the product core.
 */
async function productRecall(withExpansion, overrides = {}) {
  const isolatedHome = mkdtempSync(join(tmpdir(), "pi67-ov-baseline-home-"));
  const saved = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) if (/^(OPENVIKING|OV_|PI_)/u.test(key)) delete process.env[key];
    process.env.HOME = isolatedHome;
    const { loadConfig } = await import(join(extensionDirectory, "config.ts"));
    const core = await import(join(extensionDirectory, "shared/recall-core.mjs"));
    const config = { ...loadConfig(extensionDirectory), ...overrides };
    if ("recallLimit" in overrides) config.recallLimitConfigured = true;
    const cfg = {
      ...config,
      peerId: corpus.identity.actorPeer,
      recallMaxTokens: config.recallTokenBudget,
      recallMaxTokensConfigured: true,
      ...(withExpansion ? {} : { recallQueryExpansion: "off" }),
    };
    const template = core.buildContextSearchBody(cfg, { sessionId: "<session>" });
    delete template.query;
    return { cfg, core, template };
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    rmSync(isolatedHome, { recursive: true, force: true });
  }
}

async function runCase(client, arm, recall, item, repetition, scratch) {
  const base = { arm, repetition, caseId: item.id, split: item.split, type: item.type,
    expectedCount: item.expectedUris.length, forbiddenCount: item.forbiddenUris.length };
  try {
    if (arm === "find-ceiling") {
      const started = performance.now();
      const returned = await findCeiling(client, item.query);
      return { ...base, returnedUris: returned.map((entry) => entry.uri), scores: returned.map((entry) => round(entry.score)),
        usedTokens: 0, latencyMs: Math.round(performance.now() - started) };
    }
    const sessionId = `b${repetition}-${arm}-${item.id}`.replace(/[^a-z0-9-]/giu, "-");
    await client.request("/api/v1/sessions", { method: "POST", body: { session_id: sessionId, auto_commit_policy: null } }, corpus.identity.actorPeer);
    for (const turn of item.history) {
      await client.request(`/api/v1/sessions/${sessionId}/messages`, { method: "POST", body: { role: turn.role, content: turn.content } }, corpus.identity.actorPeer);
    }
    const started = performance.now();
    const assembled = await recall.core.fetchAssembledContext(client.fetchJSON, recall.cfg, item.query, {
      actorPeerId: recall.cfg.peerId, sessionId, legacyCachePath: join(scratch, "context-face.json"),
    });
    const latencyMs = Math.round(performance.now() - started);
    if (assembled === null) return { ...base, returnedUris: [], scores: [], usedTokens: 0, latencyMs, errorCode: "context_face_unavailable" };
    const entries = assembled.entries.map(recall.core.normalizeContextEntry);
    return {
      ...base,
      returnedUris: entries.map((entry) => entry.uri),
      scores: entries.map((entry) => round(entry.score)),
      categories: entries.map((entry) => entry.category),
      usedTokens: Number(assembled.stats?.used_tokens ?? 0),
      expandedQueries: Array.isArray(assembled.stats?.planned_queries) ? assembled.stats.planned_queries.length : null,
      latencyMs,
    };
  } catch (error) {
    return { ...base, returnedUris: [], scores: [], usedTokens: 0, latencyMs: 0, errorCode: safeCode(error) };
  }
}

/** Diagnostic upper bound: raw vector ranking over the actor-visible memory roots, no quotas or threshold. */
async function findCeiling(client, query) {
  const { user, actorPeer } = corpus.identity;
  const roots = [`viking://user/${user}/memories`, `viking://user/${user}/peers/${actorPeer}/memories`];
  const responses = await Promise.all(roots.map((target_uri) => client.request("/api/v1/search/find",
    { method: "POST", body: { query, target_uri, limit: 10, score_threshold: 0 } }, actorPeer).catch(() => null)));
  return responses.flatMap((result) => ["memories", "resources", "skills"].flatMap((bucket) => result?.[bucket] ?? []))
    .filter((entry) => typeof entry?.uri === "string" && entry.uri.endsWith(".md"))
    .map((entry) => ({ uri: entry.uri, score: Number(entry.score) || 0 }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);
}

async function seedMemories(client) {
  for (const memory of corpus.memories) {
    const peer = memory.scope === "actor" ? corpus.identity.actorPeer : memory.scope === "other" ? corpus.identity.otherPeer : "";
    await client.request("/api/v1/content/write", {
      method: "POST", body: { uri: memoryUri(corpus, memory), content: memory.body, mode: "create", wait: true, timeout: 120 },
    }, peer, 150_000);
  }
  // Readiness: every memory must be findable by its own text before any case runs.
  const deadline = Date.now() + 120_000;
  for (const memory of corpus.memories) {
    const uri = memoryUri(corpus, memory);
    const peer = memory.scope === "user" ? "" : memory.scope === "actor" ? corpus.identity.actorPeer : corpus.identity.otherPeer;
    for (;;) {
      const result = await client.request("/api/v1/search/find", {
        method: "POST", body: { query: memory.body.slice(0, 120), target_uri: uri.slice(0, uri.lastIndexOf("/")), limit: 10, score_threshold: 0 },
      }, peer).catch(() => null);
      if ((result?.memories ?? []).some((entry) => entry?.uri === uri)) break;
      if (Date.now() > deadline) throw new Error(`Memory ${memory.id} was not indexed in time.`);
      await new Promise((settle) => setTimeout(settle, 500));
    }
  }
}

function createClient(endpoint, identity) {
  const headersFor = (actorPeerId) => ({
    "content-type": "application/json",
    "X-OpenViking-Account": identity.account,
    "X-OpenViking-User": identity.user,
    ...(actorPeerId ? { "X-OpenViking-Actor-Peer": actorPeerId } : {}),
  });
  async function send(path, init, actorPeerId, timeoutMs) {
    const response = await fetch(`${endpoint}${path}`, {
      ...init, redirect: "error", headers: { ...headersFor(actorPeerId), ...init?.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  }
  return {
    /** recall-core compatible transport: never throws, mirrors the product client envelope. */
    async fetchJSON(path, init, fetchOptions = {}) {
      try {
        const { response, body } = await send(path, init, fetchOptions.actorPeerId, fetchOptions.timeoutMs ?? 20_000);
        if (!response.ok || body.status === "error") return { ok: false, status: response.status, result: null, error: body.error ?? {} };
        return { ok: true, status: response.status, result: body.result ?? body };
      } catch {
        return { ok: false, status: 0, result: null, error: { message: "request failed" } };
      }
    },
    async request(path, { method, body }, actorPeerId = "", timeoutMs = 30_000) {
      const { response, body: envelope } = await send(path, { method, body: JSON.stringify(body) }, actorPeerId, timeoutMs);
      if (!response.ok || envelope.status === "error") {
        const code = String(envelope?.error?.code ?? `http_${response.status}`);
        throw Object.assign(new Error(`OpenViking ${path} failed (${/^[A-Za-z0-9_-]{1,80}$/u.test(code) ? code : response.status}).`), { code });
      }
      return envelope.result ?? envelope;
    },
  };
}

function hashSources() {
  const hash = createHash("sha256");
  for (const name of readdirSync(evalDirectory).filter((file) => /\.(mjs|json)$/u.test(file)).sort()) {
    hash.update(name).update("\0").update(readFileSync(join(evalDirectory, name))).update("\0");
  }
  for (const file of ["config.json", "config.ts", "shared/recall-core.mjs"]) {
    hash.update(file).update("\0").update(readFileSync(join(extensionDirectory, file))).update("\0");
  }
  return hash.digest("hex");
}

function git(args) {
  try { return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim(); } catch { return "unknown"; }
}

function safeCode(error) {
  const code = String(error?.code ?? error?.name ?? "error");
  return /^[A-Za-z0-9_-]{1,80}$/u.test(code) ? code : "error";
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function parseArguments(argv) {
  const parsed = { credentialsPath: "", pythonPath: "", outputDirectory: "", repetitions: 3, withExpansion: false, dryRun: false, failureBudget: 5, variants: [], skipCeiling: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next) throw new Error(`${argument} requires a value.`);
      return next;
    };
    if (argument === "--credentials") parsed.credentialsPath = value();
    else if (argument === "--python") parsed.pythonPath = value();
    else if (argument === "--output") parsed.outputDirectory = value();
    else if (argument === "--repetitions") parsed.repetitions = Math.max(1, Math.min(10, Number.parseInt(value(), 10) || 3));
    else if (argument === "--with-expansion") parsed.withExpansion = true;
    else if (argument === "--dry-run") parsed.dryRun = true;
    else if (argument === "--skip-ceiling") parsed.skipCeiling = true;
    else if (argument === "--variant") parsed.variants.push(parseVariant(value(), parsed.variants));
    else if (argument === "--") continue;
    else throw new Error(`Unknown argument ${argument}.`);
  }
  return parsed;
}

/** `name={"scoreThreshold":0.5}`: a named override of shipped Extension configuration fields. */
function parseVariant(text, existing) {
  const separator = text.indexOf("=");
  const name = text.slice(0, separator);
  if (separator < 1 || !/^[a-z0-9][a-z0-9.-]{0,47}$/u.test(name) || ["product", "product-expansion", "find-ceiling"].includes(name)
    || existing.some((variant) => variant.name === name)) throw new Error(`Invalid or duplicate variant name in ${text}.`);
  const overrides = JSON.parse(text.slice(separator + 1));
  for (const [key, value] of Object.entries(overrides)) {
    if (!VARIANT_FIELDS.has(key) || typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Unsupported override ${key} in ${name}.`);
  }
  return { name, overrides };
}
