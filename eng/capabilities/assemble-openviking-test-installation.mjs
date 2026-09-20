import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { cp, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { runtimeTreeIdentity } from "../../apps/desktop/src/openviking-runtime-tree.mts";
import { verifyOpenVikingManifest } from "../../apps/desktop/src/openviking-runtime-manifest.mts";
import { loadOpenVikingRuntimeInstallation } from "../../apps/desktop/src/openviking-runtime-installation.ts";

/** Development-only assembly proof. Never produces a production trust identity. */
export async function assembleOpenVikingTestInstallation(sourceRuntime, expectedTreeSha256, outputParent) {
  if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Test assembly requires macOS arm64.");
  if (!/^[a-f0-9]{64}$/u.test(expectedTreeSha256)) throw new Error("Supply the previously verified runtime tree identity.");
  const source = await realpath(sourceRuntime);
  const parent = await realpath(outputParent);
  if (parent === source || parent.startsWith(`${source}${sep}`)) throw new Error("Assembly output must be outside the source runtime.");
  const before = await runtimeTreeIdentity(sourceRuntime);
  if (before.sha256 !== expectedTreeSha256) throw new Error("Source runtime differs from the verified tree.");
  const installationRoot = await mkdtemp(join(parent, "test-installation-"));
  const receiptPath = join(installationRoot, "assembly-receipt.json");
  const receipt = { schema: "new-money.test-installation-assembly.v1", installationRoot,
    signatureVerification: "EPHEMERAL_TEST_KEY_ONLY", productionAdmission: "UNVERIFIED", status: "INCOMPLETE" };
  try {
    const runtimeRoot = join(installationRoot, "runtime");
    await cp(source, runtimeRoot, { recursive: true, verbatimSymlinks: true, force: false, errorOnExist: true });
    const copied = await runtimeTreeIdentity(runtimeRoot);
    if (copied.sha256 !== expectedTreeSha256) throw new Error("Copied runtime differs from the verified tree.");
    const identity = { platform: "darwin", arch: "arm64", pythonVersion: "3.12.10",
      openvikingVersion: "0.4.16", sdkVersion: "0.1.10", treeSha256: copied.sha256 };
    const manifest = Buffer.from(JSON.stringify({ schema: "new-money.openviking-runtime.v1", ...identity }));
    const testKey = generateKeyPairSync("ed25519");
    const signature = sign(null, manifest, testKey.privateKey);
    await writeFile(join(installationRoot, "manifest.json"), manifest, { flag: "wx", mode: 0o600 });
    await writeFile(join(installationRoot, "manifest.sig"), signature, { flag: "wx", mode: 0o600 });
    const loaded = await loadOpenVikingRuntimeInstallation(installationRoot, new AbortController().signal);
    verifyOpenVikingManifest(loaded.manifest, loaded.signature, testKey.publicKey, identity);
    // Private/public test keys are not stored in the installation or application.
    receipt.tree = copied;
    receipt.manifestSha256 = createHash("sha256").update(loaded.manifest).digest("hex");
    receipt.status = "PASS";
    return { ...receipt, receiptPath, python: join(runtimeRoot, "bin/python3.12") };
  } catch (error) {
    receipt.status = "FAILED";
    throw error;
  } finally { await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 }); }
}
