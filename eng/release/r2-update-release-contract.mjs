import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gt as semverGt, rcompare as semverRcompare, valid as validSemver } from "semver";
import {
  assertSameArtifactBytes,
  readFileByteIdentity
} from "../packaging/windows-artifact-identity.mjs";
import {
  unsignedPreviewArtifactSpecs,
  validateUnsignedPreviewManifest
} from "./unsigned-preview-artifacts.mjs";
import { readWindowsPreviewCandidateIdentity } from "./windows-preview-candidate.mjs";
import { assertWindowsPreviewManualTestReceipt } from "./windows-preview-promotion.mjs";
import { verifyMacosPreviewCandidateFiles } from "./macos-preview-candidate.mjs";

export const R2_UPDATE_MANIFEST_NAME = "unsigned-preview-manifest.json";
export const R2_UPDATE_ORIGIN = "https://updates.52671314.xyz";
export const R2_RETAINED_VERSION_COUNT = 3;

const ARTIFACT_SUFFIXES = [
  "-win-x64-unsigned-preview.exe",
  "-mac-arm64-unsigned-preview.dmg",
  "-mac-arm64-unsigned-preview.zip"
];

export async function loadLocalR2Release({ directory, version, runtimeVersion }) {
  const manifestPath = join(directory, R2_UPDATE_MANIFEST_NAME);
  await assertRegularFile(manifestPath, "R2 release manifest");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const failures = validateUnsignedPreviewManifest(manifest, version, runtimeVersion);
  if (failures.length > 0) throwR2VerificationFailures(failures);
  const entries = manifest.files;
  const regularArtifacts = new Set();
  const artifacts = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    let metadata;
    try {
      metadata = await lstat(path);
    } catch {
      failures.push(`${entry.name}: source file is missing`);
      return { ...entry, path };
    }
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      failures.push(`${entry.name}: source is not a regular file`);
      return { ...entry, path };
    }
    regularArtifacts.add(entry.name);
    const sha256 = await hashFile(path);
    if (metadata.size !== entry.bytes) failures.push(`${entry.name}: size mismatch`);
    if (sha256 !== entry.sha256) failures.push(`${entry.name}: SHA-256 mismatch`);
    return { ...entry, path };
  }));
  const candidateIdentityPath = join(directory, "windows-preview-candidate-identity.json");
  const manualTestReceiptPath = join(directory, "windows-preview-manual-test.json");
  await Promise.all([
    assertRegularFile(candidateIdentityPath, "Windows candidate identity"),
    assertRegularFile(manualTestReceiptPath, "Windows manual-test receipt")
  ]);
  const candidate = await readWindowsPreviewCandidateIdentity(candidateIdentityPath, { version });
  const candidateIdentity = await readFileByteIdentity(candidateIdentityPath);
  const manualTestReceipt = assertWindowsPreviewManualTestReceipt(
    JSON.parse(await readFile(manualTestReceiptPath, "utf8")),
    {
      candidateIdentitySha256: candidateIdentity.sha256,
      candidateRunAttempt: candidate.workflow.runAttempt,
      candidateRunId: candidate.workflow.runId,
      repository: candidate.repository,
      sourceCommit: candidate.source.commit
    }
  );
  if (candidate.application.runtime !== `@earendil-works/pi-coding-agent@${runtimeVersion}`) {
    failures.push("Windows candidate Pi runtime version mismatch");
  }
  if (manualTestReceipt.candidate.installerSha256 !== candidate.installer.sha256
    || manualTestReceipt.candidate.packagedExecutableSha256 !== candidate.packagedExecutable.sha256) {
    failures.push("Windows manual-test receipt artifact hashes do not match the candidate identity");
  }
  const windowsArtifact = artifacts.find((entry) => entry.target === "windows-x64");
  if (!windowsArtifact) {
    failures.push("Windows update artifact is missing");
  } else if (regularArtifacts.has(windowsArtifact.name)) {
    const publishedInstaller = await readFileByteIdentity(windowsArtifact.path);
    try {
      assertSameArtifactBytes(publishedInstaller, candidate.installer, "R2 Windows update installer");
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "R2 Windows update installer mismatch");
    }
  }
  const macosDmg = artifacts.find((entry) => entry.target === "macos-arm64" && entry.name.endsWith(".dmg"));
  const macosZip = artifacts.find((entry) => entry.target === "macos-arm64" && entry.name.endsWith(".zip"));
  if (!macosDmg || !macosZip) {
    failures.push("macOS update artifacts are incomplete");
  }
  let macosEvidence;
  if (macosDmg && macosZip) {
    macosEvidence = await verifyMacosPreviewCandidateFiles({
      candidateIdentityPath: join(directory, "macos-preview-candidate-identity.json"),
      dmgPath: macosDmg.path,
      expectedRepository: candidate.repository,
      expectedRuntimeSpecifier: `@earendil-works/pi-coding-agent@${runtimeVersion}`,
      expectedSourceCommit: candidate.source.commit,
      packagedSmokeReceiptPath: join(directory, "macos-preview-packaged-smoke.json"),
      version,
      zipPath: macosZip.path
    });
  }
  if (failures.length > 0) throwR2VerificationFailures(failures);
  return {
    version,
    manifest,
    manifestBytes,
    manifestPath,
    artifacts,
    provenance: {
      candidateIdentitySha256: candidateIdentity.sha256,
      repository: candidate.repository,
      sourceCommit: candidate.source.commit,
      windowsCandidateRunId: candidate.workflow.runId,
      windowsCandidateRunAttempt: candidate.workflow.runAttempt,
      macosCandidateIdentitySha256: macosEvidence.identitySha256,
      macosPackagedSmokeReceiptSha256: macosEvidence.packagedSmokeReceiptSha256
    }
  };
}

