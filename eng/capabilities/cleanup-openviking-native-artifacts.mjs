import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { loadOpenVikingRuntimeInstallation } from "../../apps/desktop/src/openviking-runtime-installation.ts";
import { verifyOpenVikingManifest } from "../../apps/desktop/src/openviking-runtime-manifest.mts";
import { openVikingRuntimeTrustedKey } from "../../apps/desktop/src/openviking-runtime-trust.ts";
import { runtimeTreeIdentity } from "../../apps/desktop/src/openviking-runtime-tree.mts";
import {
  inspectNativeArtifacts,
  listNativeArtifactPayloads,
  nativeArtifactInUse,
  retireNativeArtifact,
  withNativeArtifactLock
} from "./native-artifact-store.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const confirmation = "--confirm-openviking-native-cleanup";

export async function planOpenVikingNativeCleanup({
  probeInUse = nativeArtifactInUse,
  root = repositoryRoot
} = {}) {
  const canonicalRoot = resolve(root);
  if (await realpath(canonicalRoot) !== canonicalRoot) throw new Error("Repository root must be canonical.");
  const parent = join(canonicalRoot, "artifacts/openviking-native");
  const parentMetadata = await optionalMetadata(parent);
  if (!parentMetadata) return emptyPlan(canonicalRoot, parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink() || await realpath(parent) !== parent) {
    throw new Error("OpenViking native artifact root must be a canonical directory.");
  }

  const entries = await inspectNativeArtifacts(parent);
  const signed = entries.filter(entry => entry.kind === "signed" && entry.status === "READY" && artifactTree(entry));
  const protectedArtifacts = [];
  const protectedSigned = [];
  const targets = [];
  const retainedPreparations = [];
  for (const purpose of [...new Set(signed.map(entry => entry.purpose))].sort((left, right) => left.localeCompare(right))) {
    const group = signed.filter(entry => entry.purpose === purpose);
    const current = group.at(-1);
    protectedSigned.push(current);
    protectedArtifacts.push({ reason: "CURRENT_SIGNED_RUNTIME", relativePath: repositoryRelative(canonicalRoot, current.path) });
    for (const previous of group.slice(0, -1)) {
      const pinned = Boolean(await optionalMetadata(join(previous.path, ".keep")));
      const inUse = await probeInUse(previous.path);
      if (pinned || inUse) {
        protectedSigned.push(previous);
        protectedArtifacts.push({
          reason: pinned ? "PINNED_SIGNED_RUNTIME" : "IN_USE_SIGNED_RUNTIME",
          relativePath: repositoryRelative(canonicalRoot, previous.path)
        });
      } else {
        targets.push(await describeTarget({
          artifact: previous,
          canonicalRoot,
          kind: "superseded-signed",
          replacementInstallation: current.path,
          replacementRelativePath: repositoryRelative(canonicalRoot, current.path),
          treeSha256: artifactTree(current)
        }));
      }
    }
  }

  const readyPreparations = entries.filter(entry => entry.kind === "preparation" && entry.status === "READY");
  const successfulPreparationEvidence = new Map();
  for (const preparation of readyPreparations) {
    const treeSha256 = artifactTree(preparation);
    const signedMatch = protectedSigned.filter(entry => artifactTree(entry) === treeSha256).at(-1);
    if (!treeSha256 || !signedMatch) {
      retainedPreparations.push({ reason: "NO_VERIFIED_SIGNED_MATCH", relativePath: repositoryRelative(canonicalRoot, preparation.path) });
      continue;
    }
    successfulPreparationEvidence.set(preparation.purpose, { preparation, signedMatch });
    const preparedRuntime = join(preparation.path, "New Money 本地运行包");
    const preparedMetadata = await optionalMetadata(preparedRuntime);
    if (!preparedMetadata || !preparedMetadata.isDirectory() || preparedMetadata.isSymbolicLink()) {
      throw new Error(`Ready preparation has no safe source runtime: ${repositoryRelative(canonicalRoot, preparation.path)}`);
    }
    const pinned = Boolean(await optionalMetadata(join(preparation.path, ".keep")));
    const inUse = await probeInUse(preparation.path);
    if (pinned || inUse) {
      retainedPreparations.push({
        reason: pinned ? "PINNED" : "IN_USE",
        relativePath: repositoryRelative(canonicalRoot, preparation.path)
      });
      continue;
    }
    targets.push(await describeTarget({
      artifact: preparation,
      canonicalRoot,
      kind: "redundant-preparation",
      preparedRuntime,
      replacementInstallation: signedMatch.path,
      replacementRelativePath: repositoryRelative(canonicalRoot, signedMatch.path),
      treeSha256
    }));
  }

  for (const failure of entries.filter(entry => entry.kind === "preparation" && entry.status === "FAILED")) {
    const evidence = successfulPreparationEvidence.get(failure.purpose);
    const payloads = await listNativeArtifactPayloads(failure.path);
    if (!evidence || evidence.preparation.createdAt <= failure.createdAt || payloads.length === 0) {
      protectedArtifacts.push({ reason: "DIAGNOSTIC_FAILURE", relativePath: repositoryRelative(canonicalRoot, failure.path) });
      continue;
    }
    const pinned = Boolean(await optionalMetadata(join(failure.path, ".keep")));
    const inUse = await probeInUse(failure.path);
    if (pinned || inUse) {
      protectedArtifacts.push({
        reason: pinned ? "PINNED_DIAGNOSTIC_FAILURE" : "IN_USE_DIAGNOSTIC_FAILURE",
        relativePath: repositoryRelative(canonicalRoot, failure.path)
      });
      continue;
    }
    targets.push(await describeTarget({
      artifact: failure,
      canonicalRoot,
      kind: "superseded-failure",
      replacementInstallation: evidence.signedMatch.path,
      replacementRelativePath: repositoryRelative(canonicalRoot, evidence.signedMatch.path),
      treeSha256: artifactTree(evidence.signedMatch)
    }));
  }

  targets.sort((left, right) => left.artifact.path.localeCompare(right.artifact.path));
  protectedArtifacts.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  retainedPreparations.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return {
    bytes: targets.reduce((sum, target) => sum + target.bytes, 0),
    parent,
    protectedArtifacts,
    retainedEvidence: ["receipt.json", "assembly receipts", "native-artifact.json", "manifest metadata"],
    retainedPreparations,
    root: canonicalRoot,
    targets
  };
}

