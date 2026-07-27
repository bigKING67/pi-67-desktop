import {
  assertSameArtifactBytes,
  assertWindowsArtifactSigner,
  readWindowsArtifactIdentity
} from "./windows-artifact-identity.mjs";
import {
  hashWindowsSignedCandidateIdentity,
  readWindowsSignedCandidateIdentity
} from "../release/windows-signed-candidate-identity.mjs";

export async function readWindowsNativeCandidateBinding({
  candidateIdentityPath,
  executablePath,
  expectedRepository,
  expectedRunAttempt,
  expectedRunId,
  expectedSignerThumbprint,
  expectedSourceCommit,
  expectedSourceTag,
  installerPath
}) {
  const identity = await readWindowsSignedCandidateIdentity(candidateIdentityPath, {
    repository: expectedRepository,
    sourceTag: expectedSourceTag,
    sourceCommit: expectedSourceCommit,
    runId: expectedRunId,
    runAttempt: expectedRunAttempt,
    expectedSignerThumbprint
  });
  const [installer, executable] = await Promise.all([
    readWindowsArtifactIdentity(installerPath),
    readWindowsArtifactIdentity(executablePath)
  ]);
  assertWindowsArtifactSigner(installer, expectedSignerThumbprint, "Windows native candidate installer");
  assertSameArtifactBytes(installer, identity.installer, "Windows native candidate installer");
  assertWindowsArtifactSigner(executable, expectedSignerThumbprint, "Windows native candidate executable");
  assertSameArtifactBytes(executable, identity.packagedExecutable, "Windows native candidate executable");
  return {
    artifactIdentity: executable,
    candidate: candidateBindingFromIdentity(
      identity,
      await hashWindowsSignedCandidateIdentity(candidateIdentityPath)
    )
  };
}

export function candidateBindingFromIdentity(identity, identitySha256) {
  return {
    identitySha256,
    repository: identity.repository,
    source: identity.source,
    workflow: identity.workflow,
    version: identity.application.version,
    installerSha256: identity.installer.sha256,
    packagedExecutableSha256: identity.packagedExecutable.sha256,
    signerThumbprint: identity.packagedExecutable.authenticode.signerThumbprint
  };
}

export function candidateBindingsMatch(actual, expected) {
  return actual?.identitySha256 === expected?.identitySha256
    && actual?.repository === expected?.repository
    && actual?.source?.policy === expected?.source?.policy
    && actual?.source?.tag === expected?.source?.tag
    && actual?.source?.commit === expected?.source?.commit
    && actual?.workflow?.runId === expected?.workflow?.runId
    && actual?.workflow?.runAttempt === expected?.workflow?.runAttempt
    && actual?.version === expected?.version
    && actual?.installerSha256 === expected?.installerSha256
    && actual?.packagedExecutableSha256 === expected?.packagedExecutableSha256
    && actual?.signerThumbprint === expected?.signerThumbprint;
}
