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
  loadLocalR2Release,
  manifestsMatch,
  parseR2ArtifactKey,
  R2_UPDATE_MANIFEST_NAME,
  R2_UPDATE_ORIGIN
} from "./r2-update-release-contract.mjs";
import { readPiRuntimeContract } from "./pi-runtime-contract.mjs";
import {
  assertCleanPreviewCandidateSource,
  verifyR2PublicationSource
} from "./preview-candidate-source.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const defaultBundleDirectory = join(root, "artifacts/r2-update-bundle");
const defaultReceiptDirectory = join(root, "artifacts/r2-release-receipts");
const mutableManifestCacheControl = "no-store";

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
  verifyArtifact = verifyPublicArtifact
}) {
  const plan = await planR2Release({ release, client, origin, fetchImpl, readPublicManifest });
  if (plan.immutableConflicts.length > 0) {
    throw new Error("Refusing to overwrite an immutable R2 artifact with different bytes.");
  }
  for (const artifact of release.artifacts) {
    if (plan.uploads.includes(artifact.name)) {
      await client.putFile(artifact.name, artifact.path, artifactContentType(artifact.name));
    }
  }
  for (const artifact of release.artifacts) {
    await verifyArtifact(origin, artifact, fetchImpl);
  }
  if (plan.manifestAction === "publish-last") {
    await client.putFile(
      R2_UPDATE_MANIFEST_NAME,
      release.manifestPath,
      "application/json; charset=utf-8",
      mutableManifestCacheControl
    );
  }
  const publicManifest = await readPublicManifest(origin, fetchImpl);
  if (!manifestsMatch(publicManifest, release.manifest)) {
    throw new Error("Public R2 manifest does not match the local release after publication.");
  }
  return { ...plan, provenance: release.provenance, published: true };
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

  const client = createClientFromEnvironment(command);
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
  const result = command === "plan"
    ? await planR2Release({ release, client })
    : await publishR2Release({ release, client });
  if (command === "publish") await writeReceipt(command, version, result);
  printJson(result);
}

function createClientFromEnvironment(command) {
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
    zoneId
  });
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