export async function applyOpenVikingNativeCleanup({
  confirmed = false,
  probeInUse = nativeArtifactInUse,
  root = repositoryRoot,
  validateTarget = validateRedundantPreparation
} = {}) {
  if (!confirmed) throw new Error(`OpenViking native cleanup requires ${confirmation}.`);
  const canonicalRoot = resolve(root);
  const parent = join(canonicalRoot, "artifacts/openviking-native");
  return withNativeArtifactLock(parent, async () => {
    const before = await planOpenVikingNativeCleanup({ probeInUse, root: canonicalRoot });
    const removed = [];
    for (const target of before.targets) {
      await validateTarget(target);
      await retireNativeArtifact(target.artifact, probeInUse);
      removed.push(...target.payloads.map(payload => payload.relativePath));
    }
    const after = await planOpenVikingNativeCleanup({ probeInUse, root: canonicalRoot });
    if (after.targets.length > 0) throw new Error("OpenViking native cleanup left a verified redundant preparation payload.");
    return { after, before, removed };
  });
}

export function parseOpenVikingNativeCleanupArguments(arguments_) {
  const normalized = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  if (normalized.length === 0 || (normalized.length === 1 && normalized[0] === "plan")) {
    return { confirmed: false, mode: "plan" };
  }
  if (normalized.length === 2 && normalized[0] === "apply" && normalized[1] === confirmation) {
    return { confirmed: true, mode: "apply" };
  }
  throw new Error(`Usage: node eng/capabilities/cleanup-openviking-native-artifacts.mjs [plan | apply ${confirmation}]`);
}

