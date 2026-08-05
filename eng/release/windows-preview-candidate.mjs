import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSameArtifactBytes, readFileByteIdentity } from "../packaging/windows-artifact-identity.mjs";
import { readPiRuntimeContract } from "./pi-runtime-contract.mjs";

export const WINDOWS_PREVIEW_CANDIDATE_SCHEMA = "pi67.windows-preview-candidate.v1";
export const WINDOWS_PREVIEW_CANDIDATE_WORKFLOW = "Windows candidate";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const releaseDirectory = resolve(repositoryRoot, "artifacts/release");
const MAX_IDENTITY_BYTES = 1024 * 1024;
const FULL_COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;

export async function createWindowsPreviewCandidateIdentity({
  host = { architecture: process.arch, platform: process.platform },
  installerPath,
  packagedExecutablePath,
  releaseRoot = releaseDirectory,
  repository,
  runAttempt,
  runId,
  runtimeSpecifier,
  sourceCommit,
  version
}) {
  if (host.platform !== "win32" || host.architecture !== "x64") {
    throw new Error(`Windows preview candidates require win32/x64, got ${host.platform}/${host.architecture}.`);
  }
  const runtime = runtimeSpecifier ?? (await readPiRuntimeContract(repositoryRoot)).runtimeSpecifier;
  const [installer, packagedExecutable] = await Promise.all([
    readFileByteIdentity(installerPath),
    readFileByteIdentity(packagedExecutablePath)
  ]);
  const value = {
    schema: WINDOWS_PREVIEW_CANDIDATE_SCHEMA,
    channel: "unsigned-preview-candidate",
    signed: false,
    repository,
    workflow: {
      name: WINDOWS_PREVIEW_CANDIDATE_WORKFLOW,
      runId,
      runAttempt
    },
    source: { policy: "main", commit: sourceCommit },
    application: {
      product: "Pi-67 Desktop",
      version,
      platform: "win32",
      architecture: "x64",
      runtime
    },
    installer: fileIdentity(installer, basename(installerPath)),
    packagedExecutable: fileIdentity(
    packagedExecutable,
      relative(releaseRoot, resolve(packagedExecutablePath)).replaceAll("\\", "/")
    )
  };
  assertWindowsPreviewCandidateIdentity(value, {
    repository,
    runAttempt,
    runId,
    sourceCommit,
    version
  });
  return value;
}

