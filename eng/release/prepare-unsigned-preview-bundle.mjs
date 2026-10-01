import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { valid } from "semver";
import { assertSameArtifactBytes, readFileByteIdentity } from "../packaging/windows-artifact-identity.mjs";
import { unsignedPreviewArtifactSpecs, validateUnsignedPreviewManifest, verifyUnsignedPreview } from "./unsigned-preview-artifacts.mjs";
import { readPiRuntimeContract } from "./pi-runtime-contract.mjs";
import { assertWindowsPreviewManualTestReceipt } from "./windows-preview-promotion.mjs";
import { readWindowsPreviewCandidateIdentity } from "./windows-preview-candidate.mjs";
import { verifyMacosPreviewCandidateFiles } from "./macos-preview-candidate.mjs";
import { archivePathsInUse, withReleaseArchiveLock } from "./release-archive-retention.mjs";
import { loadLocalR2Release } from "./r2-update-release-contract.mjs";
import { preservePreviousPreview } from "./retained-preview.mjs";
import { maintainLocalArtifactCopies } from "./local-artifact-retention.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const releaseDirectory = join(repositoryRoot, "artifacts/release");
const bundleDirectory = join(repositoryRoot, "artifacts/verified-unsigned-preview");

export function unsignedPreviewBundleFiles(version) {
  return [
    ...unsignedPreviewArtifactSpecs(version).map((spec) => spec.name),
    "SHA256SUMS.txt",
    "unsigned-preview-manifest.json",
    "windows-preview-candidate-identity.json",
    "windows-preview-manual-test.json",
    "macos-preview-candidate-identity.json",
    "macos-preview-packaged-smoke.json"
  ];
}

export async function prepareUnsignedPreviewBundle({
  outputRoot = bundleDirectory,
  releaseRoot = releaseDirectory,
  sourceRoot = repositoryRoot,
  probeInUse,
  runtimeVersion,
  version
}) {
  const managed = resolve(outputRoot) === join(resolve(sourceRoot), "artifacts/verified-unsigned-preview")
    && resolve(releaseRoot) === join(resolve(sourceRoot), "artifacts/release");
  if (managed) return withReleaseArchiveLock(releaseRoot, async retain => {
    const output = await prepareBundle({ outputRoot, releaseRoot, runtimeVersion, version, sourceRoot, probeInUse });
    const copies = await maintainLocalArtifactCopies({ root: sourceRoot, apply: true, lockHeld: true, probeInUse });
    const archives = await retain({ currentVersion: version, probeInUse });
    console.log(`Verified preview retention: duplicates removed=${copies.removed.length}; old archives removed=${archives.removed.length}; applications/evidence preserved.`);
    return output;
  });
  return prepareBundle({ outputRoot, releaseRoot, runtimeVersion, version, probeInUse });
}

