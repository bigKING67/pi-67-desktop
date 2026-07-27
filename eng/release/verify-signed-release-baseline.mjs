import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeWindowsSignerThumbprint,
  readWindowsArtifactIdentity
} from "../packaging/windows-artifact-identity.mjs";
import { validateSignedReleaseManifest } from "./release-manifest-contract.mjs";
import { validatePreviousStableResolution } from "./resolve-previous-stable-release.mjs";

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;

export async function prepareSignedReleaseBaseline({
  candidateTag,
  repository,
  resolutionPath
}) {
  const resolution = validatePreviousStableResolution(
    await readBoundedJson(resolutionPath),
    repository,
    candidateTag
  );
  if (resolution.kind !== "resolved") {
    throw new Error("A direct previous stable release does not exist for this candidate.");
  }
  return resolution;
}

export async function verifySignedReleaseBaseline({
  candidateTag,
  directory,
  expectedSignerThumbprint,
  readArtifactIdentity = readWindowsArtifactIdentity,
  releaseMetadataPath,
  repository,
  resolutionPath
}) {
  const resolution = await prepareSignedReleaseBaseline({ candidateTag, repository, resolutionPath });
  const release = await readBoundedJson(releaseMetadataPath);
  const failures = validateFreshReleaseMetadata(release, resolution);
  const version = resolution.baseline.version;
  const expectedInstallerName = resolution.baseline.installerAsset.name;
  const manifestPath = join(directory, resolution.baseline.manifestAsset.name);
  const installerPath = join(directory, expectedInstallerName);
  const manifest = await readBoundedJson(manifestPath);
  failures.push(...validateSignedReleaseManifest(manifest, version));

  const installerNames = (await readdir(directory))
    .filter((name) => /^Pi-67-Desktop-.+-win-x64\.exe$/u.test(name));
  if (installerNames.length !== 1 || installerNames[0] !== expectedInstallerName) {
    failures.push("baseline directory must contain exactly the resolved Windows installer");
  }
  await assertRegularContainedFile(installerPath, directory);
  const identity = await readArtifactIdentity(installerPath);
  const manifestEntry = Array.isArray(manifest.files)
    ? manifest.files.find((entry) => entry?.name === expectedInstallerName)
    : undefined;
  const expectedSigner = normalizeWindowsSignerThumbprint(expectedSignerThumbprint);
  if (!Number.isSafeInteger(identity.byteLength)
    || identity.byteLength < 1
    || identity.byteLength > MAX_INSTALLER_BYTES) {
    failures.push("Windows baseline installer is outside the size boundary");
  }
  if (identity.byteLength !== resolution.baseline.installerAsset.size) {
    failures.push("Windows baseline installer size does not match the resolved GitHub asset");
  }
  if (manifestEntry?.bytes !== identity.byteLength) failures.push("Windows baseline installer size mismatch");
  if (manifestEntry?.sha256 !== identity.sha256) failures.push("Windows baseline installer SHA-256 mismatch");
  const resolvedDigest = resolution.baseline.installerAsset.digest;
  if (resolvedDigest && resolvedDigest !== `sha256:${identity.sha256}`) {
    failures.push("Windows baseline installer digest does not match the resolved GitHub asset");
  }
  if (identity.authenticode?.signerThumbprint !== expectedSigner) {
    failures.push("Windows baseline installer was signed by an unexpected Publisher");
  }
  if (failures.length > 0) throwBaselineFailures(failures);

  return {
    schemaVersion: 1,
    status: "passed",
    repository,
    candidate: resolution.candidate,
    baseline: {
      releaseId: resolution.baseline.releaseId,
      tag: resolution.baseline.tag,
      version,
      publishedAt: resolution.baseline.publishedAt,
      immutable: resolution.baseline.immutable,
      manifestAsset: resolution.baseline.manifestAsset,
      installerAsset: resolution.baseline.installerAsset,
      installer: {
        fileName: basename(installerPath),
        byteLength: identity.byteLength,
        sha256: identity.sha256,
        authenticode: identity.authenticode
      }
    },
    installerPath: resolve(installerPath)
  };
}

