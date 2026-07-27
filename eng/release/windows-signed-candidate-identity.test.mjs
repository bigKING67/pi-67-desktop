import { describe, expect, it } from "vitest";
import {
  assertWindowsSignedCandidateIdentity,
  WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY
} from "./windows-signed-candidate-identity.mjs";

describe("Windows signed release candidate identity", () => {
  it("binds stable source, workflow, runtime, signed installer, and packaged executable", () => {
    const identity = fixtureIdentity();
    expect(() => assertWindowsSignedCandidateIdentity(identity, {
      repository: "bigKING67/pi-67-desktop",
      sourceTag: "v1.2.3",
      sourceCommit: "a".repeat(40),
      runId: "123",
      runAttempt: "1",
      version: "1.2.3",
      expectedSignerThumbprint: "E".repeat(40)
    })).not.toThrow();
  });

  it("keeps stable release policy closed while allowing explicit version-tag certification", () => {
    const stablePrerelease = fixtureIdentity();
    stablePrerelease.source.tag = "v1.2.3-alpha.1";
    stablePrerelease.application.version = "1.2.3-alpha.1";
    expect(() => assertWindowsSignedCandidateIdentity(stablePrerelease))
      .toThrow("Invalid canonical candidate source tag");

    const certificationPrerelease = fixtureIdentity();
    certificationPrerelease.source.policy = WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY.versionTag;
    certificationPrerelease.source.tag = "v1.2.3-alpha.1";
    certificationPrerelease.application.version = "1.2.3-alpha.1";
    expect(() => assertWindowsSignedCandidateIdentity(certificationPrerelease, {
      sourcePolicy: WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY.versionTag,
      version: "1.2.3-alpha.1"
    })).not.toThrow();

    const wrongPolicy = fixtureIdentity();
    expect(() => assertWindowsSignedCandidateIdentity(wrongPolicy, {
      sourcePolicy: WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY.versionTag
    })).toThrow("source policy does not match");
  });

  it("rejects signer drift and expected source drift", () => {

    const signerDrift = fixtureIdentity();
    signerDrift.packagedExecutable.authenticode.signerThumbprint = "D".repeat(40);
    expect(() => assertWindowsSignedCandidateIdentity(signerDrift)).toThrow("signer identities differ");

    expect(() => assertWindowsSignedCandidateIdentity(fixtureIdentity(), {
      sourceCommit: "f".repeat(40)
    })).toThrow("does not match the active authority");
  });

  it("rejects installer traversal and packaged executable path drift", () => {
    const installerTraversal = fixtureIdentity();
    installerTraversal.installer.fileName = "../Pi-67-Desktop-1.2.3-win-x64.exe";
    expect(() => assertWindowsSignedCandidateIdentity(installerTraversal))
      .toThrow("installer.fileName must be a basename");

    const executableDrift = fixtureIdentity();
    executableDrift.packagedExecutable.fileName = "other/Pi-67 Desktop.exe";
    expect(() => assertWindowsSignedCandidateIdentity(executableDrift))
      .toThrow("packagedExecutable.fileName is invalid");
  });
});

function fixtureIdentity() {
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
