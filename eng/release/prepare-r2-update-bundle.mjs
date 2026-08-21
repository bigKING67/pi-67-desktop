import { copyFile, lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPiRuntimeContract } from "./pi-runtime-contract.mjs";
import {
  unsignedPreviewArtifactSpecs,
  verifyUnsignedPreview
} from "./unsigned-preview-artifacts.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const defaultReleaseDirectory = join(root, "artifacts/verified-unsigned-preview");
const defaultOutputDirectory = join(root, "artifacts/r2-update-bundle");
const LOCAL_PROVENANCE_FILES = [
  "windows-preview-candidate-identity.json",
  "windows-preview-manual-test.json"
];

export function r2UpdateUploadOrder(version) {
  return [
    ...unsignedPreviewArtifactSpecs(version).map((entry) => entry.name),
    "unsigned-preview-manifest.json"
  ];
}

export async function prepareR2UpdateBundle({
  releaseDirectory,
  outputDirectory,
  version,
  runtimeVersion
}) {
  await verifyUnsignedPreview(releaseDirectory, version, runtimeVersion);
  const expected = r2UpdateUploadOrder(version);
  const localBundleFiles = [...expected, ...LOCAL_PROVENANCE_FILES];
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  for (const name of localBundleFiles) {
    const source = join(releaseDirectory, name);
    const metadata = await lstat(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`R2 update source is not a regular file: ${name}`);
    }
    await copyFile(source, join(outputDirectory, name));
  }
  const actual = (await readdir(outputDirectory)).sort();
  if (actual.join("\n") !== [...localBundleFiles].sort().join("\n")) {
    throw new Error("R2 update bundle does not match its exact allowlist.");
  }
  return {
    files: expected,
    localProvenanceFiles: LOCAL_PROVENANCE_FILES,
    metadataLast: expected.at(-1)
  };
}

async function packageReleaseContract() {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const { runtimeVersion } = await readPiRuntimeContract(root);
  return { version: packageJson.version, runtimeVersion };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { version, runtimeVersion } = await packageReleaseContract();
  const result = await prepareR2UpdateBundle({
    releaseDirectory: defaultReleaseDirectory,
    outputDirectory: defaultOutputDirectory,
    version,
    runtimeVersion
  });
  console.log(`Prepared ${result.files.length} R2 update file(s) in upload order:`);
  for (const name of result.files) console.log(`- ${name}`);
  console.log(`Retained ${result.localProvenanceFiles.length} local provenance file(s); they are not uploaded.`);
  console.log("Upload unsigned-preview-manifest.json last.");
}