async function validateRedundantPreparation(target) {
  const signal = new AbortController().signal;
  if (target.kind === "redundant-preparation") {
    const preparedTree = await runtimeTreeIdentity(target.preparedRuntime, signal);
    if (preparedTree.sha256 !== target.treeSha256) throw new Error("Prepared runtime identity changed before cleanup.");
  }
  const installation = await loadOpenVikingRuntimeInstallation(target.replacementInstallation, signal);
  const signedTree = await runtimeTreeIdentity(installation.runtimeRoot, signal);
  verifyOpenVikingManifest(installation.manifest, installation.signature, openVikingRuntimeTrustedKey(), {
    platform: process.platform, arch: process.arch, pythonVersion: "3.12.10",
    openvikingVersion: "0.4.22", sdkVersion: "0.1.10", treeSha256: signedTree.sha256
  });
  if (signedTree.sha256 !== target.treeSha256) throw new Error("Signed runtime no longer matches the prepared runtime.");
  const runtimeRoot = await realpath(installation.runtimeRoot);
  const python = await realpath(join(runtimeRoot, "bin/python3.12"));
  if (!python.startsWith(`${runtimeRoot}${sep}`) || !(await stat(python)).isFile()) {
    throw new Error("Invalid managed OpenViking interpreter.");
  }
}

async function describeTarget({ artifact, canonicalRoot, ...details }) {
  const payloads = [];
  for (const path of await listNativeArtifactPayloads(artifact.path)) {
    payloads.push({ bytes: await allocatedBytes(path), relativePath: repositoryRelative(canonicalRoot, path) });
  }
  return { artifact, bytes: payloads.reduce((sum, payload) => sum + payload.bytes, 0), payloads, ...details };
}

function artifactTree(entry) {
  const value = entry.value?.tree?.sha256;
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : undefined;
}

async function allocatedBytes(path, seen = new Set()) {
  const metadata = await lstat(path);
  const identity = metadata.nlink > 1 && metadata.ino > 0 ? `${metadata.dev}:${metadata.ino}` : undefined;
  if (identity && seen.has(identity)) return 0;
  if (identity) seen.add(identity);
  let bytes = Math.max(metadata.size, (metadata.blocks ?? 0) * 512);
  if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
    for (const name of await readdir(path)) bytes += await allocatedBytes(join(path, name), seen);
  }
  return bytes;
}

function repositoryRelative(root, path) {
  const value = relative(root, path);
  if (!value || value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    throw new Error("Native artifact path escapes the repository root.");
  }
  return value;
}

function emptyPlan(root, parent) {
  return { bytes: 0, parent, protectedArtifacts: [], retainedEvidence: [], retainedPreparations: [], root, targets: [] };
}

async function optionalMetadata(path) {
  try { return await lstat(path); }
  catch (error) { if (error?.code === "ENOENT") return undefined; throw error; }
}

function formatBytes(bytes) {
  return `${bytes} bytes (${(bytes / 1024 / 1024).toFixed(1)} MiB)`;
}

function printPlan(plan) {
  console.log(`OpenViking native cleanup plan: ${plan.targets.length} preparation(s), ${formatBytes(plan.bytes)}.`);
  for (const target of plan.targets) {
    for (const payload of target.payloads) console.log(`DELETE ${payload.relativePath} (${formatBytes(payload.bytes)})`);
    console.log(`VERIFY ${target.kind} replacement ${target.replacementRelativePath} tree=${target.treeSha256}`);
  }
  for (const artifact of plan.protectedArtifacts) console.log(`PRESERVE ${artifact.relativePath} (${artifact.reason})`);
  for (const artifact of plan.retainedPreparations) console.log(`PRESERVE ${artifact.relativePath} (${artifact.reason})`);
  if (plan.retainedEvidence.length > 0) console.log(`PRESERVE ${plan.retainedEvidence.join("; ")}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOpenVikingNativeCleanupArguments(process.argv.slice(2));
    if (options.mode === "plan") printPlan(await planOpenVikingNativeCleanup());
    else {
      const result = await applyOpenVikingNativeCleanup({ confirmed: options.confirmed });
      printPlan(result.before);
      console.log(`Removed ${result.removed.length} redundant native payload(s); verified residue count=0.`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