export function validateFreshReleaseMetadata(release, resolution) {
  const failures = [];
  const baseline = resolution.baseline;
  if (release?.id !== baseline.releaseId
    || release?.tag_name !== baseline.tag
    || release?.draft !== false
    || release?.prerelease !== false
    || release?.published_at !== baseline.publishedAt) {
    failures.push("fresh GitHub release identity does not match the resolved baseline");
  }
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  for (const expected of [baseline.manifestAsset, baseline.installerAsset]) {
    const matches = assets.filter((asset) => asset?.id === expected.id || asset?.name === expected.name);
    if (matches.length !== 1) {
      failures.push(`fresh GitHub release must contain exactly one ${expected.name} asset`);
      continue;
    }
    const actual = matches[0];
    if (actual.id !== expected.id
      || actual.name !== expected.name
      || actual.size !== expected.size
      || actual.state !== expected.state
      || (actual.digest ?? null) !== expected.digest) {
      failures.push(`fresh GitHub asset identity drifted for ${expected.name}`);
    }
  }
  return failures;
}

async function assertRegularContainedFile(path, root) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Signed release baseline installer must be a regular file.");
  }
  const resolvedRoot = await realpath(root);
  const resolvedPath = await realpath(path);
  const traversal = relative(resolvedRoot, resolvedPath);
  if (traversal.startsWith("..") || traversal.includes("\u0000")) {
    throw new Error("Signed release baseline installer escaped the baseline directory.");
  }
}

async function readBoundedJson(path) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_JSON_BYTES) {
    throw new Error(`${basename(path)} is missing or outside the signed baseline JSON boundary.`);
  }
  return JSON.parse(await readFile(path, "utf8"));
}

function throwBaselineFailures(failures) {
  throw new Error(`Signed release baseline verification failed:\n${failures.map((item) => `- ${item}`).join("\n")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const argumentsByName = parseNamedArguments(process.argv.slice(3));
  const common = {
    candidateTag: requiredArgument(argumentsByName, "--candidate-tag"),
    repository: requiredArgument(argumentsByName, "--repository"),
    resolutionPath: requiredArgument(argumentsByName, "--resolution")
  };
  if (mode === "prepare") {
    const resolution = await prepareSignedReleaseBaseline(common);
    const githubEnvironmentPath = requiredArgument(argumentsByName, "--github-env");
    await writeEnvironmentFile(githubEnvironmentPath, {
      PI67_BASELINE_RELEASE_ID: String(resolution.baseline.releaseId),
      PI67_BASELINE_TAG: resolution.baseline.tag,
      PI67_BASELINE_MANIFEST_ASSET_ID: String(resolution.baseline.manifestAsset.id),
      PI67_BASELINE_INSTALLER_ASSET_ID: String(resolution.baseline.installerAsset.id),
      PI67_BASELINE_INSTALLER_NAME: resolution.baseline.installerAsset.name
    });
    console.log(`Prepared exact GitHub asset IDs for ${resolution.baseline.tag}.`);
  } else if (mode === "verify") {
    const receiptPath = requiredArgument(argumentsByName, "--receipt");
    const result = await verifySignedReleaseBaseline({
      ...common,
      directory: requiredArgument(argumentsByName, "--directory"),
      expectedSignerThumbprint: requiredArgument(argumentsByName, "--expected-signer"),
      releaseMetadataPath: requiredArgument(argumentsByName, "--release")
    });
    await mkdir(dirname(receiptPath), { recursive: true });
    await writeFile(receiptPath, `${JSON.stringify({ ...result, installerPath: undefined }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    const githubEnvironmentPath = requiredArgument(argumentsByName, "--github-env");
    await writeEnvironmentFile(githubEnvironmentPath, {
      PI67_WINDOWS_BASELINE_INSTALLER: result.installerPath
    });
    console.log(`Verified direct previous signed Windows release baseline ${result.baseline.tag}.`);
  } else {
    throw new Error(`Unknown signed release baseline verifier mode: ${String(mode)}.`);
  }
}

function parseNamedArguments(argumentsList) {
  if (argumentsList.length % 2 !== 0) throw new Error("Signed release baseline verifier arguments are incomplete.");
  const result = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!name.startsWith("--") || result.has(name)) {
      throw new Error(`Invalid signed release baseline verifier argument: ${name}.`);
    }
    result.set(name, value);
  }
  return result;
}

function requiredArgument(argumentsByName, name) {
  const value = argumentsByName.get(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function writeEnvironmentFile(path, values) {
  const lines = [];
  for (const [name, value] of Object.entries(values)) {
    if (value.includes("\r") || value.includes("\n") || value.includes("\u0000")) {
      throw new Error(`${name} cannot contain control characters.`);
    }
    lines.push(`${name}=${value}`);
  }
  await writeFile(path, `${lines.join("\n")}\n`, { encoding: "utf8", flag: "a" });
}
