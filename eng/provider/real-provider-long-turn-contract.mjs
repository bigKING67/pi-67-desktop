import {
  createRealProviderCandidateEvidence,
  readRealProviderCandidateConfig
} from "./real-provider-candidate-contract.mjs";

const REAL_PROVIDER_LONG_TURN_SCHEMA = "pi67.real-provider-long-turn.v2";
const DEFAULT_ACCEPTED_BUDGET_MS = 5_000;
export const DEFAULT_TOOL_DELAY_MS = 95_000;
export const REAL_PROVIDER_LONG_TURN_LIMITATIONS = Object.freeze([
  "This receipt proves one explicitly authorized Provider Operation through a packaged Electron build.",
  "The controlled Tool supplies the long business-operation duration; it is not a general Provider latency benchmark.",
  "Windows DPI, Windows IME, installation, upgrade, uninstall, real sleep/resume, and any signature check outside this receipt remain separate evidence."
]);
const REAL_PROVIDER_THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
]);
const REAL_PROVIDER_FAILURE_STAGES = new Set([
  "candidate-identity",
  "prepare-controlled-tool",
  "packaged-launch",
  "renderer-boundary",
  "runtime-initialize",
  "workspace-trust",
  "session-create",
  "credential-install",
  "model-select",
  "prompt-submit",
  "prompt-ack",
  "tool-approval",
  "tool-execution",
  "operation-terminal",
  "session-receipt",
  "run-provider-turn",
  "read-session-identity",
  "build-receipt",
  "write-receipt"
]);
const REAL_PROVIDER_EVIDENCE_KEYS = [
  "artifactResolved",
  "applicationLaunched",
  "rendererBoundaryVerified",
  "runtimeReady",
  "credentialInstalled",
  "modelSelected",
  "promptSubmitted",
  "promptAccepted",
  "toolApproved",
  "toolStarted",
  "toolCompleted",
  "terminalObserved",
  "sessionReceiptVerified"
];

export function readRealProviderLongTurnConfig(environment) {
  if (environment.PI67_REAL_PROVIDER_OPT_IN !== "1") {
    throw new Error(
      "Real Provider validation is disabled. Set PI67_REAL_PROVIDER_OPT_IN=1 to authorize one billed Provider Operation."
    );
  }
  const providerId = requiredBoundedValue(
    environment.PI67_REAL_PROVIDER_ID,
    "PI67_REAL_PROVIDER_ID",
    256
  );
  const modelId = requiredBoundedValue(
    environment.PI67_REAL_PROVIDER_MODEL_ID,
    "PI67_REAL_PROVIDER_MODEL_ID",
    512
  );
  const apiKey = requiredSecretValue(environment.PI67_REAL_PROVIDER_API_KEY, "PI67_REAL_PROVIDER_API_KEY");
  if (apiKey.length < 8) {
    throw new Error("PI67_REAL_PROVIDER_API_KEY must contain at least 8 characters.");
  }
  const candidate = readRealProviderCandidateConfig(environment);
  const thinkingLevel = boundedOptionalValue(
    environment.PI67_REAL_PROVIDER_THINKING_LEVEL,
    64
  ) ?? "off";
  if (!REAL_PROVIDER_THINKING_LEVELS.has(thinkingLevel)) {
    throw new Error("PI67_REAL_PROVIDER_THINKING_LEVEL is not supported by the certification harness.");
  }
  return {
    providerId,
    modelId,
    apiKey,
    ...candidate,
    thinkingLevel,
    toolDelayMs: boundedInteger(
      environment.PI67_REAL_PROVIDER_TOOL_DELAY_MS,
      DEFAULT_TOOL_DELAY_MS,
      90_000,
      300_000,
      "PI67_REAL_PROVIDER_TOOL_DELAY_MS"
    ),
    outputPath: boundedOptionalValue(
      environment.PI67_REAL_PROVIDER_OUTPUT,
      4_096
    )
  };
}

