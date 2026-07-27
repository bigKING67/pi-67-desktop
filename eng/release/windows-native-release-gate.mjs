import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileByteIdentity } from "../packaging/windows-artifact-identity.mjs";
import {
  validateWindowsNativeCertificationReceipts,
  WINDOWS_NATIVE_CERTIFICATION_SCALES
} from "../packaging/windows-native-certification-contract.mjs";
import {
  candidateBindingFromIdentity,
  candidateBindingsMatch
} from "../packaging/windows-native-candidate-binding.mjs";
import {
  verifyWindowsSignedCandidateFiles
} from "./windows-signed-candidate-verification.mjs";

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 50 * 1024 * 1024;
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export async function verifyWindowsNativeReleaseGate({
  candidateIdentityPath,
  certificationRoot,
  expectedRepository,
  expectedRunAttempt,
  expectedRunId,
  expectedSignerThumbprint,
  expectedSourceCommit,
  expectedSourceTag,
  installerPath,
  outputPath
}) {
  const candidateFiles = await verifyWindowsSignedCandidateFiles({
    candidateIdentityPath,
    expectedRepository,
    expectedRunAttempt,
    expectedRunId,
    expectedSignerThumbprint,
    expectedSourceCommit,
    expectedSourceTag,
    installerPath
  });
  const expectedCandidate = candidateBindingFromIdentity(
    candidateFiles.identity,
    candidateFiles.identitySha256
  );
  const expectedArtifact = {
    byteLength: candidateFiles.identity.packagedExecutable.byteLength,
    sha256: candidateFiles.identity.packagedExecutable.sha256,
    authenticode: candidateFiles.identity.packagedExecutable.authenticode
  };
  const summaryPath = join(certificationRoot, "summary.json");
  const summary = await readBoundedJson(summaryPath, "Windows native certification summary");
  const evidence = {};
  const receipts = [];
  for (const scale of WINDOWS_NATIVE_CERTIFICATION_SCALES) {
    const label = String(Math.round(scale * 100));
    const scaleDirectory = join(certificationRoot, `scale-${label}`);
    const receiptPath = join(scaleDirectory, "receipt.json");
    const screenshotPath = join(scaleDirectory, "workspace.png");
    const receipt = await readBoundedJson(receiptPath, `Windows native ${label}% receipt`);
    const [receiptIdentity, screenshotIdentity] = await Promise.all([
      readFileByteIdentity(receiptPath),
      readFileByteIdentity(screenshotPath)
    ]);
    if (screenshotIdentity.byteLength > MAX_SCREENSHOT_BYTES) {
      throw new Error(`Windows native ${label}% screenshot exceeds its file boundary.`);
    }
    if (receipt.screenshot?.sha256 !== screenshotIdentity.sha256) {
      throw new Error(`Windows native ${label}% screenshot SHA-256 mismatch.`);
    }
    receipts.push(receipt);
    evidence[label] = {
      receiptSha256: receiptIdentity.sha256,
      screenshotSha256: screenshotIdentity.sha256
    };
  }

  const failures = validateWindowsNativeReleaseGateEvidence({
    expectedArtifact,
    expectedCandidate,
    expectedExecutableName: basename(candidateFiles.identity.packagedExecutable.fileName),
    receipts,
    summary
  });
  if (failures.length > 0) {
    throw new Error(`Windows native release gate failed:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  }

  const summaryIdentity = await readFileByteIdentity(summaryPath);
  const gate = {
    schema: "pi67.windows-native-release-gate.v1",
    status: "passed",
    evidenceLevel: "release-bound-windows-native-certification",
    repository: candidateFiles.identity.repository,
    source: candidateFiles.identity.source,
    workflow: candidateFiles.identity.workflow,
    candidate: expectedCandidate,
    installer: {
      fileName: candidateFiles.identity.installer.fileName,
      ...candidateFiles.installerIdentity,
      signerThumbprint: candidateFiles.identity.installer.authenticode.signerThumbprint
    },
    packagedExecutable: {
      fileName: candidateFiles.identity.packagedExecutable.fileName,
      byteLength: expectedArtifact.byteLength,
      sha256: expectedArtifact.sha256,
      signerThumbprint: expectedArtifact.authenticode.signerThumbprint
    },
    certification: {
      summarySha256: summaryIdentity.sha256,
      scales: evidence,
      sleepScale: summary.sleepScale
    }
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(gate, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`Verified Windows native release gate: ${relative(repositoryRoot, outputPath)}.`);
  return gate;
}

export function validateWindowsNativeReleaseGateEvidence({
  expectedArtifact,
  expectedCandidate,
  expectedExecutableName,
  receipts,
  summary
}) {
  const failures = validateWindowsNativeCertificationReceipts(
    receipts,
    expectedArtifact,
    expectedCandidate
  );
  if (summary?.schemaVersion !== 1
    || summary?.status !== "passed"
    || summary?.evidenceLevel !== "windows-native-dpi-ime-sleep-certification-set") {
    failures.push("certification summary identity is invalid");
  }
  if (!sameScales(summary?.scales, WINDOWS_NATIVE_CERTIFICATION_SCALES)) {
    failures.push("certification summary scales are invalid");
  }
  if (!candidateBindingsMatch(summary?.candidate, expectedCandidate)) {
    failures.push("certification summary candidate identity is invalid");
  }
  if (summary?.executableName !== expectedExecutableName
    || summary?.executableByteLength !== expectedArtifact.byteLength
    || summary?.executableSha256 !== expectedArtifact.sha256
    || summary?.authenticodeSignerThumbprint !== expectedArtifact.authenticode.signerThumbprint) {
    failures.push("certification summary executable identity is invalid");
  }
  const sleepReceipt = receipts.find((receipt) => receipt?.sleep?.observed === true);
  if (summary?.sleepScale !== sleepReceipt?.expectedScale) {
    failures.push("certification summary sleep scale is invalid");
  }
  return failures;
}

function sameScales(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

async function readBoundedJson(path, label) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_JSON_BYTES) {
    throw new Error(`${label} exceeds its file boundary.`);
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

export function parseWindowsNativeReleaseGateArguments(argumentsList) {
  if (argumentsList.length % 2 !== 0) {
    throw new Error("Windows native release gate arguments are incomplete.");
  }
  const allowed = new Set([
    "--candidate-identity",
    "--certification-root",
    "--installer",
    "--expected-repository",
    "--expected-source-tag",
    "--expected-source-commit",
    "--expected-run-id",
    "--expected-run-attempt",
    "--expected-signer",
    "--output"
  ]);
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!allowed.has(name) || values.has(name)) {
      throw new Error(`Invalid Windows native release gate argument: ${name}.`);
    }
    values.set(name, value);
  }
  return {
    candidateIdentityPath: requiredArgument(values, "--candidate-identity"),
    certificationRoot: requiredArgument(values, "--certification-root"),
    expectedRepository: requiredArgument(values, "--expected-repository"),
    expectedRunAttempt: requiredArgument(values, "--expected-run-attempt"),
    expectedRunId: requiredArgument(values, "--expected-run-id"),
    expectedSignerThumbprint: requiredArgument(values, "--expected-signer"),
    expectedSourceCommit: requiredArgument(values, "--expected-source-commit"),
    expectedSourceTag: requiredArgument(values, "--expected-source-tag"),
    installerPath: requiredArgument(values, "--installer"),
    outputPath: requiredArgument(values, "--output")
  };
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
  await verifyWindowsNativeReleaseGate(
    parseWindowsNativeReleaseGateArguments(process.argv.slice(2))
  );
}
