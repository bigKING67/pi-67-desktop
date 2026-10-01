import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { valid } from "semver";
import { loadLocalR2Release } from "./r2-update-release-contract.mjs";
import { readFileByteIdentity } from "../packaging/windows-artifact-identity.mjs";
import { validateUnsignedPreviewManifest } from "./unsigned-preview-artifacts.mjs";

const evidenceNames = ["unsigned-preview-manifest.json", "SHA256SUMS.txt",
  "windows-preview-candidate-identity.json", "windows-preview-manual-test.json",
  "macos-preview-candidate-identity.json", "macos-preview-packaged-smoke.json"];

// Only the fixed, independently admitted verified pool contributes a successful version.
// Receipts-only residue from explicit cleanup is not a retained installer set.
export async function loadRetainedPreview(root, { allowRetiredEvidence = false } = {}) {
  const directory = join(resolve(root), "artifacts/verified-unsigned-preview");
  const metadata = await optionalStat(directory);
  if (!metadata) return undefined;
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(directory) !== directory) {
    throw new Error("Unsafe retained preview directory.");
  }
  const manifestPath = join(directory, "unsigned-preview-manifest.json");
  const manifestStat = await optionalStat(manifestPath);
  if (!manifestStat) return undefined;
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 128 * 1024) {
    throw new Error("Unsafe retained preview manifest.");
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (typeof manifest.version !== "string" || valid(manifest.version) !== manifest.version || typeof manifest.runtime !== "string"
    || !manifest.runtime.startsWith("@earendil-works/pi-coding-agent@")) {
    throw new Error("Invalid retained preview identity.");
  }
  // Validate the names before resolving them, even when all product files were retired.
  const runtimeVersion = manifest.runtime.slice("@earendil-works/pi-coding-agent@".length);
  if (validateUnsignedPreviewManifest(manifest, manifest.version, runtimeVersion).length) {
    throw new Error("Invalid retained preview manifest.");
  }
  const present = await Promise.all(manifest.files.map(file => optionalStat(join(directory, file.name))));
  if (present.every(stat => !stat)) return allowRetiredEvidence
    ? { version: manifest.version, manifest, artifacts: [], retired: true } : undefined;
  return loadLocalR2Release({ directory, version: manifest.version, runtimeVersion });
}

export async function preservePreviousPreview(root, replacement) {
  const previous = await loadRetainedPreview(root, { allowRetiredEvidence: true });
  if (!previous) return;
  const oldDirectory = join(resolve(root), "artifacts/verified-unsigned-preview");
  if (await optionalStat(join(oldDirectory, ".keep"))) throw new Error("Retained preview is pinned.");
  if (!previous.retired && previous.version === replacement.version) {
    if (JSON.stringify(previous.manifest.files) !== JSON.stringify(replacement.manifest.files)) {
      throw new Error("Cannot replace retained preview with different bytes under the same version; use a new version.");
    }
  }
  const releaseDirectory = join(resolve(root), "artifacts/release");
  const evidenceIdentities = await Promise.all(evidenceNames.map(async name => {
    const metadata = await lstat(join(oldDirectory, name));
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 128 * 1024) throw new Error("Unsafe preview evidence.");
    return readFileByteIdentity(join(oldDirectory, name));
  }));
  const digest = createHash("sha256").update(JSON.stringify(evidenceIdentities)).digest("hex").slice(0, 12);
  const candidatesDirectory = join(resolve(root), "artifacts/candidates");
  await mkdir(candidatesDirectory, { recursive: true });
  if (await realpath(candidatesDirectory) !== candidatesDirectory) throw new Error("Unsafe preview candidates directory.");
  const evidenceDirectory = join(candidatesDirectory, `unsigned-preview-${previous.version}-${digest}`);
  await mkdir(evidenceDirectory, { recursive: true });
  if (await realpath(evidenceDirectory) !== evidenceDirectory) throw new Error("Unsafe preview evidence directory.");
  for (const name of evidenceNames) {
    await copyIdenticalOrExclusive(join(oldDirectory, name), join(evidenceDirectory, name));
  }
  if (previous.version === replacement.version) return;
  for (const artifact of previous.artifacts) {
    await copyIdenticalOrExclusive(artifact.path, join(releaseDirectory, artifact.name));
  }
}

async function copyIdenticalOrExclusive(source, destination) {
  const sourceIdentity = await readFileByteIdentity(source);
  const existing = await optionalStat(destination);
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error("Unsafe rollback destination.");
    const identity = await readFileByteIdentity(destination);
    if (identity.byteLength !== sourceIdentity.byteLength || identity.sha256 !== sourceIdentity.sha256) {
      throw new Error("Rollback destination has different bytes; refusing replacement.");
    }
    return;
  }
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  const identity = await readFileByteIdentity(destination);
  if (identity.byteLength !== sourceIdentity.byteLength || identity.sha256 !== sourceIdentity.sha256) {
    throw new Error("Rollback copy identity mismatch.");
  }
}

async function optionalStat(path) {
  try { return await lstat(path); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}