export function assertRealProviderLongTurnReceipt(receipt) {
  if (!Number.isFinite(receipt.acceptedLatencyMs) || receipt.acceptedLatencyMs < 0) {
    throw new Error("Provider harness did not capture a valid prompt acknowledgement latency.");
  }
  if (receipt.acceptedLatencyMs > DEFAULT_ACCEPTED_BUDGET_MS) {
    throw new Error(
      `Prompt acknowledgement exceeded ${DEFAULT_ACCEPTED_BUDGET_MS}ms: ${Math.round(receipt.acceptedLatencyMs)}ms.`
    );
  }
  if (receipt.terminalType !== "operation.completed") {
    throw new Error(`Provider Operation did not complete successfully: ${receipt.terminalType}.`);
  }
  if (!Number.isFinite(receipt.operationDurationMs) || receipt.operationDurationMs < receipt.toolDurationMs) {
    throw new Error("Provider Operation duration does not contain the controlled Tool lifecycle.");
  }
  if (!Number.isFinite(receipt.toolDurationMs) || receipt.toolDurationMs < receipt.toolDelayMs) {
    throw new Error(
      `Controlled Provider Tool completed too early: ${Math.round(receipt.toolDurationMs)}ms.`
    );
  }
  if (!Number.isFinite(receipt.terminalAfterToolMs) || receipt.terminalAfterToolMs < 0) {
    throw new Error("Provider terminal event preceded the controlled Tool completion.");
  }
  if (receipt.completionMarkerObserved !== true) {
    throw new Error("Provider harness did not observe the fixed final completion marker.");
  }
  if (
    !Number.isSafeInteger(receipt.hostEpoch)
    || receipt.hostEpoch < 0
    || typeof receipt.operationId !== "string"
    || !receipt.operationId
    || !Number.isSafeInteger(receipt.terminalSequence)
    || receipt.terminalSequence < 0
  ) {
    throw new Error("Provider harness did not capture a valid Host and Operation identity.");
  }
  if (
    typeof receipt.session?.id !== "string"
    || !receipt.session.id
    || typeof receipt.session.relativePath !== "string"
    || !receipt.session.relativePath
    || /(?:^|[\\/])\.\.(?:[\\/]|$)/u.test(receipt.session.relativePath)
    || !Number.isSafeInteger(receipt.session.byteLength)
    || receipt.session.byteLength < 1
    || !/^[0-9a-f]{64}$/u.test(receipt.session.sha256)
  ) {
    throw new Error("Provider harness did not capture an authoritative Pi JSONL identity.");
  }
}

export function createRealProviderLongTurnReceipt({
  protocol,
  lifecycle,
  toolDelayMs,
  session
}) {
  const acceptedAt = requireTimestamp(protocol?.acceptedAt, "protocol.acceptedAt");
  const terminalAt = requireTimestamp(protocol?.terminal?.at, "protocol.terminal.at");
  const toolCompletedAt = requireTimestamp(lifecycle?.completedAt, "tool.completedAt");
  const receipt = {
    hostEpoch: requireInteger(protocol?.hostEpoch, "protocol.hostEpoch"),
    operationId: requiredValue(protocol?.operationId, "protocol.operationId"),
    acceptedLatencyMs: acceptedAt
      - requireTimestamp(protocol?.submitStartedAt, "protocol.submitStartedAt"),
    operationDurationMs: terminalAt - acceptedAt,
    terminalType: requiredValue(protocol?.terminal?.type, "protocol.terminal.type"),
    terminalSequence: requireInteger(
      protocol?.terminal?.sequence,
      "protocol.terminal.sequence"
    ),
    toolDurationMs: toolCompletedAt
      - requireTimestamp(lifecycle?.startedAt, "tool.startedAt"),
    terminalAfterToolMs: terminalAt - toolCompletedAt,
    completionMarkerObserved: protocol?.completionMarkerObserved === true,
    toolDelayMs,
    session
  };
  assertRealProviderLongTurnReceipt(receipt);
  return receipt;
}

export function createRealProviderLongTurnSummary({
  appVersion,
  platform,
  architecture,
  executableSha256,
  providerId,
  modelId,
  requestedThinkingLevel,
  effectiveThinkingLevel,
  rendererUrl,
  hostPid,
  sourceCommit,
  sourceTag,
  candidateIdentity,
  candidateIdentitySha256,
  candidateSourcePolicy,
  receipt
}) {
  assertProviderEvidenceIdentity(executableSha256, sourceCommit);
  const candidate = createRealProviderCandidateEvidence({
    appVersion,
    candidateIdentity,
    candidateIdentitySha256,
    candidateSourcePolicy,
    executableSha256,
    sourceCommit,
    sourceTag
  });
  if (rendererUrl !== "app://pi67/index.html") {
    throw new Error("Provider receipt requires the packaged app://pi67 Renderer.");
  }
  if (
    !REAL_PROVIDER_THINKING_LEVELS.has(requestedThinkingLevel)
    || !REAL_PROVIDER_THINKING_LEVELS.has(effectiveThinkingLevel)
    || requestedThinkingLevel !== effectiveThinkingLevel
  ) {
    throw new Error("Provider receipt requires a supported effective thinking level.");
  }
  return {
    schema: REAL_PROVIDER_LONG_TURN_SCHEMA,
    status: "passed",
    generatedAt: new Date().toISOString(),
    application: {
      version: appVersion,
      platform,
      architecture,
      packaged: true,
      rendererUrl,
      executableSha256
    },
    provider: {
      id: providerId,
      modelId,
      requestedThinkingLevel,
      effectiveThinkingLevel
    },
    source: candidate?.source ?? { tag: sourceTag ?? null, commit: sourceCommit ?? null },
    candidate,
    host: { pid: hostPid, epoch: receipt.hostEpoch },
    transport: {
      acceptedBudgetMs: DEFAULT_ACCEPTED_BUDGET_MS,
      acceptedLatencyMs: receipt.acceptedLatencyMs,
      acknowledgementTimedOut: false
    },
    operation: {
      operationId: receipt.operationId,
      durationMs: receipt.operationDurationMs,
      terminalType: receipt.terminalType,
      terminalSequence: receipt.terminalSequence
    },
    controlledTool: {
      requestedDelayMs: receipt.toolDelayMs,
      observedDurationMs: receipt.toolDurationMs,
      terminalAfterToolMs: receipt.terminalAfterToolMs,
      invocationCount: 1
    },
    completionMarkerObserved: receipt.completionMarkerObserved,
    session: receipt.session,
    privacy: {
      credentialSource: "runtime-memory",
      isolatedAgentDirectory: true,
      isolatedUserHome: true,
      promptRecorded: false,
      apiKeyRecorded: false,
      rawToolPayloadRecorded: false,
      sourceBodyRecorded: false
    },
    limitations: [...REAL_PROVIDER_LONG_TURN_LIMITATIONS]
  };
}

