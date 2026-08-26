import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyWindowsPreviewCandidateFiles } from "./windows-preview-candidate.mjs";

export const WINDOWS_PREVIEW_MANUAL_TEST_SCHEMA = "pi67.windows-preview-manual-test.v1";
export const WINDOWS_PREVIEW_OPERATOR_MANUAL_TEST_SCHEMA = "pi67.windows-preview-manual-test.v2";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const MAX_METADATA_BYTES = 1024 * 1024;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;
const FULL_COMMIT = /^[a-f0-9]{40}$/u;

export async function verifyWindowsPreviewPromotion({
  actor,
  candidateIdentityPath,
  candidateRunAttempt,
  candidateRunId,
  candidateRunMetadataPath,
  installerPath,
  outputPath,
  packagedExecutablePath,
  promotionRunAttempt,
  promotionRunId,
  repository,
  sourceCommit
}) {
  const candidate = await verifyWindowsPreviewCandidateFiles({
    candidateIdentityPath,
    expectedRepository: repository,
    expectedRunAttempt: candidateRunAttempt,
    expectedRunId: candidateRunId,
    expectedSourceCommit: sourceCommit,
    installerPath,
    packagedExecutablePath
  });
  const run = await readBoundedJson(candidateRunMetadataPath, "candidate workflow metadata");
  const certificationRunAttempt = assertWindowsPreviewCandidateRun(
    run,
    { candidateRunAttempt, candidateRunId, repository }
  );
  const receipt = {
    schema: WINDOWS_PREVIEW_MANUAL_TEST_SCHEMA,
    status: "passed",
    evidenceLevel: "manual-windows-x64-test-confirmed",
    repository,
    source: { commit: sourceCommit },
    candidate: {
      identitySha256: candidate.identitySha256,
      runId: candidateRunId,
      runAttempt: candidateRunAttempt,
      certificationRunAttempt,
      installerSha256: candidate.identity.installer.sha256,
      packagedExecutableSha256: candidate.identity.packagedExecutable.sha256
    },
    attestation: { actor },
    promotion: { runId: promotionRunId, runAttempt: promotionRunAttempt }
  };
  assertWindowsPreviewManualTestReceipt(receipt, {
    candidateIdentitySha256: candidate.identitySha256,
    candidateCertificationRunAttempt: certificationRunAttempt,
    candidateRunAttempt,
    candidateRunId,
    repository,
    sourceCommit
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return { candidate, receipt };
}

export async function recordWindowsPreviewManualTest({
  actor,
  candidateIdentityPath,
  candidateRunAttempt,
  candidateRunId,
  candidateRunMetadataPath,
  installerPath,
  outputPath,
  packagedExecutablePath,
  repository,
  sourceCommit
}) {
  const candidate = await verifyWindowsPreviewCandidateFiles({
    candidateIdentityPath,
    expectedRepository: repository,
    expectedRunAttempt: candidateRunAttempt,
    expectedRunId: candidateRunId,
    expectedSourceCommit: sourceCommit,
    installerPath,
    packagedExecutablePath
  });
  const run = await readBoundedJson(candidateRunMetadataPath, "candidate workflow metadata");
  const certificationRunAttempt = assertWindowsPreviewCandidateRun(
    run,
    { candidateRunAttempt, candidateRunId, repository }
  );
  const receipt = {
    schema: WINDOWS_PREVIEW_OPERATOR_MANUAL_TEST_SCHEMA,
    status: "passed",
    evidenceLevel: "manual-windows-x64-test-confirmed",
    repository,
    source: { commit: sourceCommit },
    candidate: {
      identitySha256: candidate.identitySha256,
      runId: candidateRunId,
      runAttempt: candidateRunAttempt,
      certificationRunAttempt,
      installerSha256: candidate.identity.installer.sha256,
      packagedExecutableSha256: candidate.identity.packagedExecutable.sha256
    },
    attestation: { actor, channel: "operator-confirmed" }
  };
  assertWindowsPreviewManualTestReceipt(receipt, {
    candidateIdentitySha256: candidate.identitySha256,
    candidateCertificationRunAttempt: certificationRunAttempt,
    candidateRunAttempt,
    candidateRunId,
    repository,
    sourceCommit
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return { candidate, receipt };
}

export function assertWindowsPreviewManualTestReceipt(value, expected = {}) {
  const failures = [];
  const isPromotionReceipt = value?.schema === WINDOWS_PREVIEW_MANUAL_TEST_SCHEMA;
  const isOperatorReceipt = value?.schema === WINDOWS_PREVIEW_OPERATOR_MANUAL_TEST_SCHEMA;
  if ((!isPromotionReceipt && !isOperatorReceipt)
    || value?.status !== "passed"
    || value?.evidenceLevel !== "manual-windows-x64-test-confirmed") {
    failures.push("invalid manual test status");
  }
  if (typeof value?.repository !== "string" || !value.repository.includes("/")) failures.push("invalid repository");
  if (!FULL_COMMIT.test(value?.source?.commit ?? "")) failures.push("invalid source commit");
  for (const [label, field] of [
    ["candidate run ID", value?.candidate?.runId],
    ["candidate run attempt", value?.candidate?.runAttempt]
  ]) {
    if (!POSITIVE_INTEGER.test(field ?? "")) failures.push(`invalid ${label}`);
  }
  const certificationRunAttempt = value?.candidate?.certificationRunAttempt;
  if (certificationRunAttempt !== undefined) {
    if (!POSITIVE_INTEGER.test(certificationRunAttempt)) {
      failures.push("invalid candidate certification run attempt");
    } else if (POSITIVE_INTEGER.test(value?.candidate?.runAttempt ?? "")
      && BigInt(certificationRunAttempt) < BigInt(value.candidate.runAttempt)) {
      failures.push("candidate certification run attempt predates build attempt");
    }
  }
  if (isPromotionReceipt) {
    for (const [label, field] of [
      ["promotion run ID", value?.promotion?.runId],
      ["promotion run attempt", value?.promotion?.runAttempt]
    ]) {
      if (!POSITIVE_INTEGER.test(field ?? "")) failures.push(`invalid ${label}`);
    }
  } else if (isOperatorReceipt) {
    if (value?.attestation?.channel !== "operator-confirmed") {
      failures.push("invalid operator attestation channel");
    }
    if (value?.promotion !== undefined) failures.push("operator receipt must not claim a promotion run");
  }
  for (const [label, field] of [
    ["candidate identity", value?.candidate?.identitySha256],
    ["installer", value?.candidate?.installerSha256],
    ["packaged executable", value?.candidate?.packagedExecutableSha256]
  ]) {
    if (!/^[a-f0-9]{64}$/u.test(field ?? "")) failures.push(`invalid ${label} SHA-256`);
  }
  if (typeof value?.attestation?.actor !== "string"
    || value.attestation.actor.length === 0
    || value.attestation.actor.length > 100
    || value.attestation.actor.includes("\r")
    || value.attestation.actor.includes("\n")
    || value.attestation.actor.includes("\u0000")) {
    failures.push("invalid attesting actor");
  }
  for (const [label, actual, wanted] of [
    ["repository", value?.repository, expected.repository],
    ["source commit", value?.source?.commit, expected.sourceCommit],
    ["candidate run ID", value?.candidate?.runId, expected.candidateRunId],
    ["candidate run attempt", value?.candidate?.runAttempt, expected.candidateRunAttempt],
    [
      "candidate certification run attempt",
      value?.candidate?.certificationRunAttempt,
      expected.candidateCertificationRunAttempt
    ],
    ["candidate identity", value?.candidate?.identitySha256, expected.candidateIdentitySha256]
  ]) {
    if (wanted !== undefined && actual !== wanted) failures.push(`${label} mismatch`);
  }
  if (failures.length > 0) {
    throw new Error(`Windows preview manual test receipt is invalid:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  }
  return value;
}

export function assertWindowsPreviewCandidateRun(run, expected) {
  const failures = [];
  if (String(run?.id) !== expected.candidateRunId) failures.push("run ID mismatch");
  const candidateRunAttempt = String(expected.candidateRunAttempt);
  const certificationRunAttempt = String(run?.run_attempt);
  if (!POSITIVE_INTEGER.test(candidateRunAttempt)) {
    failures.push("invalid candidate build run attempt");
  }
  if (!POSITIVE_INTEGER.test(certificationRunAttempt)) {
    failures.push("invalid certification run attempt");
  } else if (POSITIVE_INTEGER.test(candidateRunAttempt)
    && BigInt(certificationRunAttempt) < BigInt(candidateRunAttempt)) {
    failures.push("certification run attempt predates candidate build attempt");
  }
  if (run?.name !== "Windows candidate") failures.push("unexpected workflow name");
  if (run?.event !== "workflow_dispatch") failures.push("unexpected workflow event");
  if (run?.status !== "completed" || run?.conclusion !== "success") failures.push("candidate workflow did not succeed");
  if (run?.repository?.full_name !== expected.repository) failures.push("repository mismatch");
  if (failures.length > 0) {
    throw new Error(`Windows candidate workflow run is invalid:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  }
  return certificationRunAttempt;
}

async function readBoundedJson(path, label) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_METADATA_BYTES) {
    throw new Error(`Windows preview ${label} is not a bounded regular file.`);
  }
  return JSON.parse(await readFile(path, "utf8"));
}

function parseArguments(argumentsList) {
  if (argumentsList.length % 2 !== 0) throw new Error("Windows preview promotion arguments are incomplete.");
  const allowed = new Set([
    "--actor",
    "--candidate-identity",
    "--candidate-run-attempt",
    "--candidate-run-id",
    "--candidate-run-metadata",
    "--installer",
    "--output",
    "--packaged-executable",
    "--promotion-run-attempt",
    "--promotion-run-id",
    "--repository",
    "--source-commit"
  ]);
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    if (!allowed.has(name) || values.has(name)) throw new Error(`Invalid Windows preview promotion argument: ${name}.`);
    values.set(name, argumentsList[index + 1]);
  }
  return values;
}

function requiredArgument(values, name) {
  const value = values.get(name);
  if (typeof value !== "string"
    || value.length === 0
    || value.includes("\r")
    || value.includes("\n")
    || value.includes("\u0000")) {
    throw new Error(`${name} requires a non-empty single-line value.`);
  }
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const values = parseArguments(process.argv.slice(2));
  const result = await verifyWindowsPreviewPromotion({
    actor: requiredArgument(values, "--actor"),
    candidateIdentityPath: requiredArgument(values, "--candidate-identity"),
    candidateRunAttempt: requiredArgument(values, "--candidate-run-attempt"),
    candidateRunId: requiredArgument(values, "--candidate-run-id"),
    candidateRunMetadataPath: requiredArgument(values, "--candidate-run-metadata"),
    installerPath: requiredArgument(values, "--installer"),
    outputPath: requiredArgument(values, "--output"),
    packagedExecutablePath: requiredArgument(values, "--packaged-executable"),
    promotionRunAttempt: requiredArgument(values, "--promotion-run-attempt"),
    promotionRunId: requiredArgument(values, "--promotion-run-id"),
    repository: requiredArgument(values, "--repository"),
    sourceCommit: requiredArgument(values, "--source-commit")
  });
  console.log(
    `Bound manual Windows test confirmation to candidate ${result.receipt.candidate.identitySha256} `
    + `at ${relative(repositoryRoot, requiredArgument(values, "--output"))}.`
  );
}
