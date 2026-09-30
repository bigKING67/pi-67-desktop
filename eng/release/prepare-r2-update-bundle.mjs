import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPiRuntimeContract } from "./pi-runtime-contract.mjs";
import {
  publishedUpdateArtifactName,
  UPDATE_PUBLICATION_PREFIX,
  unsignedPreviewArtifactSpecs,
  verifyUnsignedPreview
} from "./unsigned-preview-artifacts.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const defaultReleaseDirectory = join(root, "artifacts/verified-unsigned-preview");
const defaultOutputDirectory = join(root, "artifacts/r2-update-bundle");
const LOCAL_PROVENANCE_FILES = [
  "windows-preview-candidate-identity.json",
  "windows-preview-manual-test.json",
  "macos-preview-candidate-identity.json",
  "macos-preview-packaged-smoke.json"
];

export function r2UpdateUploadOrder(version) {
  return [
    ...unsignedPreviewArtifactSpecs(version, UPDATE_PUBLICATION_PREFIX).map((entry) => entry.name),
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
  // The verified bundle keeps the local New-Money names bound by provenance; only the published
  // copies and their manifest entries take the update-channel prefix. Bytes and hashes are unchanged.
  const manifest = JSON.parse(await readFile(join(releaseDirectory, "unsigned-preview-manifest.json"), "utf8"));
  const sources = new Map(LOCAL_PROVENANCE_FILES.map((name) => [name, name]));
  for (const spec of unsignedPreviewArtifactSpecs(version)) {
    sources.set(publishedUpdateArtifactName(spec.name), spec.name);
  }
  for (const name of localBundleFiles) {
    if (name === "unsigned-preview-manifest.json") continue;
    const sourceName = sources.get(name);
    const source = join(releaseDirectory, sourceName);
    const metadata = await lstat(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`R2 update source is not a regular file: ${sourceName}`);
    }
    await copyFile(source, join(outputDirectory, name));
  }
  const published = {
    ...manifest,
    files: manifest.files.map((entry) => ({ ...entry, name: publishedUpdateArtifactName(entry.name) }))
  };
  await writeFile(join(outputDirectory, "unsigned-preview-manifest.json"), `${JSON.stringify(published, null, 2)}\n`, "utf8");
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
