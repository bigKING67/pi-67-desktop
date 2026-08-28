import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  assertSameArtifactBytes,
  readFileByteIdentity
} from "../packaging/windows-artifact-identity.mjs";
import { readPiRuntimeContract } from "./pi-runtime-contract.mjs";

export const MACOS_PREVIEW_CANDIDATE_SCHEMA = "pi67.macos-preview-candidate.v1";
export const MACOS_PREVIEW_PACKAGED_SMOKE_SCHEMA = "pi67.macos-preview-packaged-smoke.v1";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const defaultReleaseRoot = join(repositoryRoot, "artifacts/release");
const DEFAULT_REPOSITORY = "bigKING67/pi-67-desktop";
const MAX_EVIDENCE_BYTES = 1024 * 1024;
const FULL_COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;

export function resolveMacosPreviewEvidencePaths(version, releaseRoot = defaultReleaseRoot) {
  return {
    applicationPath: join(releaseRoot, "mac-arm64/Pi-67 Desktop.app"),
    appAsarPath: join(releaseRoot, "mac-arm64/Pi-67 Desktop.app/Contents/Resources/app.asar"),
    candidateIdentityPath: join(releaseRoot, "macos-preview-candidate-identity.json"),
    dmgPath: join(releaseRoot, `Pi-67-Desktop-${version}-mac-arm64.dmg`),
    executablePath: join(releaseRoot, "mac-arm64/Pi-67 Desktop.app/Contents/MacOS/Pi-67 Desktop"),
    packagedSmokeReceiptPath: join(releaseRoot, "macos-preview-packaged-smoke.json"),
    zipPath: join(releaseRoot, `Pi-67-Desktop-${version}-mac-arm64.zip`)
  };
}

export function readRepositorySourceIdentity(root = repositoryRoot) {
  const commit = runGit(root, ["rev-parse", "HEAD"]).trim();
  if (!FULL_COMMIT.test(commit)) throw new Error("macOS preview source commit is invalid.");
  const status = runGit(root, ["status", "--porcelain=v1", "--untracked-files=normal"]);
  return { policy: "main", commit, clean: status.length === 0 };
}

