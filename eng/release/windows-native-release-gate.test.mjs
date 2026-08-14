import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  candidateBindingFromIdentity
} from "../packaging/windows-native-candidate-binding.mjs";
import {
  hashWindowsSignedCandidateIdentity
} from "./windows-signed-candidate-identity.mjs";
import {
  parseWindowsNativeReleaseGateArguments,
  validateWindowsNativeReleaseGateEvidence,
  verifyWindowsNativeReleaseGate
} from "./windows-native-release-gate.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { force: true, recursive: true })
  )));
});

describe("Windows native release gate", () => {
  it("recomputes candidate, receipt, screenshot, and summary evidence before publishing", async () => {
    const fixture = await createFixture();
    const gate = await verifyWindowsNativeReleaseGate(fixture.arguments);

    expect(gate).toMatchObject({
      schema: "pi67.windows-native-release-gate.v1",
      status: "passed",
      repository: "bigKING67/pi-67-desktop",
      source: { tag: "v1.2.3", commit: "a".repeat(40) },
      workflow: { runId: "123", runAttempt: "1" },
      candidate: fixture.candidate,
      certification: { sleepScale: 1.25 }
    });
    expect(JSON.parse(await readFile(fixture.arguments.outputPath, "utf8"))).toEqual(gate);
  });

  it("rejects screenshot and summary candidate drift", async () => {
    const screenshotDrift = await createFixture();
    await writeFile(
      join(screenshotDrift.arguments.certificationRoot, "scale-150", "workspace.png"),
      "changed screenshot"
    );
    await expect(verifyWindowsNativeReleaseGate(screenshotDrift.arguments))
      .rejects.toThrow("screenshot SHA-256 mismatch");

    const summaryDrift = await createFixture();
    const summaryPath = join(summaryDrift.arguments.certificationRoot, "summary.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    summary.candidate.workflow.runAttempt = "2";
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    await expect(verifyWindowsNativeReleaseGate(summaryDrift.arguments))
      .rejects.toThrow("summary candidate identity");
  });

  it("keeps summary validation and CLI inputs fail closed", () => {
    const candidate = candidateBindingFromIdentity(candidateIdentity(Buffer.from("installer")), "b".repeat(64));
    const receipts = [receipt(1.25, true, candidate), receipt(1.5, false, candidate), receipt(2, false, candidate)];
    const summary = certificationSummary(candidate);
    summary.sleepScale = 2;
    expect(validateWindowsNativeReleaseGateEvidence({
      expectedArtifact: expectedArtifact(),
      expectedCandidate: candidate,
      expectedExecutableName: "Pi-67 Desktop.exe",
      receipts,
      summary
    })).toContain("certification summary sleep scale is invalid");

    expect(parseWindowsNativeReleaseGateArguments(cliArguments())).toEqual({
      candidateIdentityPath: "candidate.json",
      certificationRoot: "native-certification",
      expectedRepository: "bigKING67/pi-67-desktop",
      expectedRunAttempt: "1",
      expectedRunId: "123",
      expectedSignerThumbprint: "E".repeat(40),
      expectedSourceCommit: "a".repeat(40),
      expectedSourceTag: "v1.2.3",
      installerPath: "Pi-67-Desktop-1.2.3-win-x64.exe",
      outputPath: "gate.json"
    });
    expect(() => parseWindowsNativeReleaseGateArguments([]))
      .toThrow("--candidate-identity");
    expect(() => parseWindowsNativeReleaseGateArguments([
      ...cliArguments(),
      "--unknown", "value"
    ])).toThrow("Invalid Windows native release gate argument");
  });
});

async function createFixture() {
  const directory = await temporaryDirectory();
  const certificationRoot = join(directory, "native-certification");
  const installerPath = join(directory, "Pi-67-Desktop-1.2.3-win-x64.exe");
  const candidateIdentityPath = join(directory, "windows-signed-candidate-identity.json");
  const outputPath = join(directory, "windows-native-release-gate.json");
  const installer = Buffer.from("signed-installer-fixture");
  const identity = candidateIdentity(installer);
  await writeFile(installerPath, installer);
  await writeFile(candidateIdentityPath, `${JSON.stringify(identity, null, 2)}\n`);
  const candidate = candidateBindingFromIdentity(
    identity,
    await hashWindowsSignedCandidateIdentity(candidateIdentityPath)
  );
  for (const [scale, sleep] of [[1.25, true], [1.5, false], [2, false]]) {
    const label = String(Math.round(scale * 100));
    const scaleDirectory = join(certificationRoot, `scale-${label}`);
    const screenshot = Buffer.from(`screenshot-${label}`);
    await mkdir(scaleDirectory, { recursive: true });
    await writeFile(join(scaleDirectory, "workspace.png"), screenshot);
    await writeFile(
      join(scaleDirectory, "receipt.json"),
      `${JSON.stringify({
        ...receipt(scale, sleep, candidate),
        screenshot: { path: `scale-${label}/workspace.png`, sha256: sha256(screenshot) }
      }, null, 2)}\n`
    );
  }
  await writeFile(
    join(certificationRoot, "summary.json"),
    `${JSON.stringify(certificationSummary(candidate), null, 2)}\n`
  );
  return {
    arguments: {
      candidateIdentityPath,
      certificationRoot,
      expectedRepository: "bigKING67/pi-67-desktop",
      expectedRunAttempt: "1",
      expectedRunId: "123",
      expectedSignerThumbprint: "E".repeat(40),
      expectedSourceCommit: "a".repeat(40),
      expectedSourceTag: "v1.2.3",
      installerPath,
      outputPath
    },
    candidate
  };
}

function certificationSummary(candidate) {
  return {
    schemaVersion: 1,
    status: "passed",
    evidenceLevel: "windows-native-dpi-ime-sleep-certification-set",
    scales: [1.25, 1.5, 2],
    executableName: "Pi-67 Desktop.exe",
    executableByteLength: 123_456,
    executableSha256: "c".repeat(64),
    authenticodeSignerThumbprint: "E".repeat(40),
    candidate: structuredClone(candidate),
    sleepScale: 1.25
  };
}

function receipt(scale, sleepObserved, candidate) {
  return {
    schemaVersion: 1,
    status: "passed",
    evidenceLevel: "interactive-windows-native-runtime",
    coldStartedAtExpectedScale: true,
    expectedScale: scale,
    candidate: structuredClone(candidate),
    host: {
      arch: "x64",
      idSha256: "f".repeat(64),
      osRelease: "fixture",
      osVersion: "fixture",
      platform: "win32"
    },
    artifact: expectedArtifact(),
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
      contextViewport: viewport(scale, 1_160),
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

function expectedArtifact() {
  return {
    byteLength: 123_456,
    sha256: "c".repeat(64),
    authenticode: {
      status: "Valid",
      signerThumbprint: "E".repeat(40),
      signerSubject: "CN=Pi-67 Desktop"
    }
  };
}

function candidateIdentity(installer) {
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
    installer: signedFile(
      "Pi-67-Desktop-1.2.3-win-x64.exe",
      installer.byteLength,
      sha256(installer)
    ),
    packagedExecutable: signedFile("win-unpacked/Pi-67 Desktop.exe", 123_456, "c".repeat(64))
  };
}

function signedFile(fileName, byteLength, hash) {
  return {
    fileName,
    byteLength,
    sha256: hash,
    authenticode: {
      status: "Valid",
      signerThumbprint: "E".repeat(40),
      signerSubject: "CN=Pi-67 Desktop"
    }
  };
}

function viewport(scale, innerWidth) {
  return {
    devicePixelRatio: scale,
    horizontalOverflow: 0,
    innerWidth,
    send: { contained: true, topmost: true, topmostSurface: "control" },
    stop: { contained: true, topmost: true, topmostSurface: "control" },
    titleBarNativeControlReserve: 140
  };
}

function cliArguments() {
  return [
    "--candidate-identity", "candidate.json",
    "--certification-root", "native-certification",
    "--installer", "Pi-67-Desktop-1.2.3-win-x64.exe",
    "--expected-repository", "bigKING67/pi-67-desktop",
    "--expected-source-tag", "v1.2.3",
    "--expected-source-commit", "a".repeat(40),
    "--expected-run-id", "123",
    "--expected-run-attempt", "1",
    "--expected-signer", "E".repeat(40),
    "--output", "gate.json"
  ];
}

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "pi67-native-release-gate-"));
  temporaryDirectories.push(path);
  return path;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
