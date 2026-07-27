import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertWindowsSignedCandidateArtifactIdentities,
  parseWindowsSignedCandidateVerificationArguments,
  verifyWindowsSignedCandidateFiles
} from "./windows-signed-candidate-verification.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { force: true, recursive: true })
  )));
});

describe("Windows signed candidate file verification", () => {
  it("binds the downloaded installer bytes to source, workflow, and Publisher identity", async () => {
    const directory = await temporaryDirectory();
    const installerPath = join(directory, "Pi-67-Desktop-1.2.3-win-x64.exe");
    const identityPath = join(directory, "windows-signed-candidate-identity.json");
    const installer = Buffer.from("signed-installer-fixture");
    await writeFile(installerPath, installer);
    await writeFile(identityPath, `${JSON.stringify(identity(installer), null, 2)}\n`);

    const result = await verifyWindowsSignedCandidateFiles({
      ...expectedArguments(),
      candidateIdentityPath: identityPath,
      installerPath
    });

    expect(result.installerIdentity).toEqual({
      byteLength: installer.byteLength,
      sha256: sha256(installer)
    });
    expect(result.identitySha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("rejects filename and byte drift", async () => {
    const directory = await temporaryDirectory();
    const identityPath = join(directory, "windows-signed-candidate-identity.json");
    const installer = Buffer.from("signed-installer-fixture");
    await writeFile(identityPath, `${JSON.stringify(identity(installer), null, 2)}\n`);
    const wrongNamePath = join(directory, "renamed.exe");
    await writeFile(wrongNamePath, installer);
    await expect(verifyWindowsSignedCandidateFiles({
      ...expectedArguments(),
      candidateIdentityPath: identityPath,
      installerPath: wrongNamePath
    })).rejects.toThrow("filename");

    const installerPath = join(directory, "Pi-67-Desktop-1.2.3-win-x64.exe");
    await writeFile(installerPath, "different bytes");
    await expect(verifyWindowsSignedCandidateFiles({
      ...expectedArguments(),
      candidateIdentityPath: identityPath,
      installerPath
    })).rejects.toThrow("bytes do not match");
  });

  it("parses a complete fail-closed CLI contract", () => {
    expect(parseWindowsSignedCandidateVerificationArguments([
      "--candidate-identity", "candidate.json",
      "--installer", "installer.exe",
      "--expected-repository", "bigKING67/pi-67-desktop",
      "--expected-source-tag", "v1.2.3",
      "--expected-source-commit", "a".repeat(40),
      "--expected-run-id", "123",
      "--expected-run-attempt", "1",
      "--expected-signer", "E".repeat(40)
    ])).toEqual({
      candidateIdentityPath: "candidate.json",
      expectedRepository: "bigKING67/pi-67-desktop",
      expectedRunAttempt: "1",
      expectedRunId: "123",
      expectedSignerThumbprint: "E".repeat(40),
      expectedSourceCommit: "a".repeat(40),
      expectedSourceTag: "v1.2.3",
      installerPath: "installer.exe",
      packagedExecutablePath: undefined,
      sourcePolicy: "stable"
    });
    expect(() => parseWindowsSignedCandidateVerificationArguments([]))
      .toThrow("--candidate-identity");
    expect(() => parseWindowsSignedCandidateVerificationArguments([
      ...candidateCliArguments(),
      "--unknown", "value"
    ])).toThrow("Invalid Windows signed candidate verification argument");
  });

  it("revalidates installer and packaged executable bytes plus Publisher identity", () => {
    const candidate = identity(Buffer.from("signed-installer-fixture"));
    const installerIdentity = {
      ...candidate.installer,
      authenticode: candidate.installer.authenticode
    };
    const packagedExecutableIdentity = {
      ...candidate.packagedExecutable,
      authenticode: candidate.packagedExecutable.authenticode
    };

    expect(() => assertWindowsSignedCandidateArtifactIdentities({
      expectedSignerThumbprint: "E".repeat(40),
      identity: candidate,
      installerIdentity,
      packagedExecutableIdentity
    })).not.toThrow();

    expect(() => assertWindowsSignedCandidateArtifactIdentities({
      expectedSignerThumbprint: "E".repeat(40),
      identity: candidate,
      installerIdentity,
      packagedExecutableIdentity: {
        ...packagedExecutableIdentity,
        sha256: "f".repeat(64)
      }
    })).toThrow("packaged executable bytes do not match");
  });
});

function expectedArguments() {
  return {
    expectedRepository: "bigKING67/pi-67-desktop",
    expectedRunAttempt: "1",
    expectedRunId: "123",
    expectedSignerThumbprint: "E".repeat(40),
    expectedSourceCommit: "a".repeat(40),
    expectedSourceTag: "v1.2.3"
  };
}

function candidateCliArguments() {
  return [
    "--candidate-identity", "candidate.json",
    "--installer", "installer.exe",
    "--expected-repository", "bigKING67/pi-67-desktop",
    "--expected-source-tag", "v1.2.3",
    "--expected-source-commit", "a".repeat(40),
    "--expected-run-id", "123",
    "--expected-run-attempt", "1",
    "--expected-signer", "E".repeat(40)
  ];
}

function identity(installer) {
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
    packagedExecutable: signedFile(
      "win-unpacked/Pi-67 Desktop.exe",
      100,
      "c".repeat(64)
    )
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

async function temporaryDirectory() {
  const path = await mkdtemp(join(tmpdir(), "pi67-candidate-verification-"));
  temporaryDirectories.push(path);
  return path;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
