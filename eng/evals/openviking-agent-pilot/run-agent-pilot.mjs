import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectAgentPilotAssembly, runAgentScenario } from "./agent-runtime.mjs";
import { assertArtifactSafe } from "./artifact-safety.mjs";
import { agentRunCount, loadAgentPilotCorpus } from "./corpus.mjs";
import { smokeGate, summarizeAgentResults } from "./metrics.mjs";
import { OpenVikingLabClient, accountExists } from "../openviking-ab/openviking-lab.mjs";
import { readPilotCredentials } from "./provider-config.mjs";
import { renderAgentPilotReport } from "./report.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const evidenceRoot = join(repositoryRoot, "artifacts/evidence/openviking-agent-pilot");
const corpusRoot = "viking://resources/pi67-agent-pilot";
const userId = "agent-pilot-user";
const peerId = "agent-pilot-workspace";
const options = parseArguments(process.argv.slice(2));
const startedAt = new Date().toISOString();
const runId = createRunId(options.mode);
const corpus = loadAgentPilotCorpus(runId);
const credentials = readPilotCredentials(options.rootConfigPath);
const outputDirectory = options.outputDirectory ? resolve(options.outputDirectory) : join(evidenceRoot, runId);

if (options.mode === "preflight") await runPreflight();
else await runLive();