export function assertWindowsPreviewCandidateIdentity(value, expected = {}) {
  const failures = [];
  if (value?.schema !== WINDOWS_PREVIEW_CANDIDATE_SCHEMA) failures.push("invalid schema");
  if (value?.channel !== "unsigned-preview-candidate" || value?.signed !== false) {
    failures.push("candidate must be explicitly unsigned");
  }
  if (!REPOSITORY.test(value?.repository ?? "")) failures.push("invalid repository");
  if (value?.workflow?.name !== WINDOWS_PREVIEW_CANDIDATE_WORKFLOW) failures.push("invalid workflow name");
  if (!POSITIVE_INTEGER.test(value?.workflow?.runId ?? "")) failures.push("invalid workflow run ID");
  if (!POSITIVE_INTEGER.test(value?.workflow?.runAttempt ?? "")) failures.push("invalid workflow run attempt");
  if (value?.source?.policy !== "main" || !FULL_COMMIT.test(value?.source?.commit ?? "")) {
    failures.push("invalid main source identity");
  }
  if (value?.application?.product !== "Pi-67 Desktop"
    || !VERSION.test(value?.application?.version ?? "")
    || value?.application?.platform !== "win32"
    || value?.application?.architecture !== "x64"
    || typeof value?.application?.runtime !== "string"
    || !value.application.runtime.startsWith("@earendil-works/pi-coding-agent@")) {
    failures.push("invalid application identity");
  }
  const expectedInstaller = `Pi-67-Desktop-${value?.application?.version}-win-x64.exe`;
  validateFileIdentity(value?.installer, expectedInstaller, "installer", failures);
  validateFileIdentity(
    value?.packagedExecutable,
    "win-unpacked/Pi-67 Desktop.exe",
    "packaged executable",
    failures
  );
  for (const [name, actual, wanted] of [
    ["repository", value?.repository, expected.repository],
    ["source commit", value?.source?.commit, expected.sourceCommit],
    ["workflow run ID", value?.workflow?.runId, expected.runId],
    ["workflow run attempt", value?.workflow?.runAttempt, expected.runAttempt],
    ["application version", value?.application?.version, expected.version]
  ]) {
    if (wanted !== undefined && actual !== wanted) failures.push(`${name} mismatch`);
  }
  if (failures.length > 0) {
    throw new Error(`Windows preview candidate identity is invalid:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  }
  return value;
}

export async function readWindowsPreviewCandidateIdentity(path, expected = {}) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_IDENTITY_BYTES) {
    throw new Error("Windows preview candidate identity is not a bounded regular file.");
  }
  return assertWindowsPreviewCandidateIdentity(JSON.parse(await readFile(path, "utf8")), expected);
}

export async function verifyWindowsPreviewCandidateFiles({
  candidateIdentityPath,
  expectedRepository,
  expectedRunAttempt,
  expectedRunId,
  expectedSourceCommit,
  installerPath,
  packagedExecutablePath
}) {
  const identity = await readWindowsPreviewCandidateIdentity(candidateIdentityPath, {
    repository: expectedRepository,
    runAttempt: expectedRunAttempt,
    runId: expectedRunId,
    sourceCommit: expectedSourceCommit
  });
  if (basename(installerPath) !== identity.installer.fileName) {
    throw new Error("Windows preview candidate installer filename does not match its identity.");
  }
  if (basename(packagedExecutablePath) !== "Pi-67 Desktop.exe") {
    throw new Error("Windows preview candidate packaged executable filename is invalid.");
  }
  const [installer, packagedExecutable] = await Promise.all([
    readFileByteIdentity(installerPath),
    readFileByteIdentity(packagedExecutablePath)
  ]);
  assertSameArtifactBytes(installer, identity.installer, "Windows preview candidate installer");
  assertSameArtifactBytes(
    packagedExecutable,
    identity.packagedExecutable,
    "Windows preview candidate packaged executable"
  );
  return {
    identity,
    identitySha256: await hashFile(candidateIdentityPath),
    installer,
    packagedExecutable
  };
}

function validateFileIdentity(value, expectedName, label, failures) {
  if (value?.fileName !== expectedName) failures.push(`${label} filename mismatch`);
  if (!Number.isSafeInteger(value?.byteLength) || value.byteLength < 1) failures.push(`${label} size is invalid`);
  if (!SHA256.test(value?.sha256 ?? "")) failures.push(`${label} SHA-256 is invalid`);
}

function fileIdentity(identity, fileName) {
  return { fileName, byteLength: identity.byteLength, sha256: identity.sha256 };
}

function parseNamedArguments(argumentsList, allowed) {
  if (argumentsList.length % 2 !== 0) throw new Error("Windows preview candidate arguments are incomplete.");
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    if (!allowed.has(name) || values.has(name)) throw new Error(`Invalid Windows preview candidate argument: ${name}.`);
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

function hashFile(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolvePromise(hash.digest("hex")));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  const allowed = new Set([
    "--candidate-identity",
    "--expected-repository",
    "--expected-run-attempt",
    "--expected-run-id",
    "--expected-source-commit",
    "--installer",
    "--output",
    "--packaged-executable",
    "--repository",
    "--run-attempt",
    "--run-id",
    "--source-commit"
  ]);
  const values = parseNamedArguments(process.argv.slice(3), allowed);
  if (action === "create") {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    const outputPath = requiredArgument(values, "--output");
    const identity = await createWindowsPreviewCandidateIdentity({
      installerPath: requiredArgument(values, "--installer"),
      packagedExecutablePath: requiredArgument(values, "--packaged-executable"),
      repository: requiredArgument(values, "--repository"),
      runAttempt: requiredArgument(values, "--run-attempt"),
      runId: requiredArgument(values, "--run-id"),
      sourceCommit: requiredArgument(values, "--source-commit"),
      version: packageJson.version
    });
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(identity, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(`Wrote Windows preview candidate identity ${relative(repositoryRoot, outputPath)}.`);
  } else if (action === "verify") {
    const result = await verifyWindowsPreviewCandidateFiles({
      candidateIdentityPath: requiredArgument(values, "--candidate-identity"),
      expectedRepository: requiredArgument(values, "--expected-repository"),
      expectedRunAttempt: requiredArgument(values, "--expected-run-attempt"),
      expectedRunId: requiredArgument(values, "--expected-run-id"),
      expectedSourceCommit: requiredArgument(values, "--expected-source-commit"),
      installerPath: requiredArgument(values, "--installer"),
      packagedExecutablePath: requiredArgument(values, "--packaged-executable")
    });
    console.log(`Verified Windows preview candidate ${result.identitySha256}.`);
  } else {
    throw new Error("Usage: windows-preview-candidate.mjs <create|verify> [arguments]");
  }
}