export function parseR2ArtifactKey(key) {
  if (typeof key !== "string" || !key.startsWith("Pi-67-Desktop-")) return undefined;
  const suffix = ARTIFACT_SUFFIXES.find((candidate) => key.endsWith(candidate));
  if (!suffix) return undefined;
  const version = key.slice("Pi-67-Desktop-".length, -suffix.length);
  if (validSemver(version) !== version) return undefined;
  const expectedNames = new Set(unsignedPreviewArtifactSpecs(version).map((entry) => entry.name));
  return expectedNames.has(key) ? { key, version } : undefined;
}

export function createR2ReleasePlan(release, remoteObjects, publicManifest) {
  const remoteByKey = new Map(remoteObjects.map((entry) => [entry.key, entry]));
  const uploads = [];
  const alreadyPresent = [];
  const immutableConflicts = [];
  for (const artifact of release.artifacts) {
    const remote = remoteByKey.get(artifact.name);
    if (!remote) uploads.push(artifact.name);
    else if (remote.size === artifact.bytes) alreadyPresent.push(artifact.name);
    else immutableConflicts.push({ key: artifact.name, localBytes: artifact.bytes, remoteBytes: remote.size });
  }

  const oldArtifacts = [];
  const unknownObjects = [];
  for (const object of remoteObjects) {
    if (object.key === R2_UPDATE_MANIFEST_NAME) continue;
    const parsed = parseR2ArtifactKey(object.key);
    if (!parsed) unknownObjects.push(object.key);
    else if (parsed.version !== release.version) oldArtifacts.push(object.key);
  }

  return {
    targetVersion: release.version,
    currentPublicVersion: typeof publicManifest?.version === "string" ? publicManifest.version : null,
    uploads,
    alreadyPresent,
    immutableConflicts,
    manifestAction: manifestsMatch(publicManifest, release.manifest) ? "unchanged" : "publish-last",
    oldArtifacts: oldArtifacts.sort((left, right) => left.localeCompare(right)),
    unknownObjects: unknownObjects.sort((left, right) => left.localeCompare(right)),
    retention: createR2RetentionPlan(remoteObjects, release.version)
  };
}

export function createR2RetentionPlan(
  remoteObjects,
  targetVersion,
  retainedVersionLimit = R2_RETAINED_VERSION_COUNT
) {
  if (!validSemver(targetVersion)) throw new Error(`Invalid R2 retention target version: ${targetVersion}`);
  if (!Number.isSafeInteger(retainedVersionLimit) || retainedVersionLimit < 1) {
    throw new Error("R2 retained version limit must be a positive safe integer.");
  }

  const artifactsByVersion = new Map();
  for (const object of remoteObjects) {
    const parsed = parseR2ArtifactKey(object.key);
    if (!parsed) continue;
    const artifacts = artifactsByVersion.get(parsed.version) ?? [];
    artifacts.push(parsed.key);
    artifactsByVersion.set(parsed.version, artifacts);
  }

  const futureVersions = [...artifactsByVersion.keys()]
    .filter((version) => semverGt(version, targetVersion))
    .sort(semverRcompare);
  const eligibleVersions = new Set([
    targetVersion,
    ...[...artifactsByVersion.keys()].filter((version) => !semverGt(version, targetVersion))
  ]);
  const orderedVersions = [...eligibleVersions].sort(semverRcompare);
  const retainedVersions = orderedVersions.slice(0, retainedVersionLimit);
  const deletedVersions = orderedVersions.slice(retainedVersionLimit);
  const artifactsToDelete = deletedVersions
    .flatMap((version) => artifactsByVersion.get(version) ?? [])
    .sort((left, right) => left.localeCompare(right));

  return {
    retainedVersionLimit,
    retainedVersions,
    deletedVersions,
    futureVersions,
    artifactsToDelete
  };
}

export function assertCurrentPublicRelease(manifest, version, runtimeVersion) {
  const failures = validateUnsignedPreviewManifest(manifest, version, runtimeVersion);
  if (failures.length > 0) {
    throw new Error(`Public R2 manifest is not the confirmed release:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }
}

export function manifestsMatch(left, right) {
  return left !== null
    && left !== undefined
    && JSON.stringify(left) === JSON.stringify(right);
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function assertRegularFile(path, label) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} is not a regular file.`);
  }
  return metadata;
}

function throwR2VerificationFailures(failures) {
  throw new Error(`R2 release verification failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}