async function runPreflight() {
  const client = new OpenVikingLabClient({
    baseUrl: options.baseUrl,
    apiKey: credentials.secret.rootKey,
    actorPeer: peerId,
  });
  const health = await client.health();
  if (health?.healthy !== true || health?.status !== "ok") throw new Error("OpenViking laboratory preflight failed.");
  const planned = agentRunCount(corpus);
  const isolationRoot = await mkdtemp(join(tmpdir(), "pi67-openviking-agent-preflight-"));
  let runtimeAssembly;
  try {
    runtimeAssembly = await inspectAgentPilotAssembly({
      isolationRoot,
      provider: credentials.public,
      limits: corpus.scenarios.limits,
      openVikingBaseUrl: options.baseUrl,
    });
  } finally {
    await rm(isolationRoot, { recursive: true, force: true });
  }
  if (!runtimeAssembly.extensionLoaded || !runtimeAssembly.modelLoaded) {
    throw pilotError("runtime_assembly_preflight_failed");
  }
  const result = {
    schema: "pi67.openviking-agent-pilot-preflight.v1",
    status: "pass",
    mode: options.mode,
    runId,
    plannedAgentRuns: planned,
    smokeAgentRuns: 3,
    provider: credentials.public,
    server: { version: String(health.version ?? "unknown"), healthy: true },
    runtimeAssembly,
    corpusSha256: corpus.sha256,
    billableProviderRequests: 0,
  };
  assertArtifactSafe(result, credentials.secret);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function runLive() {
  if (options.mode === "full" && options.confirmAgentRuns !== corpus.scenarios.limits.fullAgentRuns) {
    throw new Error(`Full mode requires --confirm-agent-runs=${corpus.scenarios.limits.fullAgentRuns}.`);
  }
  await mkdir(outputDirectory, { recursive: true });
  const isolationRoot = await mkdtemp(join(tmpdir(), "pi67-openviking-agent-pilot-"));
  const accountId = `pi67-agent-pilot-${compactDate()}-${randomUUID().slice(0, 8)}`;
  const rootClient = new OpenVikingLabClient({
    baseUrl: options.baseUrl,
    apiKey: credentials.secret.rootKey,
    actorPeer: peerId,
  });
  const results = [];
  let userKey = "";
  let server = { version: "unknown", authMode: "unknown" };
  let failure;
  const cleanup = {
    accountId,
    accountCreated: false,
    accountDeleteAttempted: false,
    accountDeleted: false,
    accountAbsentAfterDelete: false,
    isolationRootDeleted: false,
  };

  try {
    process.stdout.write(`run=${runId} stage=health mode=${options.mode}\n`);
    const health = await rootClient.health();
    if (health?.healthy !== true || health?.status !== "ok") throw pilotError("openviking_health_failed");
    server = { version: String(health.version ?? "unknown"), authMode: String(health.auth_mode ?? "unknown") };
    if (accountExists(await rootClient.listAccounts(), accountId)) throw pilotError("synthetic_account_collision");
    const created = await rootClient.createAccount(accountId, userId);
    userKey = String(created?.result?.user_key ?? "").trim();
    if (!userKey) throw pilotError("synthetic_user_key_missing");
    cleanup.accountCreated = true;
    const userClient = rootClient.withUserKey(userKey);

    process.stdout.write(`run=${runId} stage=ingest documents=${corpus.documents.length}\n`);
    for (const [index, document] of corpus.documents.entries()) {
      await userClient.queueResource(`${corpusRoot}/${document.id}.md`, document.content);
      if ((index + 1) % 4 === 0 || index + 1 === corpus.documents.length) {
        process.stdout.write(`run=${runId} stage=ingest progress=${index + 1}/${corpus.documents.length}\n`);
      }
    }
    await waitForCorpus(userClient);

    const matrix = buildMatrix(corpus, options.mode);
    process.stdout.write(`run=${runId} stage=agent planned=${matrix.length}\n`);
    for (const item of matrix) {
      const result = await runAgentScenario({
        ...item,
        isolationRoot,
        evidenceCodes: corpus.evidenceCodes,
        limits: corpus.scenarios.limits,
        provider: credentials,
        openViking: { baseUrl: options.baseUrl, userKey, accountId, userId, peerId },
      });
      results.push(result);
      const outcome = `${result.successfulTurns}/${result.totalTurns}`;
      process.stdout.write(`run=${runId} stage=agent progress=${results.length}/${matrix.length} profile=${result.profile} scenario=${result.scenarioId} outcome=${outcome} provider_requests=${result.providerRequests}\n`);
      enforceRunSafety(results, corpus.scenarios.limits.failureBudget);
    }
    if (options.mode === "smoke") {
      const gate = smokeGate(results);
      if (!gate.pass) throw pilotError("smoke_gate_failed");
    }
  } catch (error) {
    failure = { code: safeErrorCode(error) };
  } finally {
    if (cleanup.accountCreated) {
      cleanup.accountDeleteAttempted = true;
      try {
        await rootClient.deleteAccount(accountId);
        cleanup.accountDeleted = true;
        cleanup.accountAbsentAfterDelete = !accountExists(await rootClient.listAccounts(), accountId);
      } catch {
        cleanup.cleanupErrorCode = "synthetic_account_cleanup_failed";
      }
    }
    await rm(isolationRoot, { recursive: true, force: true });
    cleanup.isolationRootDeleted = true;
  }

  const summaries = summarizeAgentResults(results);
  const gate = options.mode === "smoke" ? smokeGate(results) : undefined;
  const credentialLiteralMatches = results.reduce((sum, item) => sum + item.credentialLiteralMatches, 0);
  const complete = !failure
    && cleanup.accountDeleted
    && cleanup.accountAbsentAfterDelete
    && cleanup.isolationRootDeleted
    && credentialLiteralMatches === 0
    && results.every((item) => item.status === "pass")
    && (gate?.pass ?? true);
  const receipt = {
    schema: "pi67.openviking-agent-pilot-receipt.v1",
    runId,
    mode: options.mode,
    status: complete ? "pass" : "failed",
    startedAt,
    completedAt: new Date().toISOString(),
    source: await sourceIdentity(),
    corpus: {
      sha256: corpus.sha256,
      documents: corpus.documents.length,
      scenarios: options.mode === "smoke" ? 1 : corpus.scenarios.scenarios.length,
    },
    provider: credentials.public,
    server,
    configuration: {
      profiles: corpus.scenarios.profiles,
      limits: corpus.scenarios.limits,
      syntheticResourceRoot: corpusRoot,
    },
    execution: {
      plannedAgentRuns: buildMatrix(corpus, options.mode).length,
      completedAgentRuns: results.length,
      failedAgentRuns: results.filter((item) => item.status !== "pass").length,
      providerRequests: results.reduce((sum, item) => sum + item.providerRequests, 0),
      providerCost: results.reduce((sum, item) => sum + item.usage.cost, 0),
      credentialLiteralMatches,
    },
    summaries,
    ...(gate ? { smokeGate: gate } : {}),
    cleanup,
    ...(failure ? { failure } : {}),
  };
  assertArtifactSafe(receipt, { ...credentials.secret, userKey });
  assertArtifactSafe(results, { ...credentials.secret, userKey });
  const resultsContent = results.map((item) => JSON.stringify(item)).join("\n");
  await writeFile(join(outputDirectory, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await writeFile(join(outputDirectory, "results.ndjson"), `${resultsContent}${resultsContent ? "\n" : ""}`, "utf8");
  await writeFile(join(outputDirectory, "report.md"), renderAgentPilotReport(receipt), "utf8");
  process.stdout.write(`run=${runId} status=${receipt.status} evidence=${outputDirectory}\n`);
  if (!complete) process.exitCode = 1;
}

function buildMatrix(value, mode) {
  const scenarios = mode === "smoke"
    ? value.scenarios.scenarios.filter((item) => item.id === "material-task-switch")
    : value.scenarios.scenarios;
  const repetitions = mode === "smoke" ? 1 : value.scenarios.repetitions;
  const rows = [];
  let sequence = 0;
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    for (const [scenarioIndex, scenario] of scenarios.entries()) {
      const offset = (repetition + scenarioIndex - 1) % value.scenarios.profiles.length;
      const profiles = [...value.scenarios.profiles.slice(offset), ...value.scenarios.profiles.slice(0, offset)];
      for (const profile of profiles) {
        sequence += 1;
        rows.push({ profile, scenario, repetition, sequence });
      }
    }
  }
  return rows;
}

async function waitForCorpus(client) {
  const retrievalById = new Map(corpus.retrieval.documents.map((document) => [document.id, document]));
  const pending = new Map(corpus.documents.map((document) => [
    document.id,
    {
      query: retrievalById.get(document.id)?.queries[0],
      expectedUri: `${corpusRoot}/${document.id}.md`,
    },
  ]));
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    for (const [id, readiness] of pending) {
      if (!readiness.query) throw pilotError("corpus_readiness_query_missing");
      const envelope = await client.find(readiness.query, {
        findCandidateLimit: 8,
        scoreThreshold: 0,
        findTimeoutMs: 5000,
      }, corpusRoot);
      const resources = Array.isArray(envelope?.result?.resources) ? envelope.result.resources : [];
      if (resources.some((item) => item?.uri === readiness.expectedUri)) pending.delete(id);
    }
    if (pending.size === 0) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  }
  throw pilotError("corpus_readiness_timeout");
}

function enforceRunSafety(results, failureBudget) {
  if (results.at(-1)?.credentialLiteralMatches > 0) throw pilotError("credential_literal_persisted");
  if (results.filter((item) => item.status !== "pass").length >= failureBudget) {
    throw pilotError("failure_budget_exceeded");
  }
}

async function sourceIdentity() {
  const files = [
    "agent-runtime.mjs",
    "artifact-safety.mjs",
    "corpus.mjs",
    "evaluation-extension.mjs",
    "metrics.mjs",
    "openviking-agent-pilot.test.mjs",
    "package.json",
    "provider-config.mjs",
    "report.mjs",
    "run-agent-pilot.mjs",
    "scenarios.json",
    "../openviking-ab/openviking-lab.mjs",
  ];
  const hash = createHash("sha256");
  for (const file of files) hash.update(await readFile(new URL(file, import.meta.url)));
  return {
    gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim(),
    workingTreeDirty: execFileSync("git", ["status", "--porcelain"], { cwd: repositoryRoot, encoding: "utf8" }).trim().length > 0,
    runnerSha256: hash.digest("hex"),
  };
}

function parseArguments(argumentsList) {
  const parsed = {
    mode: "preflight",
    baseUrl: "http://127.0.0.1:1933",
    rootConfigPath: "",
    outputDirectory: "",
    confirmAgentRuns: 0,
  };
  for (const argument of argumentsList) {
    if (argument.startsWith("--mode=")) parsed.mode = argument.slice("--mode=".length);
    else if (argument.startsWith("--base-url=")) parsed.baseUrl = argument.slice("--base-url=".length);
    else if (argument.startsWith("--root-config=")) parsed.rootConfigPath = argument.slice("--root-config=".length);
    else if (argument.startsWith("--output=")) parsed.outputDirectory = argument.slice("--output=".length);
    else if (argument.startsWith("--confirm-agent-runs=")) parsed.confirmAgentRuns = Number(argument.slice("--confirm-agent-runs=".length));
    else throw new Error(`Unknown Agent pilot argument: ${argument}`);
  }
  if (!["preflight", "smoke", "full"].includes(parsed.mode)) throw new Error(`Unsupported Agent pilot mode: ${parsed.mode}`);
  const url = new URL(parsed.baseUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
    throw new Error("The local Agent pilot only accepts a loopback OpenViking endpoint.");
  }
  return parsed;
}

function createRunId(mode) {
  return `${mode}-${new Date().toISOString().replaceAll(/[-:.]/gu, "").replace("Z", "Z")}-${randomUUID()}`;
}

function compactDate() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function pilotError(code) {
  return Object.assign(new Error(code), { code });
}

function safeErrorCode(error) {
  const code = typeof error?.code === "string" ? error.code : error?.name;
  return /^[a-z0-9._-]{1,100}$/iu.test(code ?? "") ? code : "agent_pilot_failed";
}
