import { constants } from "node:fs";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { cp, lstat, open, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeTreeIdentity } from "../../apps/desktop/src/openviking-runtime-tree.mts";
import { verifyOpenVikingManifest } from "../../apps/desktop/src/openviking-runtime-manifest.mts";
import { loadOpenVikingRuntimeInstallation } from "../../apps/desktop/src/openviking-runtime-installation.ts";
import { openVikingRuntimeTrustedKey } from "../../apps/desktop/src/openviking-runtime-trust.ts";

import { runNativeArtifact, withNativeArtifactLock } from "./native-artifact-store.mjs";

function signedArtifactKey(treeSha256, trustedKey) {
  return createHash("sha256").update(JSON.stringify(["signed-v1", treeSha256,
    trustedKey.export({ format: "der", type: "spki" }).toString("base64")])).digest("hex");
}

// Explicit migration of one historical output, using only the public trust
// anchor. Dry-run by default; never re-sign, modify or delete the runtime.
export async function adoptSignedOpenVikingInstallation(installationRoot, expectedTreeSha256, apply = false) {
  if (!isAbsolute(installationRoot) || !/^signed-local-installation-[a-zA-Z0-9]+$/u.test(basename(installationRoot))
    || !/^[a-f0-9]{64}$/u.test(expectedTreeSha256) || await realpath(installationRoot) !== installationRoot) {
    throw new Error("Supply a canonical historical signed installation and exact tree identity.");
  }
  return withNativeArtifactLock(dirname(installationRoot), async () => {
    const metadata = await lstat(installationRoot);
    const marker = join(installationRoot, "native-artifact.json");
    try { await lstat(marker); throw new Error("Installation already has ownership metadata."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const runtime = join(installationRoot, "runtime");
    const tree = await runtimeTreeIdentity(runtime);
    if (tree.sha256 !== expectedTreeSha256) throw new Error("Historical runtime identity mismatch.");
    const trustedKey = openVikingRuntimeTrustedKey();
    const loaded = await loadOpenVikingRuntimeInstallation(installationRoot, new AbortController().signal);
    verifyOpenVikingManifest(loaded.manifest, loaded.signature, trustedKey, { platform: "darwin", arch: "arm64",
      pythonVersion: "3.12.10", openvikingVersion: "0.4.16", sdkVersion: "0.1.10", treeSha256: tree.sha256 });
    const receipt = JSON.parse(await readFile(join(installationRoot, "assembly-receipt.json"), "utf8"));
    if (receipt.schema !== "new-money.signed-local-installation.v1" || receipt.status !== "PASS"
      || receipt.installationRoot !== installationRoot || receipt.tree?.sha256 !== tree.sha256
      || receipt.manifestSha256 !== createHash("sha256").update(loaded.manifest).digest("hex")) {
      throw new Error("Historical assembly receipt does not match the verified installation.");
    }
    const purpose = await signingPurpose(runtime);
    const record = { schema: "new-money.native-artifact.v1", kind: "signed", purpose,
      key: signedArtifactKey(tree.sha256, trustedKey), status: "READY",
      createdAt: metadata.birthtime.toISOString(), adoptedAt: new Date().toISOString(), value: receipt };
    const after = await lstat(installationRoot);
    if (after.ino !== metadata.ino || after.dev !== metadata.dev || after.mtimeMs !== metadata.mtimeMs) {
      throw new Error("Historical installation changed during adoption.");
    }
    if (apply) await writeFile(marker, JSON.stringify(record, null, 2), { flag: "wx", mode: 0o600 });
    return { installationRoot, purpose, tree, signatureVerification: "SOURCE_PINNED_KEY_PASS", adopted: apply };
  });
}

/** Local validation artifact only. No download, activation, publication or source replacement. */
export async function signOpenVikingLocalInstallation(sourceRuntime, expectedTreeSha256, outputParent, privateKeyPath) {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Local signing requires macOS arm64.");
  if (![sourceRuntime, outputParent, privateKeyPath].every((path) => typeof path === "string" && isAbsolute(path) && !path.includes("\0"))
    || !/^[a-f0-9]{64}$/u.test(expectedTreeSha256)) throw new Error("Supply absolute paths and a verified tree identity.");
  const source = await realpath(sourceRuntime); const parent = await realpath(outputParent);
  if (parent === source || parent.startsWith(`${source}${sep}`)) throw new Error("Output must be outside the runtime.");
  const keyLocation = await realpath(privateKeyPath);
  if (keyLocation === source || keyLocation.startsWith(`${source}${sep}`)) throw new Error("Signing key must be outside the runtime.");
  const privateKey = await readSigningKey(privateKeyPath);
  const trustedKey = openVikingRuntimeTrustedKey();
  if (!createPublicKey(privateKey).export({ format: "der", type: "spki" })
    .equals(trustedKey.export({ format: "der", type: "spki" }))) throw new Error("Signing key does not match the source trust anchor.");
  if ((await runtimeTreeIdentity(source)).sha256 !== expectedTreeSha256) throw new Error("Source runtime identity mismatch.");
  const purpose = await signingPurpose(source);
  const key = signedArtifactKey(expectedTreeSha256, trustedKey);
  return runNativeArtifact({ parent, kind: "signed", purpose, key,
    build: installationRoot => buildSignedInstallation(source, expectedTreeSha256, installationRoot, privateKey, trustedKey),
    validate: async (installationRoot, receipt) => {
      if (receipt?.status !== "PASS" || receipt.installationRoot !== installationRoot
        || receipt.tree?.sha256 !== expectedTreeSha256) throw new Error("Invalid cached signing receipt.");
      const tree = await runtimeTreeIdentity(join(installationRoot, "runtime"));
      if (tree.sha256 !== expectedTreeSha256) throw new Error("Cached signed runtime changed.");
      const loaded = await loadOpenVikingRuntimeInstallation(installationRoot, new AbortController().signal);
      verifyOpenVikingManifest(loaded.manifest, loaded.signature, trustedKey, { platform: "darwin", arch: "arm64",
        pythonVersion: "3.12.10", openvikingVersion: "0.4.16", sdkVersion: "0.1.10", treeSha256: tree.sha256 });
      if (createHash("sha256").update(loaded.manifest).digest("hex") !== receipt.manifestSha256) {
        throw new Error("Cached signed manifest changed.");
      }
    }
  });
}

async function signingPurpose(source) {
  for (const [purpose, path] of [["team-index-v1", "newmoney-team/v1/team_index_worker.py"],
    ["team-query-v1", "newmoney-team/query/v1/team_query_worker.py"]]) {
    try { await lstat(join(source, path)); return purpose; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return "private";
}

async function buildSignedInstallation(source, expectedTreeSha256, installationRoot, privateKey, trustedKey) {
  const receipt = { schema: "new-money.signed-local-installation.v1", status: "INCOMPLETE", installationRoot,
    productionRelease: "NOT_PERFORMED", upstreamInterpreterProvenance: "UNVERIFIED", nativeLaunch: "NOT_RUN" };
  try {
    const runtimeRoot = join(installationRoot, "runtime");
    await cp(source, runtimeRoot, { recursive: true, verbatimSymlinks: true, force: false, errorOnExist: true });
    const tree = await runtimeTreeIdentity(runtimeRoot);
    if (tree.sha256 !== expectedTreeSha256) throw new Error("Copied runtime identity mismatch.");
    const identity = { platform: "darwin", arch: "arm64", pythonVersion: "3.12.10", openvikingVersion: "0.4.16",
      sdkVersion: "0.1.10", treeSha256: tree.sha256 };
    const manifest = Buffer.from(JSON.stringify({ schema: "new-money.openviking-runtime.v1", ...identity }));
    await writeFile(join(installationRoot, "manifest.json"), manifest, { flag: "wx", mode: 0o600 });
    await writeFile(join(installationRoot, "manifest.sig"), sign(null, manifest, privateKey), { flag: "wx", mode: 0o600 });
    const loaded = await loadOpenVikingRuntimeInstallation(installationRoot, new AbortController().signal);
    verifyOpenVikingManifest(loaded.manifest, loaded.signature, trustedKey, identity);
    receipt.tree = tree;
    receipt.manifestSha256 = createHash("sha256").update(loaded.manifest).digest("hex");
    receipt.signatureVerification = "SOURCE_PINNED_KEY_PASS";
    receipt.status = "PASS";
    return receipt;
  } catch {
    receipt.status = "FAILED";
    throw new Error("Local signed assembly failed; diagnostic output is retained.");
  } finally {
    await writeFile(join(installationRoot, "assembly-receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
  }
}

async function readSigningKey(path) {
  const directory = await lstat(dirname(path));
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid()
    || (directory.mode & 0o077) !== 0) throw new Error("Signing directory is not owner-private.");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.uid !== process.getuid() || (before.mode & 0o077) !== 0
      || before.size < 1 || before.size > 4096) throw new Error("Invalid signing key file.");
    const bytes = Buffer.alloc(before.size + 1);
    try {
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      const after = await handle.stat();
      if (bytesRead !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs
        || before.ctimeMs !== after.ctimeMs) throw new Error("Signing key changed while reading.");
      const key = createPrivateKey(bytes.subarray(0, bytesRead));
      if (key.asymmetricKeyType !== "ed25519") throw new Error("Expected Ed25519 signing key.");
      return key;
    } finally { bytes.fill(0); }
  } finally { await handle.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === "--adopt") {
      if (args.length !== 3 && !(args.length === 4 && args[3] === "--apply")) throw new Error("Invalid adoption arguments.");
      console.log(JSON.stringify(await adoptSignedOpenVikingInstallation(args[1], args[2], args[3] === "--apply"), null, 2));
    } else console.log(JSON.stringify(await signOpenVikingLocalInstallation(...args), null, 2));
  }
  catch { console.error("Local runtime signing failed; no private key material is logged."); process.exitCode = 1; }
}
