import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compare } from "semver";
import {
  expectedSignedReleaseArtifacts,
  parseCanonicalStableTag
} from "./release-manifest-contract.mjs";

const MAX_RELEASE_METADATA_BYTES = 16 * 1024 * 1024;
const MAX_RELEASE_COUNT = 1_000;
const MAX_ASSET_COUNT = 1_000;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;

export function resolvePreviousStableRelease(releasePages, candidateTag, repository) {
  const candidateVersion = parseCanonicalStableTag(candidateTag, "signed candidate tag");
  const normalizedRepository = normalizeRepository(repository);
  const releases = flattenReleasePages(releasePages);
  if (releases.length > MAX_RELEASE_COUNT) {
    throw new Error(`GitHub release catalog exceeds ${MAX_RELEASE_COUNT} entries.`);
  }

  const stableByVersion = new Map();
  for (const release of releases) {
    const stable = parseStableRelease(release);
    if (!stable) continue;
    if (stableByVersion.has(stable.version)) {
      throw new Error(`GitHub release catalog contains duplicate stable version ${stable.version}.`);
    }
    stableByVersion.set(stable.version, stable);
  }
  if (stableByVersion.has(candidateVersion)) {
    throw new Error(`Signed stable release ${candidateTag} already exists.`);
  }

  const latestStable = [...stableByVersion.values()]
    .sort((left, right) => compare(right.version, left.version))[0];
  if (latestStable && compare(latestStable.version, candidateVersion) >= 0) {
    throw new Error(
      `Signed release candidate ${candidateTag} must be newer than the latest stable release ${latestStable.tag}.`
    );
  }

  const base = {
    schemaVersion: 1,
    repository: normalizedRepository,
    candidate: { tag: candidateTag, version: candidateVersion }
  };
  if (!latestStable) return { ...base, kind: "first-stable-release" };

  const expectedInstallerName = [...expectedSignedReleaseArtifacts(latestStable.version).keys()]
    .find((name) => name.endsWith("-win-x64.exe"));
  const manifestAsset = resolveExactAsset(latestStable.assets, "release-manifest.json", MAX_MANIFEST_BYTES);
  const installerAsset = resolveExactAsset(latestStable.assets, expectedInstallerName, MAX_INSTALLER_BYTES);
  return {
    ...base,
    kind: "resolved",
    baseline: {
      releaseId: latestStable.releaseId,
      tag: latestStable.tag,
      version: latestStable.version,
      publishedAt: latestStable.publishedAt,
      immutable: latestStable.immutable,
      manifestAsset,
      installerAsset
    }
  };
}

export function formatPreviousStableReleaseOutputs(result) {
  return [
    `baseline_kind=${result.kind}`,
    `first_signed_release=${result.kind === "first-stable-release" ? "true" : "false"}`
  ];
}

export function validatePreviousStableResolution(result, repository, candidateTag) {
  const expected = {
    repository: normalizeRepository(repository),
    tag: candidateTag,
    version: parseCanonicalStableTag(candidateTag, "signed candidate tag")
  };
  if (result?.schemaVersion !== 1
    || result.repository !== expected.repository
    || result.candidate?.tag !== expected.tag
    || result.candidate?.version !== expected.version) {
    throw new Error("Signed release baseline resolution identity mismatch.");
  }
  if (result.kind === "first-stable-release") return result;
  if (result.kind !== "resolved") throw new Error("Signed release baseline resolution kind is invalid.");
  const baselineVersion = parseCanonicalStableTag(result.baseline?.tag, "baseline tag");
  if (baselineVersion !== result.baseline?.version || compare(baselineVersion, expected.version) >= 0) {
    throw new Error("Signed release baseline resolution version is invalid.");
  }
  if (!Number.isSafeInteger(result.baseline.releaseId) || result.baseline.releaseId < 1) {
    throw new Error("Signed release baseline resolution release ID is invalid.");
  }
  const expectedInstallerName = [...expectedSignedReleaseArtifacts(baselineVersion).keys()]
    .find((name) => name.endsWith("-win-x64.exe"));
  validateResolvedAsset(result.baseline.manifestAsset, "release-manifest.json", MAX_MANIFEST_BYTES);
  validateResolvedAsset(result.baseline.installerAsset, expectedInstallerName, MAX_INSTALLER_BYTES);
  return result;
}

