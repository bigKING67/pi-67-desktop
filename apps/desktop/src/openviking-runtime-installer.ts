import { type KeyObject } from "node:crypto";
import { cp, lstat, mkdtemp, open, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
import { loadOpenVikingRuntimeInstallation } from "./openviking-runtime-installation.js";
import { verifyOpenVikingManifest } from "./openviking-runtime-manifest.mjs";
import { runtimeTreeIdentity } from "./openviking-runtime-tree.mjs";
import { openVikingRuntimeTrustedKey } from "./openviking-runtime-trust.js";
import { locateTeamQueryBootstrap, locateTeamWorkerBootstrap } from "./team-worker-bootstrap.js";

export const OPENVIKING_INSTALLATION_NAME = "openviking-0.4.16-python-3.12.10-sdk-0.1.10-darwin-arm64";
export const OPENVIKING_TEAM_INSTALLATION_NAME = `${OPENVIKING_INSTALLATION_NAME}-team-index-v1`;
export const OPENVIKING_QUERY_INSTALLATION_NAME = `${OPENVIKING_INSTALLATION_NAME}-team-query-v1`;

/** Main/operator-owned local directory import. No download, overwrite or activation.
 * The parent must already be owner-controlled. An interrupted process leaves its
 * exclusive lock/staging for explicit recovery, never automatic stale-lock theft.
 */
export async function installOpenVikingRuntime(options: {
  source: string;
  parent: string;
  signal: AbortSignal;
  trustedKey?: KeyObject;
  /** Explicit parallel team revision. Never changes the private installation. */
  purpose?: "private" | "team-index-v1" | "team-query-v1";
}) {
  const { source, parent, signal, trustedKey = openVikingRuntimeTrustedKey(), purpose = "private" } = options;
  signal.throwIfAborted();
  if (purpose !== "private" && purpose !== "team-index-v1" && purpose !== "team-query-v1") throw new Error("Unsupported runtime installation purpose.");
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Runtime installation requires macOS arm64.");
  for (const path of [source, parent]) {
    if (!isAbsolute(path) || path.includes("\0")) throw new Error("Runtime installation requires absolute paths.");
    const entry = await lstat(path);
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.uid !== process.getuid?.()
      || (entry.mode & 0o022) !== 0) throw new Error("Runtime installation requires owned directories.");
  }
  const sourceRoot = await realpath(source);
  const parentRoot = await realpath(parent);
  if (within(sourceRoot, parentRoot) || within(parentRoot, sourceRoot)) throw new Error("Source and installation parent must not overlap.");
  const name = { private: OPENVIKING_INSTALLATION_NAME, "team-index-v1": OPENVIKING_TEAM_INSTALLATION_NAME,
    "team-query-v1": OPENVIKING_QUERY_INSTALLATION_NAME }[purpose];
  const target = join(parentRoot, name);
  const lockPath = join(parentRoot, `.${name}.install-lock`);
  const lock = await open(lockPath, "wx", 0o600);
  let staging: string | undefined;
  try {
    await absent(target);
    const approved = await verify(sourceRoot);
    signal.throwIfAborted();
    staging = await mkdtemp(join(parentRoot, ".openviking-install-"));
    const stagedRuntime = join(staging, "runtime");
    await cp(approved.runtimeRoot, stagedRuntime, { recursive: true, verbatimSymlinks: true,
      force: false, errorOnExist: true, filter: () => { signal.throwIfAborted(); return true; } });
    // Publish only the bounded metadata already read and verified, not mutable source metadata.
    await writeFile(join(staging, "manifest.json"), approved.manifest, { flag: "wx", mode: 0o600 });
    await writeFile(join(staging, "manifest.sig"), approved.signature, { flag: "wx", mode: 0o600 });
    const copied = await verify(staging);
    signal.throwIfAborted();
    await absent(target);
    signal.throwIfAborted();
    // Same-filesystem rename is the visibility commit; consumers never see partial staging.
    await rename(staging, target);
    staging = undefined;
    return { installationRoot: target, tree: copied.tree, activated: false as const };
  } finally {
    try { if (staging) await rm(staging, { recursive: true, force: true }); }
    finally { await lock.close(); await unlink(lockPath); }
  }

  async function verify(root: string) {
    const installed = await loadOpenVikingRuntimeInstallation(root, signal);
    const tree = await runtimeTreeIdentity(installed.runtimeRoot, signal);
    verifyOpenVikingManifest(installed.manifest, installed.signature, trustedKey, {
      platform: "darwin", arch: "arm64", pythonVersion: "3.12.10", openvikingVersion: "0.4.16",
      sdkVersion: "0.1.10", treeSha256: tree.sha256
    });
    // A suffix is not evidence of capability. The signed tree must contain the
    // exact admitted v1 bootstrap, both before copying and before publication.
    if (purpose === "team-index-v1") await locateTeamWorkerBootstrap(installed.runtimeRoot, signal);
    if (purpose === "team-query-v1") await locateTeamQueryBootstrap(installed.runtimeRoot, signal);
    return { ...installed, tree };
  }
}

function within(path: string, root: string) { return path === root || path.startsWith(`${root}${sep}`); }
async function absent(path: string) {
  try { await lstat(path); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error("Runtime version already exists; replacement is not permitted.");
}
