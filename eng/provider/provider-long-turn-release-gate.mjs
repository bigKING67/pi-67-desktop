import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  readHashedWindowsSignedCandidateIdentity,
  WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY
} from "../release/windows-signed-candidate-contract.mjs";
import { createRealProviderCandidateEvidence } from "./real-provider-candidate-contract.mjs";
import { REAL_PROVIDER_LONG_TURN_LIMITATIONS } from "./real-provider-long-turn-contract.mjs";

const GATE_SCHEMA = "pi67.provider-long-turn-release-gate.v1";
const SUMMARY_SCHEMA = "pi67.real-provider-long-turn.v2";
const MAX_SUMMARY_BYTES = 128 * 1024;

export async function verifyProviderLongTurnReleaseGate({
  candidateIdentityPath,
  expectedModelId,
  expectedProviderId,
  expectedRepository,
  expectedRunAttempt,
  expectedRunId,
  expectedSignerThumbprint,
  expectedSourceCommit,
  expectedSourceTag,
  expectedThinkingLevel,
  outputPath,
  summaryPath
}) {
  const candidate = await readHashedWindowsSignedCandidateIdentity(candidateIdentityPath, {
    expectedSignerThumbprint,
    repository: expectedRepository,
    runAttempt: expectedRunAttempt,
    runId: expectedRunId,
    sourceCommit: expectedSourceCommit,
    sourcePolicy: WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY.stable,
    sourceTag: expectedSourceTag
  });
  const summarySource = await readBoundedSummary(summaryPath);
  const summary = parseSummary(summarySource);
  const expectedCandidate = createRealProviderCandidateEvidence({
    appVersion: candidate.identity.application.version,
    candidateIdentity: candidate.identity,
    candidateIdentitySha256: candidate.identitySha256,
    candidateSourcePolicy: WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY.stable,
    executableSha256: candidate.identity.packagedExecutable.sha256,
    sourceCommit: expectedSourceCommit,
    sourceTag: expectedSourceTag
  });
  assertProviderSummary(summary, {
    candidate: expectedCandidate,
    modelId: expectedModelId,
    providerId: expectedProviderId,
    thinkingLevel: expectedThinkingLevel
  });
  const gate = {
    schema: GATE_SCHEMA,
    status: "passed",
    repository: candidate.identity.repository,
    source: candidate.identity.source,
    workflow: candidate.identity.workflow,
    candidate: {
      identitySha256: candidate.identitySha256,
      installerSha256: candidate.identity.installer.sha256,
      packagedExecutableSha256: candidate.identity.packagedExecutable.sha256,
      signerThumbprint: candidate.identity.installer.authenticode.signerThumbprint
    },
    provider: summary.provider,
    operation: summary.operation,
    controlledTool: summary.controlledTool,
    session: summary.session,
    evidence: {
      summarySha256: createHash("sha256").update(summarySource).digest("hex")
    }
  };
  if (outputPath !== undefined) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(gate, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
  }
  return gate;
}

