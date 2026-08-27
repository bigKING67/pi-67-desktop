import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCloudflareR2Client,
  fetchPublicManifest,
  verifyPublicArtifact
} from "./r2-update-cloudflare-client.mjs";
import {
  assertCurrentPublicRelease,
  createR2ReleasePlan,
  createR2RetentionPlan,
  loadLocalR2Release,
  manifestsMatch,
  parseR2ArtifactKey,
  R2_UPDATE_MANIFEST_NAME,
  R2_UPDATE_ORIGIN,
  R2_RETAINED_VERSION_COUNT
} from "./r2-update-release-contract.mjs";
import { readPiRuntimeContract } from "./pi-runtime-contract.mjs";
import {
  assertCleanPreviewCandidateSource,
  verifyR2PublicationSource
} from "./preview-candidate-source.mjs";
import {
  createR2ReleaseProgressReporter,
  silentR2ReleaseProgress
} from "./r2-release-progress.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const defaultBundleDirectory = join(root, "artifacts/r2-update-bundle");
const defaultReceiptDirectory = join(root, "artifacts/r2-release-receipts");
const mutableManifestCacheControl = "no-store";
export const immutableArtifactCacheControl = "public, max-age=31536000, immutable";

export async function planR2Release({
  release,
  client,
  origin = R2_UPDATE_ORIGIN,
  fetchImpl = fetch,
  readPublicManifest = fetchPublicManifest
}) {
  const [remoteObjects, publicManifest] = await Promise.all([
    client.listObjects(),
    readPublicManifest(origin, fetchImpl)
  ]);
  return createR2ReleasePlan(release, remoteObjects, publicManifest);
}

export async function publishR2Release({
  release,
  client,
  origin = R2_UPDATE_ORIGIN,
  fetchImpl = fetch,
  readPublicManifest = fetchPublicManifest,
  verifyArtifact = verifyPublicArtifact,
  progress = silentR2ReleaseProgress
}) {
  const plan = await runProgressStage(progress, {
    name: "release-plan",
    detail: "reading R2 inventory and current public manifest",
    manifestState: "unchanged"
  }, () => planR2Release({ release, client, origin, fetchImpl, readPublicManifest }));
  if (plan.immutableConflicts.length > 0) {
    throw new Error("Refusing to overwrite an immutable R2 artifact with different bytes.");
  }
  assertNoFutureR2Versions(plan.retention);
  const preCutoverManifestState = plan.manifestAction === "publish-last"
    ? "not published"
    : "already current";
  const metadataRepairs = [];
  await runProgressStage(progress, {
    name: "immutable-artifacts",
    detail: `${release.artifacts.length} artifact(s): upload missing or verify existing R2 bytes`,
    manifestState: preCutoverManifestState
  }, async () => {
    for (const artifact of release.artifacts) {
      if (plan.uploads.includes(artifact.name)) {
        await client.putFile(
          artifact.name,
          artifact.path,
          artifactContentType(artifact.name),
          immutableArtifactCacheControl
        );
        continue;
      }
      const contentType = artifactContentType(artifact.name);
      const metadata = await client.verifyObject(artifact);
      if (metadata.cacheControl !== immutableArtifactCacheControl || metadata.contentType !== contentType) {
        await client.replaceObjectHttpMetadata(artifact.name, {
          contentType,
          cacheControl: immutableArtifactCacheControl,
          etag: metadata.etag,
          preservedMetadata: metadata.preservedMetadata
        });
        metadataRepairs.push(artifact.name);
      }
    }
  });
  await runProgressStage(progress, {
    name: "public-verification",
    detail: `${release.artifacts.length} full public SHA-256 readback(s), followed by Range probes`,
    manifestState: preCutoverManifestState
  }, async () => {
    for (const artifact of release.artifacts) {
      await verifyArtifact(origin, artifact, fetchImpl, progress.transfer);
    }
  });
  if (plan.manifestAction === "publish-last") {
    await runProgressStage(progress, {
      name: "manifest-publication",
      detail: "switching the mutable update channel after artifact verification",
      manifestState: "publishing last"
    }, () => client.putFile(
        R2_UPDATE_MANIFEST_NAME,
        release.manifestPath,
        "application/json; charset=utf-8",
        mutableManifestCacheControl
      ), "published");
  }
  await runProgressStage(progress, {
    name: "manifest-verification",
    detail: "reading the public no-store manifest and comparing exact release metadata",
    manifestState: plan.manifestAction === "publish-last" ? "published" : "already current"
  }, async () => {
    const publicManifest = await readPublicManifest(origin, fetchImpl);
    if (!manifestsMatch(publicManifest, release.manifest)) {
      throw new Error("Public R2 manifest does not match the local release after publication.");
    }
  });
  const retention = await runProgressStage(progress, {
    name: "retention-cleanup",
    detail: `keeping the newest ${R2_RETAINED_VERSION_COUNT} recognized versions after manifest verification`,
    manifestState: "published"
  }, async () => {
    const currentObjects = await client.listObjects();
    const retentionPlan = createR2RetentionPlan(currentObjects, release.version);
    assertNoFutureR2Versions(retentionPlan);
    for (const key of retentionPlan.artifactsToDelete) await client.deleteObject(key);

    if (retentionPlan.artifactsToDelete.length > 0) {
      const remainingObjects = await client.listObjects();
      const remainingPlan = createR2RetentionPlan(remainingObjects, release.version);
      assertNoFutureR2Versions(remainingPlan);
      if (remainingPlan.artifactsToDelete.length > 0) {
        throw new Error("R2 retention verification found artifacts older than the newest three versions.");
      }
    }
    return {
      retainedVersionLimit: retentionPlan.retainedVersionLimit,
      retainedVersions: retentionPlan.retainedVersions,
      deletedVersions: retentionPlan.deletedVersions,
      deletedArtifacts: retentionPlan.artifactsToDelete
    };
  });
  return { ...plan, metadataRepairs, retention, provenance: release.provenance, published: true };
}

