import { createHash } from "node:crypto";
import { lstat, readdir, readlink, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { valid } from "semver";
import { readFileByteIdentity } from "../packaging/windows-artifact-identity.mjs";
import { planLocalArtifactCleanup } from "./local-artifact-cleanup.mjs";
import { archivePathsInUse, planReleaseArchiveRetention, withReleaseArchiveLock } from "./release-archive-retention.mjs";
import { loadRetainedPreview } from "./retained-preview.mjs";
import { readWindowsPreviewCandidateIdentity } from "./windows-preview-candidate.mjs";

const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
const productName = /^(?:New-Money|Pi-67-Desktop)-(.+)-(mac-arm64|win-x64)(?:-unsigned-preview)?\.(dmg|zip|exe)$/u;

// This is narrower than the explicit whole-batch cleanup: applications, evidence,
// unknown outputs and different-byte builds never become duplicate targets.
export async function planLocalArtifactRetention({ root = defaultRoot, publishedRelease } = {}) {
  root = resolve(root);
  if (await realpath(root) !== root) throw new Error("Artifact retention root must be canonical.");
  const artifactsRoot = join(root, "artifacts");
  if (await realpath(artifactsRoot) !== artifactsRoot) throw new Error("Artifact directory must be canonical.");
  const verified = await loadRetainedPreview(root);
  if (publishedRelease && (!verified || !publicationMatches(verified, publishedRelease))) {
    throw new Error("Published release does not match the retained preview.");
  }
  if (!verified) return { targets: [], bytes: 0, retainedVersion: undefined, preserved: [] };
  const plan = await planLocalArtifactCleanup({ root });
  const archivePlan = await planReleaseArchiveRetention({ releaseRoot: join(root, "artifacts/release") });
  const replacements = new Map();
  for (const artifact of verified.artifacts) replacements.set(productKey(artifact.name), artifact);
  for (const archive of archivePlan.retained) {
    const key = productKey(archive.name);
    if (key && !replacements.has(key)) {
      const identity = await readFileByteIdentity(archive.path);
      replacements.set(key, { bytes: identity.byteLength, sha256: identity.sha256, path: archive.path });
    }
  }
  const pins = [...archivePlan.retained, ...archivePlan.targets].filter(file => file.pinned)
    .map(file => `${file.version}/${file.platform}`);
  const failedArchives = new Set([...archivePlan.retained, ...archivePlan.targets]
    .filter(file => file.state !== "COMPLETE").map(file => file.path));
  const targets = []; const preserved = [];
  const publishedBundle = join(root, "artifacts/r2-update-bundle");
  for (const target of plan.targets.filter(target => target.kind === "file")) {
    const key = productKey(basename(target.absolutePath));
    const replacement = replacements.get(key);
    if (!replacement || replacement.path === target.absolutePath) continue;
    if (failedArchives.has(target.absolutePath)) {
      preserved.push({ path: target.relativePath, reason: "FAILED_BUILD" }); continue;
    }
    if (dirname(target.absolutePath) === publishedBundle && !publishedRelease) continue;
    if (pins.some(group => key.startsWith(`${group}/`)) || await isPinned(target.absolutePath, root)) {
      preserved.push({ path: target.relativePath, reason: "PINNED" }); continue;
    }
    const identity = await readFileByteIdentity(target.absolutePath);
    if (identity.byteLength !== replacement.bytes || identity.sha256 !== replacement.sha256) {
      preserved.push({ path: target.relativePath, reason: "DIFFERENT_BYTES" }); continue;
    }
    targets.push({ ...target, identity, replacement, fingerprint: await fingerprint(target.absolutePath), reason: "VERIFIED_DUPLICATE" });
  }
  // An unpacked tree is consumed only when its tested installer has a retained replacement.
  for (const target of plan.targets.filter(target => target.kind === "directory" && basename(target.absolutePath) === "win-unpacked")) {
    const directory = dirname(target.absolutePath);
    const consumed = targets.find(file => dirname(file.absolutePath) === directory && productKey(basename(file.absolutePath))?.includes("/win-x64/exe"));
    if (!consumed) continue;
    if (await isPinned(target.absolutePath, root)) { preserved.push({ path: target.relativePath, reason: "PINNED" }); continue; }
    const identityPath = join(directory, "windows-preview-candidate-identity.json");
    if (!await optionalStat(identityPath)) { preserved.push({ path: target.relativePath, reason: "NO_CANDIDATE_IDENTITY" }); continue; }
    const candidate = await readWindowsPreviewCandidateIdentity(identityPath);
    if (candidate.installer.byteLength !== consumed.identity.byteLength || candidate.installer.sha256 !== consumed.identity.sha256) {
      throw new Error("Consumed Windows installer differs from its candidate identity.");
    }
    const executable = await readFileByteIdentity(join(directory, candidate.packagedExecutable.fileName));
    if (executable.byteLength !== candidate.packagedExecutable.byteLength || executable.sha256 !== candidate.packagedExecutable.sha256) {
      throw new Error("Consumed Windows executable differs from its candidate identity.");
    }
    targets.push({ ...target, fingerprint: await fingerprint(target.absolutePath), candidateIdentity: {
      path: identityPath, ...await readFileByteIdentity(identityPath)
    }, replacement: consumed.replacement, reason: "CONSUMED_WINDOWS_TREE" });
  }
  targets.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { targets, bytes: targets.reduce((sum, target) => sum + target.bytes, 0), retainedVersion: verified.version, preserved };
}

export async function maintainLocalArtifactCopies({ root = defaultRoot, apply = false, lockHeld = false,
  publishedRelease, probeInUse = archivePathsInUse } = {}) {
  if (apply && !lockHeld) return withReleaseArchiveLock(join(resolve(root), "artifacts/release"),
    () => maintainLocalArtifactCopies({ root, apply, lockHeld: true, publishedRelease, probeInUse }));
  const plan = await planLocalArtifactRetention({ root, publishedRelease });
  if (!apply || !plan.targets.length) return { ...plan, removed: [] };
  const busy = await probeInUse(plan.targets.map(target => target.absolutePath));
  if (busy.length) throw new Error("Local artifact copies are in use; no copies were deleted.");
  for (const target of plan.targets) await assertUnchanged(target, resolve(root));
  const removed = [];
  for (const target of plan.targets) {
    await assertUnchanged(target, resolve(root));
    await rm(target.absolutePath, { recursive: target.kind === "directory", force: false });
    removed.push(target.relativePath);
  }
  return { ...plan, removed };
}

async function assertUnchanged(target, root) {
  if (await realpath(target.absolutePath) !== target.absolutePath
    || await realpath(target.replacement.path) !== target.replacement.path) throw new Error("Artifact path changed before retirement.");
  const key = productKey(basename(target.absolutePath)) ?? productKey(basename(target.replacement.path));
  const group = key?.split("/").slice(0, 2).join("/");
  if ((await readdir(join(root, "artifacts/release"))).some(name => name.endsWith(".keep")
    && productKey(name.slice(0, -5).replace(/\.blockmap$/u, ""))?.startsWith(`${group}/`))) {
    throw new Error("Artifact version was pinned after planning.");
  }
  if (await isPinned(target.absolutePath, root) || await fingerprint(target.absolutePath) !== target.fingerprint) {
    throw new Error("Local artifact target changed or was pinned after planning.");
  }
  const replacement = await readFileByteIdentity(target.replacement.path);
  if (replacement.byteLength !== target.replacement.bytes || replacement.sha256 !== target.replacement.sha256) {
    throw new Error("Retained replacement changed before artifact retirement.");
  }
  if (target.identity) {
    const identity = await readFileByteIdentity(target.absolutePath);
    if (identity.byteLength !== target.identity.byteLength || identity.sha256 !== target.identity.sha256) throw new Error("Duplicate identity changed.");
  }
  if (target.candidateIdentity) {
    const identity = await readFileByteIdentity(target.candidateIdentity.path);
    if (identity.byteLength !== target.candidateIdentity.byteLength || identity.sha256 !== target.candidateIdentity.sha256) throw new Error("Candidate identity changed.");
  }
}

function publicationMatches(verified, published) {
  return verified.version === published.version && verified.provenance.sourceCommit === published.provenance?.sourceCommit
    && verified.artifacts.every(artifact => published.artifacts?.some(file => productKey(file.name) === productKey(artifact.name)
      && file.bytes === artifact.bytes && file.sha256 === artifact.sha256));
}

function productKey(name) {
  const match = name.match(productName);
  return match && valid(match[1]) === match[1] && (match[2] === "win-x64") === (match[3] === "exe")
    ? `${match[1]}/${match[2]}/${match[3]}` : undefined;
}

async function isPinned(path, root) {
  if (await optionalStat(`${path}.keep`)) return true;
  for (let directory = dirname(path); directory !== root; directory = dirname(directory)) {
    if (await optionalStat(join(directory, ".keep"))) return true;
    if (dirname(directory) === directory) throw new Error("Artifact path escaped its root.");
  }
  return false;
}

async function fingerprint(path) {
  const hash = createHash("sha256");
  async function walk(current) {
    const metadata = await lstat(current);
    if (basename(current) === ".keep") throw new Error("Artifact payload is pinned.");
    hash.update(JSON.stringify([relative(path, current), metadata.dev, metadata.ino, metadata.mode,
      metadata.size, metadata.mtimeMs, metadata.ctimeMs, metadata.isSymbolicLink() ? await readlink(current) : ""]));
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) for (const name of (await readdir(current)).sort()) await walk(join(current, name));
  }
  await walk(path); return hash.digest("hex");
}

async function optionalStat(path) {
  try { return await lstat(path); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter(arg => arg !== "--");
  if (args.length && !(args.length === 2 && args[0] === "apply" && args[1] === "--confirm-local-artifact-retention")) {
    throw new Error("Usage: local-artifact-retention.mjs [apply --confirm-local-artifact-retention]");
  }
  const result = await maintainLocalArtifactCopies({ apply: Boolean(args.length) });
  for (const target of result.targets) console.log(`${args.length ? "REMOVED" : "ELIGIBLE"} ${target.relativePath} (${target.bytes} bytes; ${target.reason})`);
  for (const item of result.preserved) console.log(`PRESERVE ${item.path} (${item.reason})`);
  console.log(`Local artifact copies: removed=${result.removed.length}; eligibleBytes=${result.bytes}; currentVerified=${result.retainedVersion ?? "none"}; applications/evidence preserved.`);
}