async function readBoundedReleaseMetadata(path) {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_RELEASE_METADATA_BYTES) {
    throw new Error("GitHub release metadata is missing or outside the size boundary.");
  }
  return JSON.parse(await readFile(path, "utf8"));
}

function flattenReleasePages(value) {
  if (!Array.isArray(value)) throw new Error("GitHub release catalog must be an array.");
  if (value.every((entry) => Array.isArray(entry))) return value.flat();
  if (value.some((entry) => Array.isArray(entry))) {
    throw new Error("GitHub release catalog cannot mix release objects and pages.");
  }
  return value;
}

function parseStableRelease(release) {
  if (!release || release.draft === true || release.prerelease === true) return undefined;
  let version;
  try {
    version = parseCanonicalStableTag(release.tag_name);
  } catch {
    return undefined;
  }
  if (!Number.isSafeInteger(release.id) || release.id < 1) {
    throw new Error(`Stable release ${release.tag_name} has an invalid release ID.`);
  }
  if (typeof release.published_at !== "string" || !Number.isFinite(Date.parse(release.published_at))) {
    throw new Error(`Stable release ${release.tag_name} is not published.`);
  }
  if (!Array.isArray(release.assets) || release.assets.length > MAX_ASSET_COUNT) {
    throw new Error(`Stable release ${release.tag_name} has invalid asset metadata.`);
  }
  return {
    releaseId: release.id,
    tag: release.tag_name,
    version,
    publishedAt: release.published_at,
    immutable: typeof release.immutable === "boolean" ? release.immutable : null,
    assets: release.assets
  };
}

function resolveExactAsset(assets, expectedName, maximumBytes) {
  const matches = assets.filter((asset) => asset?.name === expectedName);
  if (matches.length !== 1) {
    throw new Error(`Stable release must contain exactly one ${expectedName} asset.`);
  }
  return validateResolvedAsset(matches[0], expectedName, maximumBytes);
}

function validateResolvedAsset(asset, expectedName, maximumBytes) {
  if (!asset
    || !Number.isSafeInteger(asset.id)
    || asset.id < 1
    || asset.name !== expectedName
    || asset.state !== "uploaded"
    || !Number.isSafeInteger(asset.size)
    || asset.size < 1
    || asset.size > maximumBytes) {
    throw new Error(`Stable release asset ${expectedName} has invalid identity metadata.`);
  }
  if (asset.digest !== null
    && asset.digest !== undefined
    && !/^sha256:[0-9a-f]{64}$/u.test(asset.digest)) {
    throw new Error(`Stable release asset ${expectedName} has an invalid digest.`);
  }
  return {
    id: asset.id,
    name: asset.name,
    size: asset.size,
    state: asset.state,
    digest: asset.digest ?? null
  };
}

function normalizeRepository(value) {
  if (typeof value !== "string"
    || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(value)) {
    throw new Error("GitHub repository identity must use owner/repository form.");
  }
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argumentsByName = parseNamedArguments(process.argv.slice(2));
  const metadataPath = argumentsByName.get("--releases");
  const candidateTag = argumentsByName.get("--candidate-tag");
  const repository = argumentsByName.get("--repository");
  const outputPath = argumentsByName.get("--output");
  const githubOutputPath = argumentsByName.get("--github-output");
  if (!metadataPath || !candidateTag || !repository || !outputPath || !githubOutputPath) {
    throw new Error("--releases, --candidate-tag, --repository, --output, and --github-output are required.");
  }
  const result = resolvePreviousStableRelease(
    await readBoundedReleaseMetadata(metadataPath),
    candidateTag,
    repository
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await appendFile(githubOutputPath, `${formatPreviousStableReleaseOutputs(result).join("\n")}\n`, "utf8");
  console.log(result.kind === "first-stable-release"
    ? `No prior stable release exists before ${candidateTag}.`
    : `Resolved direct previous stable release ${result.baseline.tag} for ${candidateTag}.`);
}

function parseNamedArguments(argumentsList) {
  if (argumentsList.length % 2 !== 0) throw new Error("Signed release baseline resolver arguments are incomplete.");
  const result = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!name.startsWith("--") || result.has(name)) {
      throw new Error(`Invalid signed release baseline resolver argument: ${name}.`);
    }
    result.set(name, value);
  }
  return result;
}