export async function cleanupR2Release({
  client,
  confirmedVersion,
  runtimeVersion,
  targetUpgradesConfirmed,
  origin = R2_UPDATE_ORIGIN,
  fetchImpl = fetch,
  readPublicManifest = fetchPublicManifest
}) {
  if (!targetUpgradesConfirmed) {
    throw new Error("Cleanup requires --confirm-target-upgrades after Windows and macOS upgrade evidence.");
  }
  const publicManifest = await readPublicManifest(origin, fetchImpl);
  assertCurrentPublicRelease(publicManifest, confirmedVersion, runtimeVersion);
  const remoteObjects = await client.listObjects();
  assertNoFutureR2Versions(createR2RetentionPlan(remoteObjects, confirmedVersion));
  const oldArtifacts = remoteObjects
    .map((entry) => parseR2ArtifactKey(entry.key))
    .filter((entry) => entry && entry.version !== confirmedVersion)
    .map((entry) => entry.key)
    .sort();
  for (const key of oldArtifacts) await client.deleteObject(key);
  await client.purgeExactUrls(oldArtifacts.map((key) => `${origin}/${encodeURIComponent(key)}`));
  const remaining = await client.listObjects();
  const stale = remaining
    .map((entry) => parseR2ArtifactKey(entry.key))
    .filter((entry) => entry && entry.version !== confirmedVersion);
  if (stale.length > 0) throw new Error("R2 cleanup verification found recognized old artifacts.");
  return { targetVersion: confirmedVersion, deleted: oldArtifacts };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!new Set(["plan", "publish", "cleanup"]).has(command)) usage();
  const flags = parseReleaseCommandFlags(command, args);
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const { runtimeVersion } = await readPiRuntimeContract(root);
  const version = packageJson.version;
  const confirmedVersion = flags.get("confirm-version");
  if (command !== "plan" && confirmedVersion !== version) {
    throw new Error(`--confirm-version must exactly match package version ${version}.`);
  }

  const progress = command === "publish" ? createR2ReleaseProgressReporter() : undefined;
  const client = createClientFromEnvironment(command, progress?.transfer);
  if (command === "cleanup") {
    const receipt = await cleanupR2Release({
      client,
      confirmedVersion,
      runtimeVersion,
      targetUpgradesConfirmed: flags.has("confirm-target-upgrades")
    });
    await writeReceipt(command, version, receipt);
    printJson(receipt);
    return;
  }

  let release = await loadLocalR2Release({
    directory: flags.get("bundle") ?? defaultBundleDirectory,
    version,
    runtimeVersion
  });
  if (command === "publish") {
    const sourceCommit = flags.get("source-commit");
    const authority = await verifyR2PublicationSource({ root, sourceCommit });
    assertCleanPreviewCandidateSource({ root });
    if (release.provenance.sourceCommit !== sourceCommit) {
      throw new Error("R2 bundle source commit does not match --source-commit.");
    }
    release = {
      ...release,
      provenance: {
        ...release.provenance,
        releaseToolCommit: authority.releaseToolCommit
      }
    };
  }
  if (command === "plan") {
    printJson(await planR2Release({ release, client }));
    return;
  }
  let result;
  try {
    result = await publishR2Release({ release, client, progress });
    result = { ...result, publicationProgress: progress.finish() };
  } catch (error) {
    progress.fail(error);
    progress.finish();
    throw error;
  }
  await writeReceipt(command, version, result);
  printJson(result);
}