export function createRealProviderLongTurnFailureSummary({
  appVersion,
  platform,
  architecture,
  executableSha256,
  providerId,
  modelId,
  requestedThinkingLevel,
  sourceCommit,
  sourceTag,
  candidateIdentity,
  candidateIdentitySha256,
  candidateSourcePolicy,
  failureStage,
  evidence
}) {
  assertProviderEvidenceIdentity(executableSha256, sourceCommit);
  const candidate = createRealProviderCandidateEvidence({
    appVersion,
    candidateIdentity,
    candidateIdentitySha256,
    candidateSourcePolicy,
    executableSha256,
    sourceCommit,
    sourceTag
  });
  if (!REAL_PROVIDER_FAILURE_STAGES.has(failureStage)) {
    throw new Error("Provider failure receipt requires an allowlisted harness stage.");
  }
  return {
    schema: REAL_PROVIDER_LONG_TURN_SCHEMA,
    status: "failed",
    generatedAt: new Date().toISOString(),
    application: {
      version: appVersion,
      platform,
      architecture,
      artifactResolved: evidence?.artifactResolved === true,
      executableSha256
    },
    provider: {
      id: providerId,
      modelId,
      requestedThinkingLevel,
      effectiveThinkingLevel: null
    },
    source: candidate?.source ?? { tag: sourceTag ?? null, commit: sourceCommit ?? null },
    candidate,
    error: {
      code: "PROVIDER_LONG_TURN_FAILED",
      stage: failureStage,
      message: "Real Provider certification did not complete."
    },
    evidence: projectRealProviderFailureEvidence(evidence),
    privacy: {
      credentialSource: "runtime-memory",
      isolatedAgentDirectory: true,
      isolatedUserHome: true,
      promptRecorded: false,
      apiKeyRecorded: false,
      rawToolPayloadRecorded: false,
      sourceBodyRecorded: false
    }
  };
}

function requiredValue(value, name) {
  const normalized = boundedOptionalValue(value, 4_096);
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function requiredBoundedValue(value, name, limit) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  if (value.length > limit) throw new Error(`Configuration value exceeds ${limit} characters.`);
  if (value !== value.trim() || /\p{Cc}/u.test(value)) {
    throw new Error(`${name} must be a canonical bounded single-line value.`);
  }
  return value;
}

function requiredSecretValue(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  if (value.length > 4_096) throw new Error(`${name} exceeds the supported length.`);
  if (value !== value.trim() || /\p{Cc}/u.test(value)) {
    throw new Error(`${name} must not contain surrounding whitespace or control characters.`);
  }
  return value;
}

function boundedOptionalValue(value, limit) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > limit) throw new Error(`Configuration value exceeds ${limit} characters.`);
  return normalized;
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function requireInteger(value, name) {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer.`);
  return value;
}

function requireTimestamp(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a timestamp.`);
  return value;
}

function assertProviderEvidenceIdentity(executableSha256, sourceCommit) {
  if (!/^[0-9a-f]{64}$/u.test(executableSha256)) {
    throw new Error("Provider receipt requires the packaged executable SHA-256.");
  }
  if (sourceCommit !== undefined && !/^[0-9a-f]{40}$/u.test(sourceCommit)) {
    throw new Error("Provider receipt source commit must be a full lowercase Git commit.");
  }
}

function projectRealProviderFailureEvidence(evidence) {
  return Object.fromEntries(REAL_PROVIDER_EVIDENCE_KEYS.map((key) => [
    key,
    evidence?.[key] === true
  ]));
}
