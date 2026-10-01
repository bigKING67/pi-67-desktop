import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readPiRuntimeContract } from "./pi-runtime-contract.mjs";
import { valid } from "semver";
import { archivePathsInUse, withReleaseArchiveLock } from "./release-archive-retention.mjs";
import { loadLocalR2Release } from "./r2-update-release-contract.mjs";
import {
  publishedUpdateArtifactName,
  UPDATE_PUBLICATION_PREFIX,
  unsignedPreviewArtifactSpecs,
  verifyUnsignedPreview,
  validateUnsignedPreviewManifest
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
  runtimeVersion,
  sourceRoot = root,
  probeInUse = archivePathsInUse
}) {
  if (resolve(releaseDirectory) === join(resolve(sourceRoot), "artifacts/verified-unsigned-preview")
    && resolve(outputDirectory) === join(resolve(sourceRoot), "artifacts/r2-update-bundle")) {
    return withReleaseArchiveLock(join(resolve(sourceRoot), "artifacts/release"), () =>
      prepareBundle({ releaseDirectory, outputDirectory, version, runtimeVersion, probeInUse }));
  }
  return prepareBundle({ releaseDirectory, outputDirectory, version, runtimeVersion, probeInUse });
}

async function prepareBundle({ releaseDirectory, outputDirectory, version, runtimeVersion, probeInUse }) {
  if (resolve(releaseDirectory) === resolve(outputDirectory)) throw new Error("R2 staging must be separate from retained input.");
  await verifyUnsignedPreview(releaseDirectory, version, runtimeVersion);
  await loadLocalR2Release({ directory: releaseDirectory, version, runtimeVersion });
  const expected = r2UpdateUploadOrder(version);
  const localBundleFiles = [...expected, ...LOCAL_PROVENANCE_FILES];
  // The verified bundle keeps the local New-Money names bound by provenance; only the published
  // copies and their manifest entries take the update-channel prefix. Bytes and hashes are unchanged.
  const manifest = JSON.parse(await readFile(join(releaseDirectory, "unsigned-preview-manifest.json"), "utf8"));
  const sources = new Map(LOCAL_PROVENANCE_FILES.map((name) => [name, name]));
  for (const spec of unsignedPreviewArtifactSpecs(version)) {
    sources.set(publishedUpdateArtifactName(spec.name), spec.name);
  }
  const published = {
    ...manifest,
    files: manifest.files.map((entry) => ({ ...entry, name: publishedUpdateArtifactName(entry.name) }))
  };
  await mkdir(dirname(outputDirectory), { recursive: true });
  if (await realpath(dirname(outputDirectory)) !== resolve(dirname(outputDirectory))) throw new Error("R2 staging parent must be canonical.");
  const staging = await mkdtemp(join(dirname(outputDirectory), ".r2-bundle-"));
  let previousDirectory;
  try {
    for (const name of localBundleFiles) {
      if (name === "unsigned-preview-manifest.json") continue;
      const sourceName = sources.get(name);
      const source = join(releaseDirectory, sourceName);
      const metadata = await lstat(source);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`R2 update source is not a regular file: ${sourceName}`);
      await copyFile(source, join(staging, name));
    }
    await writeFile(join(staging, "unsigned-preview-manifest.json"), `${JSON.stringify(published, null, 2)}\n`, "utf8");
    const actual = (await readdir(staging)).sort();
    if (actual.join("\n") !== [...localBundleFiles].sort().join("\n")) throw new Error("R2 update bundle does not match its exact allowlist.");
    await loadLocalR2Release({ directory: staging, version, runtimeVersion });
    const existing = await optionalStat(outputDirectory);
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error("Unsafe existing R2 staging.");
      const names = await readdir(outputDirectory);
      if (names.length) {
        const oldManifestPath = join(outputDirectory, "unsigned-preview-manifest.json");
        const metadata = await lstat(oldManifestPath);
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 128 * 1024) throw new Error("Unsafe existing R2 manifest.");
        const oldManifest = JSON.parse(await readFile(oldManifestPath, "utf8"));
        const oldRuntime = typeof oldManifest.runtime === "string" ? oldManifest.runtime.slice("@earendil-works/pi-coding-agent@".length) : undefined;
        if (typeof oldManifest.version !== "string" || valid(oldManifest.version) !== oldManifest.version
          || validateUnsignedPreviewManifest(oldManifest, oldManifest.version, oldRuntime).length) throw new Error("Invalid existing R2 manifest.");
        const known = new Set([...r2UpdateUploadOrder(oldManifest.version), ...LOCAL_PROVENANCE_FILES]);
        for (const spec of unsignedPreviewArtifactSpecs(oldManifest.version)) known.add(spec.name);
        if (names.some(name => !known.has(name))) throw new Error("Existing R2 staging contains unknown or pinned files.");
        for (const name of names) {
          const metadata = await lstat(join(outputDirectory, name));
          if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Existing R2 staging contains unsafe files.");
        }
        const present = oldManifest.files.filter(file => names.includes(file.name));
        if (present.length) await loadLocalR2Release({ directory: outputDirectory, version: oldManifest.version, runtimeVersion: oldRuntime });
      }
      if ((await probeInUse([resolve(outputDirectory)])).length) throw new Error("Existing R2 staging is in use; replacement refused.");
      previousDirectory = `${staging}-previous`;
      await rename(outputDirectory, previousDirectory);
    }
    try { await rename(staging, outputDirectory); }
    catch (error) { if (previousDirectory) await rename(previousDirectory, outputDirectory); previousDirectory = undefined; throw error; }
    if (previousDirectory) await rm(previousDirectory, { recursive: true, force: false });
  } finally {
    if (await optionalStat(staging)) await rm(staging, { recursive: true, force: false });
  }
  return {
    files: expected,
    localProvenanceFiles: LOCAL_PROVENANCE_FILES,
    metadataLast: expected.at(-1)
  };
}

async function optionalStat(path) {
  try { return await lstat(path); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
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
