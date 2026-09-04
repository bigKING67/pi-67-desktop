import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { flattenCases, loadCorpus, renderDocument } from "./corpus.mjs";
import {
  assertArtifactSafe,
  summarizeAdaptiveReplays,
  summarizeProfile,
} from "./metrics.mjs";
import {
  accountExists,
  OpenVikingLabClient,
  OpenVikingPilotError,
  readRootKey,
} from "./openviking-lab.mjs";
import {
  decideAdaptiveRoute,
  normalizeContextEntries,
  normalizeFindEntries,
} from "./policy.mjs";
import { renderReport } from "./report.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const defaultEvidenceRoot = join(repositoryRoot, "artifacts/evidence/openviking-ab");
const actorPeer = "ab-workspace-current";
const corpusRoot = "viking://resources/pi67-ab-retrieval";

const options = parseArguments(process.argv.slice(2));
const { corpus, sha256: corpusSha256 } = loadCorpus();
const cases = flattenCases(corpus, corpusRoot);
const runId = createRunId();
const outputDirectory = options.outputDirectory
  ? resolve(options.outputDirectory)
  : join(defaultEvidenceRoot, runId);

if (options.dryRun) {
  const dryRun = {
    schema: "pi67.openviking-ab-dry-run.v1",
    runId,
    cases: cases.length,
    documents: corpus.documents.length,
    corpusSha256,
    officialUpstream: corpus.officialUpstream,
    configuration: corpus.controlledConfiguration,
  };
  assertArtifactSafe(dryRun);
  process.stdout.write(`${JSON.stringify(dryRun, null, 2)}\n`);
} else {
  await runLivePilot();
}