export function assertProviderSummary(summary, expected) {
  requireExactKeys(summary, [
    "application",
    "candidate",
    "completionMarkerObserved",
    "controlledTool",
    "generatedAt",
    "host",
    "limitations",
    "operation",
    "privacy",
    "provider",
    "schema",
    "session",
    "source",
    "status",
    "transport"
  ], "summary");
  if (summary.schema !== SUMMARY_SCHEMA || summary.status !== "passed") {
    throw new Error("Provider release summary identity is invalid.");
  }
  if (typeof summary.generatedAt !== "string" || !Number.isFinite(Date.parse(summary.generatedAt))) {
    throw new Error("Provider release summary timestamp is invalid.");
  }
  requireExactKeys(summary.application, [
    "architecture",
    "executableSha256",
    "packaged",
    "platform",
    "rendererUrl",
    "version"
  ], "application");
  if (summary.application.version !== expected.candidate.application.version
    || summary.application.platform !== "win32"
    || summary.application.architecture !== "x64"
    || summary.application.packaged !== true
    || summary.application.rendererUrl !== "app://pi67/index.html"
    || summary.application.executableSha256 !== expected.candidate.packagedExecutable.sha256) {
    throw new Error("Provider release summary application identity is invalid.");
  }
  if (!isDeepStrictEqual(summary.candidate, expected.candidate)
    || !isDeepStrictEqual(summary.source, expected.candidate.source)) {
    throw new Error("Provider release summary does not match the signed candidate identity.");
  }
  requireExactKeys(summary.provider, [
    "effectiveThinkingLevel",
    "id",
    "modelId",
    "requestedThinkingLevel"
  ], "provider");
  if (summary.provider.id !== expected.providerId
    || summary.provider.modelId !== expected.modelId
    || summary.provider.requestedThinkingLevel !== expected.thinkingLevel
    || summary.provider.effectiveThinkingLevel !== expected.thinkingLevel) {
    throw new Error("Provider release summary model authority is invalid.");
  }
  requireExactKeys(summary.host, ["epoch", "pid"], "host");
  if (!Number.isSafeInteger(summary.host.pid) || summary.host.pid < 1
    || !Number.isSafeInteger(summary.host.epoch) || summary.host.epoch < 0) {
    throw new Error("Provider release summary Host identity is invalid.");
  }
  requireExactKeys(summary.transport, [
    "acceptedBudgetMs",
    "acceptedLatencyMs",
    "acknowledgementTimedOut"
  ], "transport");
  if (summary.transport.acceptedBudgetMs !== 5_000
    || !isFiniteNonnegative(summary.transport.acceptedLatencyMs)
    || summary.transport.acceptedLatencyMs > summary.transport.acceptedBudgetMs
    || summary.transport.acknowledgementTimedOut !== false) {
    throw new Error("Provider release summary acknowledgement evidence is invalid.");
  }
  requireExactKeys(summary.operation, [
    "durationMs",
    "operationId",
    "terminalSequence",
    "terminalType"
  ], "operation");
  requireBoundedString(summary.operation.operationId, "operation.operationId", 512);
  if (summary.operation.terminalType !== "operation.completed"
    || !isFiniteNonnegative(summary.operation.durationMs)
    || !Number.isSafeInteger(summary.operation.terminalSequence)
    || summary.operation.terminalSequence < 0) {
    throw new Error("Provider release summary Operation evidence is invalid.");
  }
  requireExactKeys(summary.controlledTool, [
    "invocationCount",
    "observedDurationMs",
    "requestedDelayMs",
    "terminalAfterToolMs"
  ], "controlledTool");
  if (!Number.isSafeInteger(summary.controlledTool.requestedDelayMs)
    || summary.controlledTool.requestedDelayMs < 90_000
    || summary.controlledTool.requestedDelayMs > 300_000
    || !isFiniteNonnegative(summary.controlledTool.observedDurationMs)
    || summary.controlledTool.observedDurationMs < summary.controlledTool.requestedDelayMs
    || !isFiniteNonnegative(summary.controlledTool.terminalAfterToolMs)
    || summary.controlledTool.invocationCount !== 1
    || summary.operation.durationMs < summary.controlledTool.observedDurationMs
    || summary.completionMarkerObserved !== true) {
    throw new Error("Provider release summary controlled Tool evidence is invalid.");
  }
  requireExactKeys(summary.session, ["byteLength", "id", "relativePath", "sha256"], "session");
  requireBoundedString(summary.session.id, "session.id", 512);
  requireBoundedString(summary.session.relativePath, "session.relativePath", 2_048);
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/u.test(summary.session.relativePath)
    || !Number.isSafeInteger(summary.session.byteLength)
    || summary.session.byteLength < 1
    || !/^[0-9a-f]{64}$/u.test(summary.session.sha256)) {
    throw new Error("Provider release summary Session evidence is invalid.");
  }
  requireExactKeys(summary.privacy, [
    "apiKeyRecorded",
    "credentialSource",
    "isolatedAgentDirectory",
    "isolatedUserHome",
    "promptRecorded",
    "rawToolPayloadRecorded",
    "sourceBodyRecorded"
  ], "privacy");
  if (!isDeepStrictEqual(summary.privacy, {
    credentialSource: "runtime-memory",
    isolatedAgentDirectory: true,
    isolatedUserHome: true,
    promptRecorded: false,
    apiKeyRecorded: false,
    rawToolPayloadRecorded: false,
    sourceBodyRecorded: false
  })) {
    throw new Error("Provider release summary privacy boundary is invalid.");
  }
  if (!isDeepStrictEqual(summary.limitations, [...REAL_PROVIDER_LONG_TURN_LIMITATIONS])) {
    throw new Error("Provider release summary limitations are invalid.");
  }
}