async function prepareBundle({ outputRoot, releaseRoot, runtimeVersion, version, sourceRoot, probeInUse = archivePathsInUse }) {
  if (resolve(outputRoot) === resolve(releaseRoot)) throw new Error("Verified staging must be separate from release input.");
  const runtime = runtimeVersion ?? (await readPiRuntimeContract(repositoryRoot)).runtimeVersion;
  await verifyUnsignedPreview(releaseRoot, version, runtime);
  const candidatePath = join(releaseRoot, "windows-preview-candidate-identity.json");
  const receiptPath = join(releaseRoot, "windows-preview-manual-test.json");
  const candidate = await readWindowsPreviewCandidateIdentity(candidatePath, { version });
  const candidateFile = await readFileByteIdentity(candidatePath);
  const receipt = assertWindowsPreviewManualTestReceipt(JSON.parse(await readFile(receiptPath, "utf8")), {
    candidateIdentitySha256: candidateFile.sha256,
    candidateRunAttempt: candidate.workflow.runAttempt,
    candidateRunId: candidate.workflow.runId,
    repository: candidate.repository,
    sourceCommit: candidate.source.commit
  });
  if (receipt.candidate.installerSha256 !== candidate.installer.sha256
    || receipt.candidate.packagedExecutableSha256 !== candidate.packagedExecutable.sha256) {
    throw new Error("Windows preview manual test receipt artifact hashes do not match the candidate identity.");
  }
  const windowsArtifact = unsignedPreviewArtifactSpecs(version).find((spec) => spec.target === "windows-x64");
  if (!windowsArtifact) throw new Error("Unsigned preview Windows artifact specification is missing.");
  const publishedInstaller = await readFileByteIdentity(join(releaseRoot, windowsArtifact.name));
  assertSameArtifactBytes(
    publishedInstaller,
    candidate.installer,
    "Unsigned preview Windows installer"
  );
  const macosArtifacts = unsignedPreviewArtifactSpecs(version)
    .filter((spec) => spec.target === "macos-arm64");
  const dmg = macosArtifacts.find((spec) => spec.name.endsWith(".dmg"));
  const zip = macosArtifacts.find((spec) => spec.name.endsWith(".zip"));
  if (!dmg || !zip) throw new Error("Unsigned preview macOS artifact specifications are incomplete.");
  await verifyMacosPreviewCandidateFiles({
    candidateIdentityPath: join(releaseRoot, "macos-preview-candidate-identity.json"),
    dmgPath: join(releaseRoot, dmg.name),
    expectedRepository: candidate.repository,
    expectedRuntimeSpecifier: `@earendil-works/pi-coding-agent@${runtime}`,
    expectedSourceCommit: candidate.source.commit,
    packagedSmokeReceiptPath: join(releaseRoot, "macos-preview-packaged-smoke.json"),
    version,
    zipPath: join(releaseRoot, zip.name)
  });
  await mkdir(dirname(outputRoot), { recursive: true });
  if (await realpath(dirname(outputRoot)) !== resolve(dirname(outputRoot))) throw new Error("Verified staging parent must be canonical.");
  const staging = await mkdtemp(join(dirname(outputRoot), ".verified-preview-"));
  let previousDirectory;
  try {
    for (const name of unsignedPreviewBundleFiles(version)) {
      const source = join(releaseRoot, name);
      const metadata = await lstat(source);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Unsigned preview bundle source is not a regular file: ${name}.`);
      await copyFile(source, join(staging, name));
    }
    const replacement = await loadLocalR2Release({ directory: staging, version, runtimeVersion: runtime });
    const existing = await optionalStat(outputRoot);
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error("Unsafe existing preview bundle.");
      const manifestPath = join(outputRoot, "unsigned-preview-manifest.json");
      const metadata = await lstat(manifestPath);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 128 * 1024) throw new Error("Unsafe existing preview manifest.");
      const oldManifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const oldRuntime = typeof oldManifest.runtime === "string" ? oldManifest.runtime.slice("@earendil-works/pi-coding-agent@".length) : undefined;
      if (typeof oldManifest.version !== "string" || valid(oldManifest.version) !== oldManifest.version
        || validateUnsignedPreviewManifest(oldManifest, oldManifest.version, oldRuntime).length) throw new Error("Invalid existing preview manifest.");
      const known = new Set(unsignedPreviewBundleFiles(oldManifest.version));
      const names = await readdir(outputRoot);
      if (names.some(name => !known.has(name))) throw new Error("Existing preview contains unknown or pinned files.");
      for (const name of names) {
        const metadata = await lstat(join(outputRoot, name));
        if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Existing preview contains unsafe files.");
      }
      if (!sourceRoot && oldManifest.files.some(file => names.includes(file.name))) {
        await loadLocalR2Release({ directory: outputRoot, version: oldManifest.version, runtimeVersion: oldRuntime });
      }
      if ((await probeInUse([resolve(outputRoot)])).length) throw new Error("Existing verified preview is in use; replacement refused.");
      if (sourceRoot) await preservePreviousPreview(sourceRoot, replacement);
      previousDirectory = `${staging}-previous`;
      await rename(outputRoot, previousDirectory);
    }
    try { await rename(staging, outputRoot); }
    catch (error) { if (previousDirectory) await rename(previousDirectory, outputRoot); previousDirectory = undefined; throw error; }
    if (previousDirectory) await rm(previousDirectory, { recursive: true, force: false });
  } finally {
    // Only this invocation's unactivated staging is disposable; an uncertain old
    // directory is kept for recovery rather than erased in a finally block.
    if (await optionalStat(staging)) await rm(staging, { recursive: true, force: false });
  }
  return outputRoot;
}

async function optionalStat(path) {
  try { return await lstat(path); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  await prepareUnsignedPreviewBundle({ version: packageJson.version });
  console.log("Prepared exact verified unsigned preview bundle.");
}
