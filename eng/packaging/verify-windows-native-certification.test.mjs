import { describe, expect, it } from "vitest";
import {
  parseWindowsNativeVerificationArguments,
  validateWindowsNativeCertificationReceipts
} from "./verify-windows-native-certification.mjs";

const EXPECTED_ARTIFACT = {
  byteLength: 123_456,
  sha256: "a".repeat(64),
  authenticode: { signerThumbprint: "A".repeat(40) }
};
const EXPECTED_CANDIDATE = {
  identitySha256: "b".repeat(64),
  repository: "bigKING67/pi-67-desktop",
  source: { policy: "stable", tag: "v1.2.3", commit: "c".repeat(40) },
  workflow: { runId: "123", runAttempt: "1" },
  version: "1.2.3",
  installerSha256: "d".repeat(64),
  packagedExecutableSha256: EXPECTED_ARTIFACT.sha256,
  signerThumbprint: "A".repeat(40)
};

describe("Windows native certification set", () => {
  it("requires all real DPI scales, trusted IME, one sleep receipt, and one candidate", () => {
    const receipts = [receipt(1.25, true), receipt(1.5, false), receipt(2, false)];
    expect(validateWindowsNativeCertificationReceipts(
      receipts,
      EXPECTED_ARTIFACT,
      EXPECTED_CANDIDATE
    )).toEqual([]);
  });

  it("binds the final verifier to source, workflow, Publisher, identity file, and executable", () => {
    expect(parseWindowsNativeVerificationArguments([
      "--expected-signer-thumbprint", "ab".repeat(20),
      "--executable", "C:\\Pi-67 Desktop.exe",
      ...candidateArguments()
    ])).toEqual({
      candidateIdentityPath: "C:\\candidate.json",
      executablePath: "C:\\Pi-67 Desktop.exe",
      expectedCandidateRunAttempt: "1",
      expectedCandidateRunId: "123",
      expectedRepository: "bigKING67/pi-67-desktop",
      expectedSignerThumbprint: "AB".repeat(20),
      expectedSourceCommit: "c".repeat(40),
      expectedSourceTag: "v1.2.3",
      installerPath: "C:\\candidate-installer.exe"
    });
    expect(() => parseWindowsNativeVerificationArguments(candidateArguments()))
      .toThrow("40 hexadecimal");
    expect(() => parseWindowsNativeVerificationArguments([
      "--expected-signer-thumbprint", "ab".repeat(20)
    ])).toThrow("--candidate-identity");
  });

  it("rejects missing sleep, synthetic IME, mixed executable, and candidate drift", () => {
    const receipts = [receipt(1.25, false), receipt(1.5, false), receipt(2, false)];
    receipts[1].ime.candidateConfirmation.isTrusted = false;
    receipts[1].coldStartedAtExpectedScale = false;
    receipts[2].artifact.sha256 = "e".repeat(64);
    receipts[2].candidate.workflow.runAttempt = "2";
    expect(validateWindowsNativeCertificationReceipts(
      receipts,
      EXPECTED_ARTIFACT,
      EXPECTED_CANDIDATE
    )).toEqual(expect.arrayContaining([
      "150%: trusted Microsoft Pinyin confirmation and exactly-once submission are missing",
      "150%: application was not cold-started at the certified scale",
      "200%: receipt does not match the signed release candidate identity",
      "all DPI receipts must certify the same executable SHA-256",
      "at least one scale receipt must include a real sleep/resume observation"
    ]));
  });
});

function candidateArguments() {
  return [
    "--candidate-identity", "C:\\candidate.json",
    "--installer", "C:\\candidate-installer.exe",
    "--expected-repository", "bigKING67/pi-67-desktop",
    "--expected-source-tag", "v1.2.3",
    "--expected-source-commit", "c".repeat(40),
    "--expected-candidate-run-id", "123",
    "--expected-candidate-run-attempt", "1"
  ];
}

function receipt(scale, sleepObserved) {
  return {
    status: "passed",
    evidenceLevel: "interactive-windows-native-runtime",
    coldStartedAtExpectedScale: true,
    expectedScale: scale,
    candidate: structuredClone(EXPECTED_CANDIDATE),
    host: {
      arch: "x64",
      idSha256: "f".repeat(64),
      osRelease: "fixture",
      osVersion: "fixture",
      platform: "win32"
    },
    artifact: {
      byteLength: EXPECTED_ARTIFACT.byteLength,
      sha256: EXPECTED_ARTIFACT.sha256,
      authenticode: { status: "Valid", signerThumbprint: "A".repeat(40) }
    },
    nativeRuntime: {
      main: { displayScaleFactor: scale },
      renderer: { devicePixelRatio: scale }
    },
    ime: {
      acceptedExactlyOnce: true,
      acceptedTextSha256: "1".repeat(64),
      candidateConfirmation: { isComposing: true, isTrusted: true, keyCode: 229 },
      composerClearedAfterAccepted: true,
      delivery: "follow-up",
      operationIdMatches: true,
      secondEnter: { isComposing: false, isTrusted: true, keyCode: 13 }
    },
    responsive: {
      contextViewport: viewport(scale, 1_040),
      navigationViewport: viewport(scale, 760)
    },
    sleep: sleepObserved ? {
      observed: true,
      operationStillActive: true,
      projectionRecovered: true,
      resumeAt: 8_000,
      sleepGapMs: 6_000,
      suspendAt: 2_000
    } : null,
    shutdown: { closeDurationMs: 100, controlledChildExited: true, utilityProcessCount: 1 }
  };
}

function viewport(scale, innerWidth) {
  return {
    devicePixelRatio: scale,
    horizontalOverflow: 0,
    innerWidth,
    send: { contained: true, topmost: true },
    stop: { contained: true, topmost: true },
    titleBarNativeControlReserve: 140
  };
}
