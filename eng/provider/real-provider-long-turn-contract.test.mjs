import { describe, expect, it } from "vitest";
import {
  assertRealProviderLongTurnReceipt,
  createRealProviderLongTurnFailureSummary,
  createRealProviderLongTurnReceipt,
  createRealProviderLongTurnSummary,
  DEFAULT_TOOL_DELAY_MS,
  readRealProviderLongTurnConfig
} from "./real-provider-long-turn-contract.mjs";
import { createRealProviderCandidateEvidence } from "./real-provider-candidate-contract.mjs";

describe("real Provider long-turn contract", () => {
  it("requires explicit paid-call authorization and bounded credentials", () => {
    expect(() => readRealProviderLongTurnConfig({})).toThrow(/OPT_IN=1/u);
    expect(() => readRealProviderLongTurnConfig({
      PI67_REAL_PROVIDER_OPT_IN: "1",
      PI67_REAL_PROVIDER_ID: "provider",
      PI67_REAL_PROVIDER_MODEL_ID: "model",
      PI67_REAL_PROVIDER_API_KEY: "short"
    })).toThrow(/at least 8/u);

    expect(readRealProviderLongTurnConfig({
      PI67_REAL_PROVIDER_OPT_IN: "1",
      PI67_REAL_PROVIDER_ID: "provider",
      PI67_REAL_PROVIDER_MODEL_ID: "model",
      PI67_REAL_PROVIDER_API_KEY: "credential-value"
    })).toMatchObject({
      apiKey: "credential-value",
      providerId: "provider",
      modelId: "model",
      thinkingLevel: "off",
      toolDelayMs: DEFAULT_TOOL_DELAY_MS
    });
    for (const [name, value] of [
      ["PI67_REAL_PROVIDER_ID", " provider"],
      ["PI67_REAL_PROVIDER_ID", "provider "],
      ["PI67_REAL_PROVIDER_MODEL_ID", "model\tvariant"]
    ]) {
      expect(() => readRealProviderLongTurnConfig({
        PI67_REAL_PROVIDER_OPT_IN: "1",
        PI67_REAL_PROVIDER_ID: "provider",
        PI67_REAL_PROVIDER_MODEL_ID: "model",
        PI67_REAL_PROVIDER_API_KEY: "credential-value",
        [name]: value
      })).toThrow("canonical bounded single-line");
    }
    for (const apiKey of [" credential-value", "credential-value ", "credential\nvalue"]) {
      expect(() => readRealProviderLongTurnConfig({
        PI67_REAL_PROVIDER_OPT_IN: "1",
        PI67_REAL_PROVIDER_ID: "provider",
        PI67_REAL_PROVIDER_MODEL_ID: "model",
        PI67_REAL_PROVIDER_API_KEY: apiKey
      })).toThrow("surrounding whitespace or control characters");
    }
    expect(() => readRealProviderLongTurnConfig({
      PI67_REAL_PROVIDER_OPT_IN: "1",
      PI67_REAL_PROVIDER_ID: "provider",
      PI67_REAL_PROVIDER_MODEL_ID: "model",
      PI67_REAL_PROVIDER_API_KEY: "credential-value",
      PI67_REAL_PROVIDER_SOURCE_COMMIT: "short"
    })).toThrow("full lowercase Git commit");
    expect(() => readRealProviderLongTurnConfig({
      PI67_REAL_PROVIDER_OPT_IN: "1",
      PI67_REAL_PROVIDER_ID: "provider",
      PI67_REAL_PROVIDER_MODEL_ID: "model",
      PI67_REAL_PROVIDER_API_KEY: "credential-value",
      PI67_REAL_PROVIDER_REQUIRE_CANDIDATE_IDENTITY: "1"
    })).toThrow(/complete signed candidate authority/u);
    expect(readRealProviderLongTurnConfig({
      PI67_REAL_PROVIDER_OPT_IN: "1",
      PI67_REAL_PROVIDER_ID: "provider",
      PI67_REAL_PROVIDER_MODEL_ID: "model",
      PI67_REAL_PROVIDER_API_KEY: "credential-value",
      PI67_REAL_PROVIDER_CANDIDATE_IDENTITY: "artifacts/identity.json",
      PI67_REAL_PROVIDER_CANDIDATE_RUN_ATTEMPT: "1",
      PI67_REAL_PROVIDER_CANDIDATE_RUN_ID: "123",
      PI67_REAL_PROVIDER_CANDIDATE_SOURCE_POLICY: "version-tag",
      PI67_REAL_PROVIDER_EXPECTED_REPOSITORY: "bigKING67/pi-67-desktop",
      PI67_REAL_PROVIDER_EXPECTED_SIGNER_THUMBPRINT: "e".repeat(40),
      PI67_REAL_PROVIDER_SOURCE_COMMIT: "a".repeat(40),
      PI67_REAL_PROVIDER_SOURCE_TAG: "v0.1.0-alpha.3",
      PI67_REAL_PROVIDER_REQUIRE_CANDIDATE_IDENTITY: "1"
    })).toMatchObject({
      expectedSignerThumbprint: "E".repeat(40),
      requireCandidateIdentity: true
    });
  });

  it("projects only the shared signed candidate authority needed by Provider evidence", () => {
    const identity = candidateIdentity();
    const candidate = createRealProviderCandidateEvidence({
      appVersion: "0.1.0-alpha.3",
      candidateIdentity: identity,
      candidateIdentitySha256: "f".repeat(64),
      executableSha256: "c".repeat(64),
      sourceCommit: "a".repeat(40),
      sourceTag: "v0.1.0-alpha.3"
    });

    expect(candidate).toMatchObject({
      schema: "pi67.windows-signed-candidate.v2",
      identitySha256: "f".repeat(64),
      source: { policy: "version-tag", tag: "v0.1.0-alpha.3" },
      signerThumbprint: "E".repeat(40),
      packagedExecutable: { sha256: "c".repeat(64) }
    });
    expect(candidate).not.toHaveProperty("installer.authenticode.signerSubject");

    const stablePolicy = candidateIdentity();
    stablePolicy.source.policy = "stable";
    expect(() => createRealProviderCandidateEvidence({
      appVersion: "0.1.0-alpha.3",
      candidateIdentity: stablePolicy,
      candidateIdentitySha256: "f".repeat(64),
      executableSha256: "c".repeat(64),
      sourceCommit: "a".repeat(40),
      sourceTag: "v0.1.0-alpha.3"
    })).toThrow("source policy does not match");
  });

  it("rejects fake acknowledgements, short Tool runs, and non-completed terminals", () => {
    const receipt = {
      hostEpoch: 2,
      operationId: "operation-1",
      acceptedLatencyMs: 120,
      operationDurationMs: 100_000,
      terminalType: "operation.completed",
      terminalSequence: 8,
      toolDurationMs: 95_000,
      terminalAfterToolMs: 4_120,
      toolDelayMs: 95_000,
      completionMarkerObserved: true,
      session: {
        id: "session-1",
        relativePath: "sessions/one.jsonl",
        byteLength: 1_024,
        sha256: "a".repeat(64)
      }
    };
    expect(() => assertRealProviderLongTurnReceipt(receipt)).not.toThrow();
    expect(() => assertRealProviderLongTurnReceipt({ ...receipt, acceptedLatencyMs: 5_001 })).toThrow(/acknowledgement/u);
    expect(() => assertRealProviderLongTurnReceipt({ ...receipt, toolDurationMs: 89_999 })).toThrow(/too early/u);
    expect(() => assertRealProviderLongTurnReceipt({ ...receipt, terminalType: "operation.failed" })).toThrow(/did not complete/u);
  });

  it("projects validated timing evidence from sanitized protocol and Tool lifecycles", () => {
    expect(createRealProviderLongTurnReceipt({
      protocol: {
        hostEpoch: 2,
        operationId: "operation-1",
        submitStartedAt: 1_000,
        acceptedAt: 1_120,
        terminal: { type: "operation.completed", at: 101_120, sequence: 8 },
        completionMarkerObserved: true
      },
      lifecycle: { startedAt: 2_000, completedAt: 97_000 },
      toolDelayMs: 95_000,
      session: {
        id: "session-1",
        relativePath: "sessions/one.jsonl",
        byteLength: 1_024,
        sha256: "a".repeat(64)
      }
    })).toMatchObject({
      acceptedLatencyMs: 120,
      operationDurationMs: 100_000,
      toolDurationMs: 95_000
    });
  });

  it("creates a bounded receipt that cannot serialize the API key or Prompt", () => {
    const secret = "provider-secret-never-record";
    const prompt = "private prompt never record";
    const receipt = {
      hostEpoch: 2,
      operationId: "operation-1",
      acceptedLatencyMs: 120,
      operationDurationMs: 100_000,
      toolDelayMs: 95_000,
      toolDurationMs: 95_020,
      terminalType: "operation.completed",
      terminalSequence: 8,
      terminalAfterToolMs: 4_120,
      completionMarkerObserved: true,
      session: {
        id: "session-1",
        relativePath: "sessions/one.jsonl",
        byteLength: 1024,
        sha256: "b".repeat(64)
      }
    };
    const summary = createRealProviderLongTurnSummary({
      appVersion: "0.1.0",
      platform: "darwin",
      architecture: "arm64",
      executableSha256: "c".repeat(64),
      providerId: "provider",
      modelId: "model",
      requestedThinkingLevel: "high",
      effectiveThinkingLevel: "high",
      rendererUrl: "app://pi67/index.html",
      hostPid: 67,
      receipt,
      apiKey: secret,
      prompt
    });
    const serialized = JSON.stringify(summary);

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(prompt);
    expect(summary.privacy).toMatchObject({
      credentialSource: "runtime-memory",
      promptRecorded: false,
      apiKeyRecorded: false
    });
    expect(summary.status).toBe("passed");
    expect(summary.provider).toMatchObject({
      requestedThinkingLevel: "high",
      effectiveThinkingLevel: "high"
    });

    const failure = createRealProviderLongTurnFailureSummary({
      appVersion: "0.1.0",
      platform: "win32",
      architecture: "x64",
      executableSha256: "d".repeat(64),
      providerId: "provider",
      modelId: "model",
      requestedThinkingLevel: "off",
      failureStage: "run-provider-turn",
      evidence: { artifactResolved: true, applicationLaunched: true }
    });
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(failure).toMatchObject({
      status: "failed",
      error: {
        code: "PROVIDER_LONG_TURN_FAILED",
        stage: "run-provider-turn",
        message: "Real Provider certification did not complete."
      }
    });
    expect(() => createRealProviderLongTurnFailureSummary({
      appVersion: "0.1.0",
      platform: "win32",
      architecture: "x64",
      executableSha256: "invalid",
      providerId: "provider",
      modelId: "model",
      requestedThinkingLevel: "off",
      failureStage: "run-provider-turn",
      evidence: { artifactResolved: true }
    })).toThrow(/SHA-256/u);
    expect(() => createRealProviderLongTurnFailureSummary({
      appVersion: "0.1.0",
      platform: "win32",
      architecture: "x64",
      executableSha256: "d".repeat(64),
      providerId: "provider",
      modelId: "model",
      requestedThinkingLevel: "off",
      failureStage: "provider-response-body",
      evidence: { artifactResolved: true }
    })).toThrow(/allowlisted harness stage/u);
  });
});

function candidateIdentity() {
  return {
    schema: "pi67.windows-signed-candidate.v2",
    repository: "bigKING67/pi-67-desktop",
    workflow: { runId: "123", runAttempt: "1" },
    source: {
      policy: "version-tag",
      tag: "v0.1.0-alpha.3",
      commit: "a".repeat(40)
    },
    application: {
      product: "Pi-67 Desktop",
      version: "0.1.0-alpha.3",
      platform: "win32",
      architecture: "x64",
      runtime: "@earendil-works/pi-coding-agent@0.81.1"
    },
    installer: signedFile(
      "Pi-67-Desktop-0.1.0-alpha.3-win-x64.exe",
      "b".repeat(64)
    ),
    packagedExecutable: signedFile(
      "win-unpacked/Pi-67 Desktop.exe",
      "c".repeat(64)
    )
  };
}

function signedFile(fileName, sha256) {
  return {
    fileName,
    byteLength: 100,
    sha256,
    authenticode: {
      status: "Valid",
      signerThumbprint: "E".repeat(40),
      signerSubject: "CN=Pi-67 Desktop"
    }
  };
}