async function readBoundedSummary(path) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_SUMMARY_BYTES) {
    throw new Error("Provider release summary exceeds its file boundary.");
  }
  return readFile(path);
}

function parseSummary(source) {
  try {
    return JSON.parse(source.toString("utf8"));
  } catch {
    throw new Error("Provider release summary is not valid JSON.");
  }
}

function requireExactKeys(value, expectedKeys, label) {
  if (!isRecord(value)) throw new Error(`Provider release summary ${label} is missing.`);
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right));
  const expected = [...expectedKeys].sort((left, right) => left.localeCompare(right));
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(`Provider release summary ${label} fields are invalid.`);
  }
}

function requireBoundedString(value, label, limit) {
  if (typeof value !== "string"
    || value.length < 1
    || value.length > limit
    || value.includes("\r")
    || value.includes("\n")
    || value.includes("\u0000")) {
    throw new Error(`Provider release summary ${label} is invalid.`);
  }
}

function isFiniteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseProviderLongTurnReleaseGateArguments(argumentsList) {
  if (argumentsList.length % 2 !== 0) {
    throw new Error("Provider long-turn release gate arguments are incomplete.");
  }
  const allowed = new Set([
    "--candidate-identity",
    "--expected-model-id",
    "--expected-provider-id",
    "--expected-repository",
    "--expected-run-attempt",
    "--expected-run-id",
    "--expected-signer",
    "--expected-source-commit",
    "--expected-source-tag",
    "--expected-thinking-level",
    "--output",
    "--summary"
  ]);
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!allowed.has(name) || values.has(name)) {
      throw new Error(`Invalid Provider long-turn release gate argument: ${name}.`);
    }
    values.set(name, value);
  }
  return {
    candidateIdentityPath: requiredArgument(values, "--candidate-identity"),
    expectedModelId: requiredArgument(values, "--expected-model-id"),
    expectedProviderId: requiredArgument(values, "--expected-provider-id"),
    expectedRepository: requiredArgument(values, "--expected-repository"),
    expectedRunAttempt: requiredArgument(values, "--expected-run-attempt"),
    expectedRunId: requiredArgument(values, "--expected-run-id"),
    expectedSignerThumbprint: requiredArgument(values, "--expected-signer"),
    expectedSourceCommit: requiredArgument(values, "--expected-source-commit"),
    expectedSourceTag: requiredArgument(values, "--expected-source-tag"),
    expectedThinkingLevel: requiredArgument(values, "--expected-thinking-level"),
    outputPath: requiredArgument(values, "--output"),
    summaryPath: requiredArgument(values, "--summary")
  };
}

function requiredArgument(values, name) {
  const value = values.get(name);
  if (typeof value !== "string"
    || value.length < 1
    || value.length > 4_096
    || value.includes("\r")
    || value.includes("\n")
    || value.includes("\u0000")) {
    throw new Error(`${name} requires a bounded single-line value.`);
  }
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arguments_ = parseProviderLongTurnReleaseGateArguments(process.argv.slice(2));
  const gate = await verifyProviderLongTurnReleaseGate(arguments_);
  console.log(`Verified Provider long-turn release gate ${gate.evidence.summarySha256}.`);
}
