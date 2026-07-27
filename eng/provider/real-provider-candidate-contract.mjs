import {
  assertWindowsSignedCandidateIdentity,
  WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY
} from "../release/windows-signed-candidate-contract.mjs";

export function readRealProviderCandidateConfig(environment) {
  const sourceCommit = boundedOptionalValue(environment.PI67_REAL_PROVIDER_SOURCE_COMMIT, 64);
  if (sourceCommit !== undefined && !/^[0-9a-f]{40}$/u.test(sourceCommit)) {
    throw new Error("PI67_REAL_PROVIDER_SOURCE_COMMIT must be a full lowercase Git commit.");
  }
  const sourceTag = boundedOptionalValue(environment.PI67_REAL_PROVIDER_SOURCE_TAG, 256);
  const candidateIdentityPath = boundedOptionalValue(
    environment.PI67_REAL_PROVIDER_CANDIDATE_IDENTITY,
    4_096
  );
  const expectedRepository = boundedOptionalValue(
    environment.PI67_REAL_PROVIDER_EXPECTED_REPOSITORY,
    256
  );
  if (expectedRepository !== undefined
    && !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(expectedRepository)) {
    throw new Error("PI67_REAL_PROVIDER_EXPECTED_REPOSITORY must be an owner/repository identity.");
  }
  const candidateRunId = boundedOptionalValue(
    environment.PI67_REAL_PROVIDER_CANDIDATE_RUN_ID,
    32
  );
  const candidateRunAttempt = boundedOptionalValue(
    environment.PI67_REAL_PROVIDER_CANDIDATE_RUN_ATTEMPT,
    16
  );
  for (const [name, value] of [
    ["PI67_REAL_PROVIDER_CANDIDATE_RUN_ID", candidateRunId],
    ["PI67_REAL_PROVIDER_CANDIDATE_RUN_ATTEMPT", candidateRunAttempt]
  ]) {
    if (value !== undefined && !/^[1-9][0-9]*$/u.test(value)) {
      throw new Error(`${name} must contain positive decimal digits.`);
    }
  }
  const expectedSignerThumbprint = boundedOptionalValue(
    environment.PI67_REAL_PROVIDER_EXPECTED_SIGNER_THUMBPRINT,
    40
  );
  if (expectedSignerThumbprint !== undefined && !/^[0-9A-Fa-f]{40}$/u.test(expectedSignerThumbprint)) {
    throw new Error("PI67_REAL_PROVIDER_EXPECTED_SIGNER_THUMBPRINT must contain 40 hexadecimal characters.");
  }
  const candidateSourcePolicy = boundedOptionalValue(
    environment.PI67_REAL_PROVIDER_CANDIDATE_SOURCE_POLICY,
    32
  );
  if (candidateSourcePolicy !== undefined
    && !Object.values(WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY).includes(candidateSourcePolicy)) {
    throw new Error("PI67_REAL_PROVIDER_CANDIDATE_SOURCE_POLICY is not supported.");
  }
  const requireCandidateIdentity = environment.PI67_REAL_PROVIDER_REQUIRE_CANDIDATE_IDENTITY === "1";
  if (requireCandidateIdentity && (
    !sourceCommit
    || !sourceTag
    || !candidateIdentityPath
    || !expectedRepository
    || !candidateRunId
    || !candidateRunAttempt
    || !candidateSourcePolicy
    || !expectedSignerThumbprint
  )) {
    throw new Error(
      "Formal Provider certification requires one complete signed candidate authority."
    );
  }
  return {
    candidateIdentityPath,
    candidateRunAttempt,
    candidateRunId,
    candidateSourcePolicy,
    expectedRepository,
    expectedSignerThumbprint: expectedSignerThumbprint?.toUpperCase(),
    requireCandidateIdentity,
    sourceCommit,
    sourceTag
  };
}

export function createRealProviderCandidateEvidence({
  appVersion,
  candidateIdentity,
  candidateIdentitySha256,
  candidateSourcePolicy,
  executableSha256,
  sourceCommit,
  sourceTag
}) {
  if (candidateIdentity === undefined && candidateIdentitySha256 === undefined) return null;
  if (!candidateIdentity || !/^[0-9a-f]{64}$/u.test(candidateIdentitySha256 ?? "")) {
    throw new Error("Provider certification requires a hashed Windows signed candidate identity.");
  }
  assertWindowsSignedCandidateIdentity(candidateIdentity, {
    packagedExecutableSha256: executableSha256,
    sourceCommit,
    sourcePolicy: candidateSourcePolicy ?? WINDOWS_SIGNED_CANDIDATE_SOURCE_POLICY.versionTag,
    sourceTag,
    version: appVersion
  });
  return {
    schema: candidateIdentity.schema,
    identitySha256: candidateIdentitySha256,
    repository: candidateIdentity.repository,
    workflow: candidateIdentity.workflow,
    source: {
      policy: candidateIdentity.source.policy,
      tag: candidateIdentity.source.tag,
      commit: candidateIdentity.source.commit
    },
    application: {
      version: candidateIdentity.application.version,
      runtime: candidateIdentity.application.runtime
    },
    installer: {
      fileName: candidateIdentity.installer.fileName,
      byteLength: candidateIdentity.installer.byteLength,
      sha256: candidateIdentity.installer.sha256
    },
    packagedExecutable: {
      fileName: candidateIdentity.packagedExecutable.fileName,
      byteLength: candidateIdentity.packagedExecutable.byteLength,
      sha256: candidateIdentity.packagedExecutable.sha256
    },
    signerThumbprint: candidateIdentity.installer.authenticode.signerThumbprint
  };
}

function boundedOptionalValue(value, limit) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string"
    || value.length > limit
    || value.includes("\r")
    || value.includes("\n")
    || value.includes("\u0000")) {
    throw new Error("Provider candidate configuration contains an invalid bounded value.");
  }
  return value;
}