async function runLivePilot() {
  await mkdir(outputDirectory, { recursive: true });
  const startedAt = new Date().toISOString();
  const accountId = `pi67-ab-${compactDate()}-${randomUUID().slice(0, 8)}`;
  const rootKey = readRootKey(options.rootConfigPath);
  const rootClient = new OpenVikingLabClient({
    baseUrl: options.baseUrl,
    apiKey: rootKey,
    actorPeer,
  });
  const results = [];
  let accountCreated = false;
  let server = { version: "unknown", authMode: "unknown" };
  let failure = null;
  const cleanup = {
    accountId,
    accountCreated: false,
    accountDeleteAttempted: false,
    accountDeleted: false,
    accountAbsentAfterDelete: false,
  };

  try {
    process.stdout.write(`run=${runId} stage=health\n`);
    const health = await rootClient.health();
    if (health?.healthy !== true || health?.status !== "ok") {
      throw new Error("OpenViking laboratory health check did not pass.");
    }
    server = {
      version: String(health.version ?? "unknown"),
      authMode: String(health.auth_mode ?? "unknown"),
    };

    const before = await rootClient.listAccounts();
    if (accountExists(before, accountId)) {
      throw new Error("Synthetic OpenViking A/B Account unexpectedly already exists.");
    }
    const created = await rootClient.createAccount(accountId, "ab-admin");
    const userKey = String(created?.result?.user_key ?? "").trim();
    if (!userKey) throw new Error("Synthetic Account creation returned no user key.");
    accountCreated = true;
    cleanup.accountCreated = true;
    const userClient = rootClient.withUserKey(userKey);

    process.stdout.write(`run=${runId} stage=ingest documents=${corpus.documents.length}\n`);
    for (const [index, document] of corpus.documents.entries()) {
      await userClient.writeResource(
        `${corpusRoot}/${document.id}.md`,
        renderDocument(document),
      );
      if ((index + 1) % 3 === 0 || index + 1 === corpus.documents.length) {
        process.stdout.write(`run=${runId} stage=ingest progress=${index + 1}/${corpus.documents.length}\n`);
      }
    }
    await waitForCorpus(userClient, corpus.controlledConfiguration, cases[0]);

    process.stdout.write(`run=${runId} stage=retrieval cases=${cases.length}\n`);
    for (let repetition = 1; repetition <= options.repetitions; repetition += 1) {
      for (const [index, testCase] of cases.entries()) {
        results.push(noMemoryResult(testCase, repetition));
        const profiles = index % 2 === 0
          ? ["official-style", "pi67-adaptive"]
          : ["pi67-adaptive", "official-style"];
        for (const profile of profiles) {
          const result = await runProfile({
            profile,
            testCase,
            repetition,
            index,
            userClient,
            configuration: corpus.controlledConfiguration,
          });
          results.push(result);
          enforceFailureBudget(results, corpus.controlledConfiguration.failureBudget);
        }
        if ((index + 1) % 5 === 0 || index + 1 === cases.length) {
          process.stdout.write(
            `run=${runId} stage=retrieval repetition=${repetition}/${options.repetitions} progress=${index + 1}/${cases.length}\n`,
          );
        }
      }
    }
  } catch (error) {
    failure = safeFailure(error);
  } finally {
    if (accountCreated) {
      cleanup.accountDeleteAttempted = true;
      try {
        await rootClient.deleteAccount(accountId);
        cleanup.accountDeleted = true;
        const after = await rootClient.listAccounts();
        cleanup.accountAbsentAfterDelete = !accountExists(after, accountId);
      } catch (error) {
        cleanup.cleanupError = safeFailure(error);
      }
    }
  }

  const summaries = ["no-memory", "official-style", "pi67-adaptive"].map((profile) =>
    summarizeProfile(profile, results.filter((item) => item.profile === profile)));
  const adaptiveReplays = summarizeAdaptiveReplays(
    results.filter((item) => item.profile === "pi67-adaptive"),
    corpus.controlledConfiguration.scoreThreshold,
  );
  const complete = !failure
    && cleanup.accountDeleted
    && cleanup.accountAbsentAfterDelete
    && summaries.every((summary) => summary.failures === 0);
  const receipt = {
    schema: "pi67.openviking-ab-retrieval-receipt.v1",
    runId,
    status: complete ? "pass" : "failed",
    startedAt,
    completedAt: new Date().toISOString(),
    source: await sourceIdentity(),
    officialUpstream: corpus.officialUpstream,
    server,
    corpus: {
      sha256: corpusSha256,
      documents: corpus.documents.length,
      queries: cases.length,
    },
    configuration: corpus.controlledConfiguration,
    repetitions: options.repetitions,
    summaries,
    adaptiveReplays,
    cleanup,
    ...(failure ? { failure } : {}),
  };
  const resultArtifact = results.map((item) => JSON.stringify(item)).join("\n");
  assertArtifactSafe(receipt);
  assertArtifactSafe(results);
  await writeFile(join(outputDirectory, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(join(outputDirectory, "results.ndjson"), `${resultArtifact}${resultArtifact ? "\n" : ""}`);
  await writeFile(join(outputDirectory, "report.md"), renderReport(receipt));
  process.stdout.write(`run=${runId} status=${receipt.status} evidence=${outputDirectory}\n`);
  if (!complete) process.exitCode = 1;
}

async function runProfile({
  profile,
  testCase,
  repetition,
  index,
  userClient,
  configuration,
}) {
  const sessionId = `pi67-ab-${runId}-${profile}-${repetition}-${index + 1}`;
  const totalStarted = performance.now();
  let requestCount = 0;
  let failedStage = "unknown";
  let findLatencyMs;
  let findEntries;
  try {
    if (profile === "official-style") {
      failedStage = "session";
      await userClient.createSession(sessionId);
      const started = performance.now();
      requestCount = 1;
      failedStage = "context";
      const envelope = await userClient.contextSearch(testCase.query, sessionId, configuration);
      const latencyMs = elapsed(started);
      return resultFor(testCase, repetition, profile, "context-every-prompt", 1, latencyMs,
        normalizeContextEntries(envelope), { contextLatencyMs: latencyMs });
    }

    const started = performance.now();
    requestCount = 1;
    failedStage = "find";
    const findEnvelope = await userClient.find(testCase.query, configuration, corpusRoot);
    findLatencyMs = elapsed(started);
    findEntries = normalizeFindEntries(findEnvelope);
    const findTelemetry = telemetryForFind(findEntries, findLatencyMs);
    const route = decideAdaptiveRoute(
      findEntries.map((entry) => entry.score),
      configuration.scoreThreshold,
      true,
    );
    if (route === "find-fast") {
      return resultFor(testCase, repetition, profile, route, 1, findLatencyMs, findEntries,
        findTelemetry);
    }
    failedStage = "session";
    await userClient.createSession(sessionId);
    const contextStarted = performance.now();
    requestCount = 2;
    failedStage = "context";
    const contextEnvelope = await userClient.contextSearch(testCase.query, sessionId, configuration);
    const contextLatencyMs = elapsed(contextStarted);
    return resultFor(testCase, repetition, profile, route, 2, findLatencyMs + contextLatencyMs,
      normalizeContextEntries(contextEnvelope), { ...findTelemetry, contextLatencyMs });
  } catch (error) {
    return {
      profile,
      caseId: testCase.id,
      repetition,
      expectedUri: testCase.expectedUri,
      returnedUris: [],
      route: "failed",
      requestCount,
      latencyMs: elapsed(totalStarted),
      failedStage,
      ...(findEntries ? telemetryForFind(findEntries, findLatencyMs ?? 0) : {}),
      errorCode: safeFailure(error).code,
    };
  }
}

function resultFor(testCase, repetition, profile, route, requestCount, latencyMs, entries, telemetry = {}) {
  const known = new Set(cases.map((item) => item.expectedUri));
  const returnedUris = [...new Set(entries.map((entry) => entry.uri))]
    .filter((uri) => known.has(uri))
    .slice(0, corpus.controlledConfiguration.finalResultLimit);
  return {
    profile,
    caseId: testCase.id,
    repetition,
    expectedUri: testCase.expectedUri,
    returnedUris,
    route,
    requestCount,
    latencyMs,
    topScore: entries[0]?.score ?? 0,
    ...telemetry,
  };
}

function telemetryForFind(entries, latencyMs) {
  const known = new Set(cases.map((item) => item.expectedUri));
  const bounded = entries.slice(0, corpus.controlledConfiguration.findCandidateLimit);
  return {
    findLatencyMs: latencyMs,
    findReturnedUris: bounded.map((entry) => entry.uri).filter((uri) => known.has(uri)),
    findScores: bounded.map((entry) => entry.score),
  };
}

function noMemoryResult(testCase, repetition) {
  return {
    profile: "no-memory",
    caseId: testCase.id,
    repetition,
    expectedUri: testCase.expectedUri,
    returnedUris: [],
    route: "disabled",
    requestCount: 0,
    latencyMs: 0,
  };
}

function enforceFailureBudget(results, failureBudget) {
  const failures = results.filter((item) => item.errorCode).length;
  if (failures >= failureBudget) {
    throw new OpenVikingPilotError(
      "failure_budget_exceeded",
      0,
      "OpenViking retrieval pilot stopped at its bounded failure budget.",
    );
  }
}

async function waitForCorpus(client, configuration, readinessCase) {
  const deadline = Date.now() + 90000;
  const readinessConfiguration = { ...configuration, scoreThreshold: 0 };
  while (Date.now() < deadline) {
    const envelope = await client.find(
      readinessCase.query,
      readinessConfiguration,
      corpusRoot,
    );
    if (normalizeFindEntries(envelope).some((entry) => entry.uri === readinessCase.expectedUri)) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  }
  throw new Error("Synthetic corpus did not become searchable within the readiness budget.");
}

async function sourceIdentity() {
  const files = [
    "corpus.json",
    "corpus.mjs",
    "metrics.mjs",
    "openviking-lab.mjs",
    "policy.mjs",
    "report.mjs",
    "run-retrieval-pilot.mjs",
  ];
  const hash = createHash("sha256");
  for (const file of files) hash.update(await readFile(new URL(file, import.meta.url)));
  return {
    gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim(),
    workingTreeDirty: execFileSync("git", ["status", "--porcelain"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim().length > 0,
    runnerSha256: hash.digest("hex"),
  };
}

function parseArguments(argumentsList) {
  const parsed = {
    baseUrl: "http://127.0.0.1:1933",
    dryRun: false,
    outputDirectory: "",
    repetitions: 1,
    rootConfigPath: "",
  };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--") continue;
    if (argument === "--dry-run") parsed.dryRun = true;
    else if (argument === "--base-url") parsed.baseUrl = requireValue(argumentsList, ++index, argument);
    else if (argument === "--output-dir") parsed.outputDirectory = requireValue(argumentsList, ++index, argument);
    else if (argument === "--root-config") parsed.rootConfigPath = requireValue(argumentsList, ++index, argument);
    else if (argument === "--repetitions") {
      parsed.repetitions = Number(requireValue(argumentsList, ++index, argument));
    } else {
      throw new Error(`Unknown OpenViking A/B argument: ${argument}`);
    }
  }
  if (!Number.isInteger(parsed.repetitions) || parsed.repetitions < 1 || parsed.repetitions > 10) {
    throw new Error("--repetitions must be an integer from 1 through 10.");
  }
  if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(parsed.baseUrl)) {
    throw new Error("The retrieval pilot only accepts a loopback OpenViking URL.");
  }
  return parsed;
}

function requireValue(argumentsList, index, option) {
  const value = argumentsList[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

function safeFailure(error) {
  if (error instanceof OpenVikingPilotError) {
    return { code: error.code, status: error.status };
  }
  return { code: "pilot_failure", status: 0 };
}

function elapsed(started) {
  return Math.max(0, Math.round(performance.now() - started));
}

function createRunId() {
  return `${compactDate()}-${randomUUID()}`;
}

function compactDate() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