export async function writeMacosPreviewCandidateEvidence({
  host = { architecture: process.arch, platform: process.platform },
  paths,
  releaseRoot = defaultReleaseRoot,
  repository = DEFAULT_REPOSITORY,
  runtimeSpecifier,
  source,
  sourceRoot = repositoryRoot,
  verifyContainers = verifyMacosPreviewContainers,
  version
} = {}) {
  if (host.platform !== "darwin" || host.architecture !== "arm64") {
    throw new Error(`macOS preview candidates require darwin/arm64, got ${host.platform}/${host.architecture}.`);
  }
  const packageVersion = version ?? JSON.parse(
    await readFile(join(sourceRoot, "package.json"), "utf8")
  ).version;
  const runtime = runtimeSpecifier ?? (await readPiRuntimeContract(sourceRoot)).runtimeSpecifier;
  const sourceIdentity = source ?? readRepositorySourceIdentity(sourceRoot);
  const evidencePaths = paths ?? resolveMacosPreviewEvidencePaths(packageVersion, releaseRoot);
  await Promise.resolve(verifyContainers({ dmgPath: evidencePaths.dmgPath, zipPath: evidencePaths.zipPath }));
  const [appAsar, executable, dmg, zip] = await Promise.all([
    readFileByteIdentity(evidencePaths.appAsarPath),
    readFileByteIdentity(evidencePaths.executablePath),
    readFileByteIdentity(evidencePaths.dmgPath),
    readFileByteIdentity(evidencePaths.zipPath)
  ]);
  const application = {
    product: "Pi-67 Desktop",
    bundleId: "com.pi67.desktop",
    version: packageVersion,
    platform: "darwin",
    architecture: "arm64",
    runtime
  };
  const artifacts = {
    executable: fileIdentity(
      executable,
      relative(releaseRoot, resolve(evidencePaths.executablePath)).replaceAll("\\", "/")
    ),
    appAsar: fileIdentity(
      appAsar,
      relative(releaseRoot, resolve(evidencePaths.appAsarPath)).replaceAll("\\", "/")
    ),
    dmg: fileIdentity(
      dmg,
      basename(evidencePaths.dmgPath),
      `Pi-67-Desktop-${packageVersion}-mac-arm64-unsigned-preview.dmg`
    ),
    zip: fileIdentity(
      zip,
      basename(evidencePaths.zipPath),
      `Pi-67-Desktop-${packageVersion}-mac-arm64-unsigned-preview.zip`
    )
  };
  const receipt = {
    schema: MACOS_PREVIEW_PACKAGED_SMOKE_SCHEMA,
    status: "passed",
    evidenceLevel: "packaged-macos-arm64-smoke-confirmed",
    repository,
    source: sourceIdentity,
    application,
    command: "corepack pnpm run package:smoke",
    containerVerification: { dmg: "hdiutil verify", zip: "unzip -tq" },
    artifacts
  };
  assertMacosPreviewPackagedSmokeReceipt(receipt, {
    repository,
    runtimeSpecifier: runtime,
    sourceCommit: sourceIdentity.commit,
    sourceClean: sourceIdentity.clean,
    version: packageVersion
  });
  await mkdir(dirname(evidencePaths.packagedSmokeReceiptPath), { recursive: true });
  await writeFile(
    evidencePaths.packagedSmokeReceiptPath,
    `${JSON.stringify(receipt, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  const receiptFile = await readFileByteIdentity(evidencePaths.packagedSmokeReceiptPath);
  const identity = {
    schema: MACOS_PREVIEW_CANDIDATE_SCHEMA,
    channel: "unsigned-preview-candidate",
    signed: false,
    repository,
    source: sourceIdentity,
    application,
    artifacts,
    packagedSmoke: {
      schema: MACOS_PREVIEW_PACKAGED_SMOKE_SCHEMA,
      status: "passed",
      receiptByteLength: receiptFile.byteLength,
      receiptSha256: receiptFile.sha256
    }
  };
  assertMacosPreviewCandidateIdentity(identity, {
    repository,
    runtimeSpecifier: runtime,
    sourceCommit: sourceIdentity.commit,
    sourceClean: sourceIdentity.clean,
    version: packageVersion
  });
  await writeFile(
    evidencePaths.candidateIdentityPath,
    `${JSON.stringify(identity, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  return { identity, paths: evidencePaths, receipt };
}

export function assertMacosPreviewPackagedSmokeReceipt(value, expected = {}) {
  const failures = validateSharedMacosEvidence(value, expected);
  if (value?.schema !== MACOS_PREVIEW_PACKAGED_SMOKE_SCHEMA) failures.push("invalid schema");
  if (value?.status !== "passed"
    || value?.evidenceLevel !== "packaged-macos-arm64-smoke-confirmed"
    || value?.command !== "corepack pnpm run package:smoke"
    || value?.containerVerification?.dmg !== "hdiutil verify"
    || value?.containerVerification?.zip !== "unzip -tq") {
    failures.push("invalid packaged smoke result");
  }
  if (failures.length > 0) throwEvidenceError("packaged smoke receipt", failures);
  return value;
}

export function assertMacosPreviewCandidateIdentity(value, expected = {}) {
  const failures = validateSharedMacosEvidence(value, expected);
  if (value?.schema !== MACOS_PREVIEW_CANDIDATE_SCHEMA) failures.push("invalid schema");
  if (value?.channel !== "unsigned-preview-candidate" || value?.signed !== false) {
    failures.push("candidate must be explicitly unsigned");
  }
  if (value?.packagedSmoke?.schema !== MACOS_PREVIEW_PACKAGED_SMOKE_SCHEMA
    || value?.packagedSmoke?.status !== "passed"
    || !Number.isSafeInteger(value?.packagedSmoke?.receiptByteLength)
    || value.packagedSmoke.receiptByteLength < 1
    || !SHA256.test(value?.packagedSmoke?.receiptSha256 ?? "")) {
    failures.push("invalid packaged smoke receipt identity");
  }
  if (failures.length > 0) throwEvidenceError("candidate identity", failures);
  return value;
}

export async function readMacosPreviewPackagedSmokeReceipt(path, expected = {}) {
  return assertMacosPreviewPackagedSmokeReceipt(await readBoundedJson(path, "packaged smoke receipt"), expected);
}

export async function readMacosPreviewCandidateIdentity(path, expected = {}) {
  return assertMacosPreviewCandidateIdentity(await readBoundedJson(path, "candidate identity"), expected);
}

export async function verifyMacosPreviewCandidateFiles({
  candidateIdentityPath,
  dmgPath,
  expectedRepository,
  expectedRuntimeSpecifier,
  expectedSourceClean = true,
  expectedSourceCommit,
  packagedSmokeReceiptPath,
  version,
  zipPath
}) {
  const expected = {
    repository: expectedRepository,
    runtimeSpecifier: expectedRuntimeSpecifier,
    sourceClean: expectedSourceClean,
    sourceCommit: expectedSourceCommit,
    version
  };
  const [identity, receipt, receiptFile, dmg, zip] = await Promise.all([
    readMacosPreviewCandidateIdentity(candidateIdentityPath, expected),
    readMacosPreviewPackagedSmokeReceipt(packagedSmokeReceiptPath, expected),
    readFileByteIdentity(packagedSmokeReceiptPath),
    readFileByteIdentity(dmgPath),
    readFileByteIdentity(zipPath)
  ]);
  if (identity.packagedSmoke.receiptByteLength !== receiptFile.byteLength
    || identity.packagedSmoke.receiptSha256 !== receiptFile.sha256) {
    throw new Error("macOS packaged smoke receipt bytes do not match the candidate identity.");
  }
  for (const field of ["repository", "source", "application", "artifacts"]) {
    if (JSON.stringify(identity[field]) !== JSON.stringify(receipt[field])) {
      throw new Error(`macOS packaged smoke ${field} does not match the candidate identity.`);
    }
  }
  assertExpectedArtifactName(dmgPath, identity.artifacts.dmg, "DMG");
  assertExpectedArtifactName(zipPath, identity.artifacts.zip, "ZIP");
  assertSameArtifactBytes(dmg, identity.artifacts.dmg, "macOS preview DMG");
  assertSameArtifactBytes(zip, identity.artifacts.zip, "macOS preview ZIP");
  return {
    identity,
    identitySha256: await hashFile(candidateIdentityPath),
    packagedSmokeReceiptSha256: receiptFile.sha256,
    receipt
  };
}

export function verifyMacosPreviewContainers({ dmgPath, zipPath }) {
  runNativeVerifier("/usr/bin/hdiutil", ["verify", dmgPath], "macOS preview DMG verification");
  runNativeVerifier("/usr/bin/unzip", ["-tq", zipPath], "macOS preview ZIP verification");
}

function validateSharedMacosEvidence(value, expected) {
  const failures = [];
  if (!REPOSITORY.test(value?.repository ?? "")) failures.push("invalid repository");
  if (value?.source?.policy !== "main"
    || !FULL_COMMIT.test(value?.source?.commit ?? "")
    || typeof value?.source?.clean !== "boolean") {
    failures.push("invalid main source identity");
  }
  if (value?.application?.product !== "Pi-67 Desktop"
    || value?.application?.bundleId !== "com.pi67.desktop"
    || !VERSION.test(value?.application?.version ?? "")
    || value?.application?.platform !== "darwin"
    || value?.application?.architecture !== "arm64"
    || typeof value?.application?.runtime !== "string"
    || !value.application.runtime.startsWith("@earendil-works/pi-coding-agent@")) {
    failures.push("invalid application identity");
  }
  const version = value?.application?.version;
  validateFileIdentity(
    value?.artifacts?.executable,
    "mac-arm64/Pi-67 Desktop.app/Contents/MacOS/Pi-67 Desktop",
    undefined,
    "packaged executable",
    failures
  );
  validateFileIdentity(
    value?.artifacts?.appAsar,
    "mac-arm64/Pi-67 Desktop.app/Contents/Resources/app.asar",
    undefined,
    "app.asar",
    failures
  );
  validateFileIdentity(
    value?.artifacts?.dmg,
    `Pi-67-Desktop-${version}-mac-arm64.dmg`,
    `Pi-67-Desktop-${version}-mac-arm64-unsigned-preview.dmg`,
    "DMG",
    failures
  );
  validateFileIdentity(
    value?.artifacts?.zip,
    `Pi-67-Desktop-${version}-mac-arm64.zip`,
    `Pi-67-Desktop-${version}-mac-arm64-unsigned-preview.zip`,
    "ZIP",
    failures
  );
  for (const [label, actual, wanted] of [
    ["repository", value?.repository, expected.repository],
    ["source commit", value?.source?.commit, expected.sourceCommit],
    ["source clean state", value?.source?.clean, expected.sourceClean],
    ["application version", value?.application?.version, expected.version],
    ["runtime", value?.application?.runtime, expected.runtimeSpecifier]
  ]) {
    if (wanted !== undefined && actual !== wanted) failures.push(`${label} mismatch`);
  }
  return failures;
}

function validateFileIdentity(value, expectedName, expectedPublishedName, label, failures) {
  if (value?.fileName !== expectedName) failures.push(`${label} filename mismatch`);
  if (expectedPublishedName !== undefined && value?.publishedFileName !== expectedPublishedName) {
    failures.push(`${label} published filename mismatch`);
  }
  if (!Number.isSafeInteger(value?.byteLength) || value.byteLength < 1) failures.push(`${label} size is invalid`);
  if (!SHA256.test(value?.sha256 ?? "")) failures.push(`${label} SHA-256 is invalid`);
}

function fileIdentity(identity, fileName, publishedFileName) {
  return {
    fileName,
    ...(publishedFileName === undefined ? {} : { publishedFileName }),
    byteLength: identity.byteLength,
    sha256: identity.sha256
  };
}

function assertExpectedArtifactName(path, identity, label) {
  const actual = basename(path);
  if (actual !== identity.fileName && actual !== identity.publishedFileName) {
    throw new Error(`macOS preview ${label} filename does not match the candidate identity.`);
  }
}

async function readBoundedJson(path, label) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_EVIDENCE_BYTES) {
    throw new Error(`macOS preview ${label} is not a bounded regular file.`);
  }
  return JSON.parse(await readFile(path, "utf8"));
}

function throwEvidenceError(label, failures) {
  throw new Error(`macOS preview ${label} is invalid:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

function runGit(root, arguments_) {
  const result = spawnSync("git", arguments_, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error(`Unable to read macOS preview Git source identity: git ${arguments_.join(" ")}`);
  }
  return result.stdout;
}

function runNativeVerifier(command, arguments_, label) {
  const result = spawnSync(command, arguments_, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  if (result.status !== 0 || result.signal || result.error) {
    throw new Error(`${label} failed.`);
  }
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
  if (process.argv[2] !== "create" || process.argv.length !== 3) {
    throw new Error("Usage: node eng/release/macos-preview-candidate.mjs create");
  }
  const result = await writeMacosPreviewCandidateEvidence();
  console.log(`Wrote macOS preview packaged-smoke receipt ${relative(repositoryRoot, result.paths.packagedSmokeReceiptPath)}.`);
  console.log(`Wrote macOS preview candidate identity ${relative(repositoryRoot, result.paths.candidateIdentityPath)}.`);
}
