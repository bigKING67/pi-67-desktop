import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repositoryRoot, resolvePackagedArtifact } from "./packaged-electron-fixture.mjs";
import {
  validateWindowsNativeCertificationReceipts,
  WINDOWS_NATIVE_CERTIFICATION_SCALES
} from "./windows-native-certification-contract.mjs";
import {
  normalizeWindowsSignerThumbprint
} from "./windows-artifact-identity.mjs";
import {
  readWindowsNativeCandidateBinding
} from "./windows-native-candidate-binding.mjs";

export {
  validateWindowsNativeCertificationReceipts
} from "./windows-native-certification-contract.mjs";

const MAX_RECEIPT_BYTES = 1024 * 1024;
const certificationRoot = join(repositoryRoot, "artifacts/certification/windows-native");

export async function verifyWindowsNativeCertification({
  candidateIdentityPath,
  executablePath,
  expectedCandidateRunAttempt,
  expectedCandidateRunId,
  expectedRepository,
  expectedSignerThumbprint,
  expectedSourceCommit,
  expectedSourceTag,
  installerPath,
  root = certificationRoot
}) {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(`Windows native receipt verification requires win32/x64, got ${process.platform}/${process.arch}.`);
  }
  const signerThumbprint = normalizeWindowsSignerThumbprint(expectedSignerThumbprint);
  const resolvedExecutable = executablePath
    ? resolve(executablePath)
    : resolvePackagedArtifact("win32", "x64").executablePath;
  const candidateBinding = await readWindowsNativeCandidateBinding({
    candidateIdentityPath,
    executablePath: resolvedExecutable,
    expectedRepository,
    expectedRunAttempt: expectedCandidateRunAttempt,
    expectedRunId: expectedCandidateRunId,
    expectedSignerThumbprint: signerThumbprint,
    expectedSourceCommit,
    expectedSourceTag,
    installerPath
  });
  const artifactIdentity = candidateBinding.artifactIdentity;
  const receipts = [];
  for (const scale of WINDOWS_NATIVE_CERTIFICATION_SCALES) {
    const label = String(Math.round(scale * 100));
    const directory = join(root, `scale-${label}`);
    const receipt = JSON.parse(await readBoundedReceipt(join(directory, "receipt.json")));
    const screenshotPath = join(directory, "workspace.png");
    const screenshotSha256 = await hashFile(screenshotPath);
    if (receipt?.screenshot?.sha256 !== screenshotSha256) {
      throw new Error(`Windows native scale ${label} screenshot SHA-256 mismatch.`);
    }
    receipts.push(receipt);
  }

  const failures = validateWindowsNativeCertificationReceipts(
    receipts,
    artifactIdentity,
    candidateBinding.candidate
  );
  if (failures.length > 0) {
    throw new Error(`Windows native certification failed:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  }

  const summary = {
    schemaVersion: 1,
    status: "passed",
    evidenceLevel: "windows-native-dpi-ime-sleep-certification-set",
    scales: WINDOWS_NATIVE_CERTIFICATION_SCALES,
    executableName: basename(resolvedExecutable),
    executableByteLength: artifactIdentity.byteLength,
    executableSha256: artifactIdentity.sha256,
    authenticodeSignerThumbprint: signerThumbprint,
    candidate: candidateBinding.candidate,
    sleepScale: receipts.find((receipt) => receipt.sleep?.observed)?.expectedScale
  };
  await writeFile(join(root, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  console.log("Verified Windows native 125%/150%/200% DPI, trusted IME, real sleep/resume, and shutdown receipts.");
  return summary;
}

export function parseWindowsNativeVerificationArguments(argumentsList) {
  let candidateIdentityPath;
  let executablePath;
  let expectedCandidateRunAttempt;
  let expectedCandidateRunId;
  let expectedRepository;
  let expectedSignerThumbprint;
  let expectedSourceCommit;
  let expectedSourceTag;
  let installerPath;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--candidate-identity") candidateIdentityPath = argumentsList[++index];
    else if (argument === "--executable") {
      executablePath = argumentsList[++index];
      if (executablePath === undefined) throw new Error("--executable requires a path.");
    } else if (argument === "--expected-signer-thumbprint") {
      expectedSignerThumbprint = argumentsList[++index];
      if (expectedSignerThumbprint === undefined) {
        throw new Error("--expected-signer-thumbprint requires a value.");
      }
    } else if (argument === "--installer") installerPath = argumentsList[++index];
    else if (argument === "--expected-repository") expectedRepository = argumentsList[++index];
    else if (argument === "--expected-source-tag") expectedSourceTag = argumentsList[++index];
    else if (argument === "--expected-source-commit") expectedSourceCommit = argumentsList[++index];
    else if (argument === "--expected-candidate-run-id") expectedCandidateRunId = argumentsList[++index];
    else if (argument === "--expected-candidate-run-attempt") {
      expectedCandidateRunAttempt = argumentsList[++index];
    } else {
      throw new Error(`Unknown Windows native verification argument: ${String(argument)}.`);
    }
  }
  if (executablePath !== undefined && (
    executablePath.length === 0
    || executablePath.includes("\r")
    || executablePath.includes("\n")
    || executablePath.includes("\u0000")
  )) throw new Error("--executable must be a non-empty single-line path.");
  for (const [name, value] of [
    ["--candidate-identity", candidateIdentityPath],
    ["--installer", installerPath],
    ["--expected-repository", expectedRepository],
    ["--expected-source-tag", expectedSourceTag],
    ["--expected-source-commit", expectedSourceCommit],
    ["--expected-candidate-run-id", expectedCandidateRunId],
    ["--expected-candidate-run-attempt", expectedCandidateRunAttempt]
  ]) {
    if (typeof value !== "string"
      || value.length === 0
      || value.includes("\r")
      || value.includes("\n")
      || value.includes("\u0000")) {
      throw new Error(`${name} requires a non-empty single-line value.`);
    }
  }
  return {
    candidateIdentityPath,
    executablePath,
    expectedCandidateRunAttempt,
    expectedCandidateRunId,
    expectedRepository,
    expectedSignerThumbprint: normalizeWindowsSignerThumbprint(expectedSignerThumbprint),
    expectedSourceCommit,
    expectedSourceTag,
    installerPath
  };
}

async function readBoundedReceipt(path) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > MAX_RECEIPT_BYTES) {
    throw new Error(`${path} exceeds the Windows native receipt boundary.`);
  }
  return readFile(path, "utf8");
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyWindowsNativeCertification(
    parseWindowsNativeVerificationArguments(process.argv.slice(2))
  );
}
