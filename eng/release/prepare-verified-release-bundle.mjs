import { copyFile, cp, lstat, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileByteIdentity } from "../packaging/windows-artifact-identity.mjs";
import { expectedSignedReleaseArtifacts } from "./release-manifest-contract.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const releaseDirectory = join(repositoryRoot, "artifacts/release");
const certificationDirectory = join(repositoryRoot, "artifacts/certification/windows-native");
const providerCertificationDirectory = join(
  repositoryRoot,
  "artifacts/certification/provider-long-turn"
);
const bundleDirectory = join(repositoryRoot, "artifacts/verified-release-bundle");
const packageJson = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));

const WINDOWS_NATIVE_EVIDENCE_FILES = [
  ["scale-125/receipt.json", "windows-native-scale-125-receipt.json", "125", "receiptSha256"],
  ["scale-125/workspace.png", "windows-native-scale-125-workspace.png", "125", "screenshotSha256"],
  ["scale-150/receipt.json", "windows-native-scale-150-receipt.json", "150", "receiptSha256"],
  ["scale-150/workspace.png", "windows-native-scale-150-workspace.png", "150", "screenshotSha256"],
  ["scale-200/receipt.json", "windows-native-scale-200-receipt.json", "200", "receiptSha256"],
  ["scale-200/workspace.png", "windows-native-scale-200-workspace.png", "200", "screenshotSha256"]
];

export function verifiedReleaseSourceFiles(version) {
  return [
    ...expectedSignedReleaseArtifacts(version).keys(),
    "release-manifest.json",
    "provider-long-turn-release-gate.json",
    "windows-signed-candidate-identity.json",
    "windows-native-release-gate.json"
  ];
}

export function verifiedReleaseBundleFiles(version) {
  return [
    ...verifiedReleaseSourceFiles(version),
    "provider-long-turn-summary.json",
    "windows-native-certification-summary.json",
    ...WINDOWS_NATIVE_EVIDENCE_FILES.map(([, target]) => target)
  ];
}

export async function prepareVerifiedReleaseBundle({
  certificationRoot = certificationDirectory,
  outputRoot = bundleDirectory,
  providerCertificationRoot = providerCertificationDirectory,
  releaseRoot = releaseDirectory,
  version = packageJson.version
} = {}) {
  const outputRelease = join(outputRoot, "release");
  const outputCertification = join(outputRoot, "certification/windows-native");
  const outputProviderCertification = join(outputRoot, "certification/provider-long-turn");
  await rm(outputRoot, { force: true, recursive: true });
  await mkdir(outputRelease, { recursive: true });
  for (const name of verifiedReleaseSourceFiles(version)) {
    const source = join(releaseRoot, name);
    const metadata = await lstat(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Verified release bundle source is not a regular file: ${name}.`);
    }
    await copyFile(source, join(outputRelease, name));
  }
  const certificationMetadata = await lstat(certificationRoot);
  if (!certificationMetadata.isDirectory() || certificationMetadata.isSymbolicLink()) {
    throw new Error("Windows native certification bundle source is not a regular directory.");
  }
  const providerCertificationMetadata = await lstat(providerCertificationRoot);
  if (!providerCertificationMetadata.isDirectory() || providerCertificationMetadata.isSymbolicLink()) {
    throw new Error("Provider certification bundle source is not a regular directory.");
  }
  const gate = JSON.parse(await readFile(join(releaseRoot, "windows-native-release-gate.json"), "utf8"));
  if (gate?.schema !== "pi67.windows-native-release-gate.v1" || gate?.status !== "passed") {
    throw new Error("Windows native release gate identity is invalid while preparing the bundle.");
  }
  const summarySource = join(certificationRoot, "summary.json");
  const summaryIdentity = await readFileByteIdentity(summarySource);
  if (gate.certification?.summarySha256 !== summaryIdentity.sha256) {
    throw new Error("Windows native certification summary changed after release gate verification.");
  }
  await copyFile(summarySource, join(outputRelease, "windows-native-certification-summary.json"));
  const providerGate = JSON.parse(await readFile(
    join(releaseRoot, "provider-long-turn-release-gate.json"),
    "utf8"
  ));
  if (providerGate?.schema !== "pi67.provider-long-turn-release-gate.v1"
    || providerGate?.status !== "passed") {
    throw new Error("Provider long-turn release gate identity is invalid while preparing the bundle.");
  }
  const providerSummarySource = join(providerCertificationRoot, "summary.json");
  const providerSummaryIdentity = await readFileByteIdentity(providerSummarySource);
  if (providerGate.evidence?.summarySha256 !== providerSummaryIdentity.sha256) {
    throw new Error("Provider long-turn summary changed after release gate verification.");
  }
  await copyFile(providerSummarySource, join(outputRelease, "provider-long-turn-summary.json"));
  for (const [sourceName, targetName, label, hashField] of WINDOWS_NATIVE_EVIDENCE_FILES) {
    const source = join(certificationRoot, sourceName);
    const metadata = await lstat(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Windows native evidence is not a regular file: ${sourceName}.`);
    }
    const identity = await readFileByteIdentity(source);
    if (gate.certification?.scales?.[label]?.[hashField] !== identity.sha256) {
      throw new Error(`Windows native evidence changed after release gate verification: ${sourceName}.`);
    }
    await copyFile(source, join(outputRelease, targetName));
  }
  await cp(certificationRoot, outputCertification, {
    errorOnExist: true,
    force: false,
    recursive: true
  });
  await cp(providerCertificationRoot, outputProviderCertification, {
    errorOnExist: true,
    force: false,
    recursive: true
  });
  return outputRoot;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareVerifiedReleaseBundle();
  console.log("Prepared exact verified release bundle.");
}
