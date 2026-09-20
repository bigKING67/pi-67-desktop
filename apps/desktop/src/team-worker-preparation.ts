import type { KeyObject } from "node:crypto";
import { lstat, mkdir, mkdtemp, realpath, rmdir } from "node:fs/promises";
import { release } from "node:os";
import { isAbsolute, join, sep } from "node:path";
import { readExistingLocalMemoryIdentity } from "./local-memory-identity.mjs";
import { admitOpenVikingRuntime } from "./openviking-runtime-admission.js";
import { bindSharedKnowledgeOwner, type SharedKnowledgeReceiptOwner } from "./shared-knowledge-owner.js";

type DirectoryIdentity = { path: string; dev: number; ino: number };

/** Main-only preflight, NOT a launch permit or model authorization. The caller
 * supplies trusted identity and a lifetime cancelled on account/scope changes.
 * Production bootstrap admission and the index owner must precede actual launch.
 */
export async function prepareTeamWorker(options: {
  memoryRoot: string;
  trustedKey: KeyObject;
  loadRuntime(this: void, signal: AbortSignal): Promise<{ runtimeRoot: string; manifest: Buffer; signature: Buffer; dataRoot: string }>;
}, input: SharedKnowledgeReceiptOwner, lifetime: AbortSignal) {
  const binding = bindSharedKnowledgeOwner(input);
  const { memoryRoot, trustedKey, loadRuntime } = options;
  lifetime.throwIfAborted();
  if (process.platform !== "darwin" || process.arch !== "arm64" || Number.parseInt(release(), 10) < 23) {
    throw new Error("Team worker preparation requires macOS 14+ Apple Silicon.");
  }
  if (!isAbsolute(memoryRoot) || memoryRoot.includes("\0")) throw new Error("Team preparation requires an absolute memory root.");
  const signal = AbortSignal.any([lifetime, AbortSignal.timeout(60_000)]);
  const originalRoot = await directoryIdentity(memoryRoot);
  const root = await realpath(memoryRoot);
  const anchors = [originalRoot, await directoryIdentity(root)];
  const assertProfile = async () => {
    await assertDirectories(anchors);
    if (await readExistingLocalMemoryIdentity(root) !== binding.owner.localProfileId) {
      throw new Error("Team worker local profile mismatch.");
    }
    await assertDirectories(anchors);
  };
  await assertProfile();
  const configuration = await loadRuntime(signal);
  if (configuration.dataRoot !== root) throw new Error("Team worker memory root changed.");
  const runtime = await admitOpenVikingRuntime(configuration, trustedKey, signal);
  const projections = join(root, "team-projections");
  if (runtime.runtimeRoot === projections || runtime.runtimeRoot.startsWith(`${projections}${sep}`)
      || root === runtime.runtimeRoot || root.startsWith(`${runtime.runtimeRoot}${sep}`)) {
    throw new Error("Team projection and runtime directories must be separate.");
  }
  await assertProfile();
  for (const path of [projections, join(projections, binding.key), join(projections, binding.key, "staging")]) {
    signal.throwIfAborted();
    await assertDirectories(anchors);
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
    anchors.push(await directoryIdentity(path));
    await assertDirectories(anchors);
  }
  signal.throwIfAborted();
  const directory = await mkdtemp(join(projections, binding.key, "staging/run-"));
  const identity = await directoryIdentity(directory);
  let discarded = false;
  // Storage identity only, including after authorization cancellation. This
  // supports exact owned-file cleanup; it grants no read/model/launch authority.
  const assertStorage = async () => {
    if (discarded) throw new Error("Team worker preparation has been discarded.");
    await assertDirectories([...anchors, identity]);
  };
  const discard = async () => {
    if (discarded) return;
    // Only this exact empty staging directory is ours to remove. No recursive
    // deletion, permission repair or cleanup of parent/shared/private content.
    await assertStorage();
    await rmdir(directory);
    discarded = true;
  };
  // Rechecks owner lifetime/profile/directories, not a cached runtime lease.
  // A future launch owner must freshly admit bootstrap/runtime before spawning.
  const assertCurrent = async () => {
    if (discarded) throw new Error("Team worker preparation has been discarded.");
    lifetime.throwIfAborted();
    await assertProfile();
    await assertDirectories([identity]);
    lifetime.throwIfAborted();
  };
  try {
    await assertCurrent();
    signal.throwIfAborted();
    return Object.freeze({ owner: binding.owner, scopeKey: binding.key, directory,
      runtime, assertCurrent, assertStorage, discard });
  } catch (error) {
    try { await discard(); }
    catch { throw new Error("Team worker preparation failed; staging cleanup could not be confirmed."); }
    throw error;
  }
}

async function directoryIdentity(path: string): Promise<DirectoryIdentity> {
  const value = await lstat(path);
  if (!value.isDirectory() || value.isSymbolicLink() || value.uid !== process.getuid?.() || (value.mode & 0o077) !== 0) {
    throw new Error("Unsafe team worker directory.");
  }
  return { path, dev: value.dev, ino: value.ino };
}

async function assertDirectories(anchors: readonly DirectoryIdentity[]): Promise<void> {
  for (const anchor of anchors) {
    const current = await directoryIdentity(anchor.path);
    if (current.dev !== anchor.dev || current.ino !== anchor.ino) throw new Error("Team worker directory changed.");
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
