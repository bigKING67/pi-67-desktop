import { copyFile, lstat, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSameArtifactBytes, readFileByteIdentity } from "../packaging/windows-artifact-identity.mjs";
import { unsignedPreviewArtifactSpecs, verifyUnsignedPreview } from "./unsigned-preview-artifacts.mjs";
import { readPiRuntimeContract } from "./pi-runtime-contract.mjs";
import { assertWindowsPreviewManualTestReceipt } from "./windows-preview-promotion.mjs";
import { readWindowsPreviewCandidateIdentity } from "./windows-preview-candidate.mjs";
import { verifyMacosPreviewCandidateFiles } from "./macos-preview-candidate.mjs";

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
  runtimeVersion,
  version
}) {
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
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  for (const name of unsignedPreviewBundleFiles(version)) {
    const source = join(releaseRoot, name);
    const metadata = await lstat(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Unsigned preview bundle source is not a regular file: ${name}.`);
    }
    await copyFile(source, join(outputRoot, name));
  }
  return outputRoot;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  await prepareUnsignedPreviewBundle({ version: packageJson.version });
  console.log("Prepared exact verified unsigned preview bundle.");
}