function createClientFromEnvironment(command, onTransferProgress) {
  const accountId = requiredEnvironment("PI67_R2_ACCOUNT_ID");
  const accessKeyId = requiredEnvironment("PI67_R2_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnvironment("PI67_R2_SECRET_ACCESS_KEY");
  const bucketName = process.env.PI67_R2_BUCKET_NAME ?? "pi67-desktop-updates";
  const cleanup = command === "cleanup";
  const apiToken = cleanup ? requiredEnvironment("PI67_CLOUDFLARE_API_TOKEN") : undefined;
  const zoneId = cleanup ? requiredEnvironment("PI67_CLOUDFLARE_ZONE_ID") : undefined;
  return createCloudflareR2Client({
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    apiToken,
    zoneId,
    onTransferProgress
  });
}

async function runProgressStage(progress, stage, operation, completedManifestState = stage.manifestState) {
  progress.stage({ phase: "start", ...stage });
  try {
    const result = await operation();
    progress.stage({
      phase: "complete",
      name: stage.name,
      manifestState: completedManifestState
    });
    return result;
  } catch (error) {
    progress.stage({
      phase: "failed",
      name: stage.name,
      detail: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function assertNoFutureR2Versions(retentionPlan) {
  if (retentionPlan.futureVersions.length === 0) return;
  throw new Error(
    `Refusing R2 mutation because recognized artifacts are newer than the target version: ${retentionPlan.futureVersions.join(", ")}`
  );
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be provided through repository-external operator configuration.`);
  return value;
}

export function parseReleaseCommandFlags(command, args) {
  const allowed = {
    plan: new Set(["bundle"]),
    publish: new Set(["bundle", "confirm-version", "source-commit"]),
    cleanup: new Set(["confirm-version", "confirm-target-upgrades"])
  }[command];
  if (!allowed) usage();
  const flags = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) usage();
    const name = argument.slice(2);
    if (!allowed.has(name) || flags.has(name)) usage();
    if (name === "confirm-target-upgrades") flags.set(name, true);
    else {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) usage();
      flags.set(name, value);
      index += 1;
    }
  }
  return flags;
}

function artifactContentType(name) {
  if (name.endsWith(".zip")) return "application/zip";
  if (name.endsWith(".dmg")) return "application/x-apple-diskimage";
  return "application/vnd.microsoft.portable-executable";
}

async function writeReceipt(command, version, result) {
  await mkdir(defaultReceiptDirectory, { recursive: true, mode: 0o700 });
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const path = join(defaultReceiptDirectory, `${timestamp}-${command}-${version}.json`);
  await writeFile(path, `${JSON.stringify({ command, version, completedAt: new Date().toISOString(), result }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  throw new Error(
    "Usage: r2-update-release.mjs <plan|publish|cleanup> [--bundle <path>] "
    + "[--confirm-version <version>] [--source-commit <40-char-sha>] "
    + "[--confirm-target-upgrades]"
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
