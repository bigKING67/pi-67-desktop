import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSameArtifactBytes,
  assertWindowsArtifactSigner,
  readWindowsArtifactIdentity,
  readFileByteIdentity
} from "../packaging/windows-artifact-identity.mjs";
import {
  hashWindowsSignedCandidateIdentity,
  readWindowsSignedCandidateIdentity,
  WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY
} from "./windows-signed-candidate-identity.mjs";

export async function verifyWindowsSignedCandidateFiles({
  candidateIdentityPath,
  expectedRepository,
  expectedRunAttempt,
  expectedRunId,
  expectedSignerThumbprint,
  expectedSourceCommit,
  expectedSourceTag,
  installerPath,
  packagedExecutablePath,
  sourcePolicy = WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY.stable
}) {
  const identity = await readWindowsSignedCandidateIdentity(candidateIdentityPath, {
    expectedSignerThumbprint,
    repository: expectedRepository,
    runAttempt: expectedRunAttempt,
    runId: expectedRunId,
    sourcePolicy,
    sourceCommit: expectedSourceCommit,
    sourceTag: expectedSourceTag
  });
  if (basename(installerPath) !== identity.installer.fileName) {
    throw new Error("Windows signed candidate installer filename does not match its identity.");
  }
  if (packagedExecutablePath !== undefined
    && basename(packagedExecutablePath) !== "Pi-67 Desktop.exe") {
    throw new Error("Windows signed candidate packaged executable filename is invalid.");
  }
  const [installerIdentity, packagedExecutableIdentity] = await Promise.all([
    packagedExecutablePath === undefined
      ? readFileByteIdentity(installerPath)
      : readWindowsArtifactIdentity(installerPath),
    packagedExecutablePath === undefined
      ? undefined
      : readWindowsArtifactIdentity(packagedExecutablePath)
  ]);
  assertWindowsSignedCandidateArtifactIdentities({
    expectedSignerThumbprint,
    identity,
    installerIdentity,
    packagedExecutableIdentity
  });
  return {
    identity,
    identitySha256: await hashWindowsSignedCandidateIdentity(candidateIdentityPath),
    installerIdentity,
    packagedExecutableIdentity
  };
}

export function assertWindowsSignedCandidateArtifactIdentities({
  expectedSignerThumbprint,
  identity,
  installerIdentity,
  packagedExecutableIdentity
}) {
  assertSameArtifactBytes(
    installerIdentity,
    identity.installer,
    "Windows signed candidate installer"
  );
  if (installerIdentity.authenticode !== undefined) {
    assertWindowsArtifactSigner(
      installerIdentity,
      expectedSignerThumbprint,
      "Windows signed candidate installer"
    );
  }
  if (packagedExecutableIdentity !== undefined) {
    assertSameArtifactBytes(
      packagedExecutableIdentity,
      identity.packagedExecutable,
      "Windows signed candidate packaged executable"
    );
    assertWindowsArtifactSigner(
      packagedExecutableIdentity,
      expectedSignerThumbprint,
      "Windows signed candidate packaged executable"
    );
  }
}

export function parseWindowsSignedCandidateVerificationArguments(argumentsList) {
  if (argumentsList.length % 2 !== 0) {
    throw new Error("Windows signed candidate verification arguments are incomplete.");
  }
  const allowed = new Set([
    "--candidate-identity",
    "--expected-source-policy",
    "--installer",
    "--packaged-executable",
    "--expected-repository",
    "--expected-source-tag",
    "--expected-source-commit",
    "--expected-run-id",
    "--expected-run-attempt",
    "--expected-signer"
  ]);
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!allowed.has(name) || values.has(name)) {
      throw new Error(`Invalid Windows signed candidate verification argument: ${name}.`);
    }
    values.set(name, value);
  }
  return {
    candidateIdentityPath: requiredArgument(values, "--candidate-identity"),
    expectedRepository: requiredArgument(values, "--expected-repository"),
    expectedRunAttempt: requiredArgument(values, "--expected-run-attempt"),
    expectedRunId: requiredArgument(values, "--expected-run-id"),
    expectedSignerThumbprint: requiredArgument(values, "--expected-signer"),
    expectedSourceCommit: requiredArgument(values, "--expected-source-commit"),
    expectedSourceTag: requiredArgument(values, "--expected-source-tag"),
    installerPath: requiredArgument(values, "--installer"),
    packagedExecutablePath: optionalArgument(values, "--packaged-executable"),
    sourcePolicy: optionalArgument(
      values,
      "--expected-source-policy",
      WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY.stable
    )
  };
}

function optionalArgument(values, name, fallback) {
  return values.get(name) ?? fallback;
}

function requiredArgument(values, name) {
  const value = values.get(name);
  if (typeof value !== "string"
    || value.length < 1
    || value.includes("\r")
    || value.includes("\n")
    || value.includes("\u0000")) {
    throw new Error(`${name} requires a non-empty single-line value.`);
  }
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyWindowsSignedCandidateFiles(
    parseWindowsSignedCandidateVerificationArguments(process.argv.slice(2))
  );
  console.log(
    `Verified Windows signed candidate ${result.identity.source.tag} `
    + `(${result.identitySha256}).`
  );
}
