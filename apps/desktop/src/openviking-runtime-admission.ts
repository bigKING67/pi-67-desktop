import type { KeyObject } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { verifyOpenVikingManifest } from "./openviking-runtime-manifest.mjs";
import { runtimeTreeIdentity } from "./openviking-runtime-tree.mjs";

/** Main-only shared admission for private runtime and isolated team preparation.
 * No identity creation, model settings, launch, cached trust or directory writes.
 * The owner-controlled installation must remain unchanged until launch.
 */
export async function admitOpenVikingRuntime(configuration: {
  runtimeRoot: string; manifest: Buffer; signature: Buffer;
}, trustedKey: KeyObject, signal: AbortSignal) {
  signal.throwIfAborted();
  const runtimeRoot = configuration.runtimeRoot, manifest = Buffer.from(configuration.manifest), signature = Buffer.from(configuration.signature);
  const tree = await runtimeTreeIdentity(runtimeRoot, signal);
  verifyOpenVikingManifest(manifest, signature, trustedKey, {
    platform: process.platform, arch: process.arch, pythonVersion: "3.12.10",
    openvikingVersion: "0.4.16", sdkVersion: "0.1.10", treeSha256: tree.sha256
  });
  const root = await realpath(runtimeRoot), python = await realpath(join(root, "bin/python3.12"));
  if (!python.startsWith(`${root}${sep}`) || !(await stat(python)).isFile()) throw new Error("Invalid managed OpenViking interpreter.");
  signal.throwIfAborted();
  return Object.freeze({ runtimeRoot: root, python, tree: Object.freeze(tree) });
}
