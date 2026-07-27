import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRealProviderLongTurnSummary } from "./real-provider-long-turn-contract.mjs";
import {
  parseProviderLongTurnReleaseGateArguments,
  verifyProviderLongTurnReleaseGate
} from "./provider-long-turn-release-gate.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { force: true, recursive: true })
  )));
});

describe("Provider long-turn release gate", () => {
  it("binds one passed Provider receipt to the exact stable signed candidate", async () => {
    const fixture = await createFixture();
    const gate = await verifyProviderLongTurnReleaseGate(fixture.arguments);

    expect(gate).toMatchObject({
      schema: "pi67.provider-long-turn-release-gate.v1",
      status: "passed",
      repository: "bigKING67/pi-67-desktop",
      source: { policy: "stable", tag: "v1.2.3", commit: "a".repeat(40) },
      workflow: { runId: "123", runAttempt: "1" },
      provider: {
        id: "provider",
        modelId: "model",
        effectiveThinkingLevel: "high"
      },
      operation: { terminalType: "operation.completed" }
    });
    expect(JSON.parse(await readFile(fixture.arguments.outputPath, "utf8"))).toEqual(gate);
  });

  it("rejects candidate drift and unbounded extra receipt fields", async () => {
    const candidateDrift = await createFixture();
    const drifted = JSON.parse(await readFile(candidateDrift.arguments.summaryPath, "utf8"));
    drifted.candidate.identitySha256 = "f".repeat(64);
    await writeFile(candidateDrift.arguments.summaryPath, `${JSON.stringify(drifted)}\n`);
    await expect(verifyProviderLongTurnReleaseGate(candidateDrift.arguments))
      .rejects.toThrow("does not match the signed candidate identity");

    const rawField = await createFixture();
    const unsafe = JSON.parse(await readFile(rawField.arguments.summaryPath, "utf8"));
    unsafe.rawProviderBody = "must never be published";
    await writeFile(rawField.arguments.summaryPath, `${JSON.stringify(unsafe)}\n`);
    await expect(verifyProviderLongTurnReleaseGate(rawField.arguments))
      .rejects.toThrow("summary fields are invalid");
  });

  it("parses only the complete fail-closed CLI", () => {
    const arguments_ = candidateArguments();
    expect(parseProviderLongTurnReleaseGateArguments(arguments_)).toMatchObject({
      expectedProviderId: "provider",
      expectedModelId: "model",
      expectedThinkingLevel: "high"
    });
    expect(() => parseProviderLongTurnReleaseGateArguments([
      ...arguments_,
      "--unknown", "value"
    ])).toThrow("Invalid Provider long-turn release gate argument");
  });
});

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), "pi67-provider-release-gate-"));
  temporaryDirectories.push(directory);
  const candidateIdentityPath = join(directory, "windows-signed-candidate-identity.json");
  const summaryPath = join(directory, "summary.json");
  const outputPath = join(directory, "provider-long-turn-release-gate.json");
  const identity = candidateIdentity();
  const identitySource = `${JSON.stringify(identity, null, 2)}\n`;
  await writeFile(candidateIdentityPath, identitySource);
  const summary = createRealProviderLongTurnSummary({
    appVersion: "1.2.3",
    platform: "win32",
    architecture: "x64",
    executableSha256: "c".repeat(64),
    providerId: "provider",
    modelId: "model",
    requestedThinkingLevel: "high",
    effectiveThinkingLevel: "high",
    rendererUrl: "app://pi67/index.html",
    hostPid: 67,
    sourceCommit: "a".repeat(40),
    sourceTag: "v1.2.3",
    candidateIdentity: identity,
    candidateIdentitySha256: sha256(identitySource),
    candidateSourcePolicy: "stable",
    receipt: receipt()
  });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  await mkdir(dirname(outputPath), { recursive: true });
  return {
    arguments: {
      candidateIdentityPath,
      expectedModelId: "model",
      expectedProviderId: "provider",
      expectedRepository: "bigKING67/pi-67-desktop",
      expectedRunAttempt: "1",
      expectedRunId: "123",
      expectedSignerThumbprint: "E".repeat(40),
      expectedSourceCommit: "a".repeat(40),
      expectedSourceTag: "v1.2.3",
      expectedThinkingLevel: "high",
      outputPath,
      summaryPath
    }
  };
}

function candidateArguments() {
  return [
    "--candidate-identity", "candidate.json",
    "--summary", "summary.json",
    "--expected-repository", "bigKING67/pi-67-desktop",
    "--expected-source-tag", "v1.2.3",
    "--expected-source-commit", "a".repeat(40),
    "--expected-run-id", "123",
    "--expected-run-attempt", "1",
    "--expected-signer", "E".repeat(40),
    "--expected-provider-id", "provider",
    "--expected-model-id", "model",
    "--expected-thinking-level", "high",
    "--output", "gate.json"
  ];
}

function candidateIdentity() {
  return {
    schema: "pi67.windows-signed-candidate.v2",
    repository: "bigKING67/pi-67-desktop",
    workflow: { runId: "123", runAttempt: "1" },
    source: { policy: "stable", tag: "v1.2.3", commit: "a".repeat(40) },
    application: {
      product: "Pi-67 Desktop",
      version: "1.2.3",
      platform: "win32",
      architecture: "x64",
      runtime: "@earendil-works/pi-coding-agent@0.81.1"
    },
    installer: signedFile("Pi-67-Desktop-1.2.3-win-x64.exe", "b".repeat(64)),
    packagedExecutable: signedFile("win-unpacked/Pi-67 Desktop.exe", "c".repeat(64))
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

function receipt() {
  return {
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
      byteLength: 1_024,
      sha256: "d".repeat(64)
    }
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
