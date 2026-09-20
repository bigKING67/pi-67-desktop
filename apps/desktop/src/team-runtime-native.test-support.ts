import { generateKeyPairSync, sign } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createInstalledLocalMemory } from "./installed-local-memory.js";
import { installOpenVikingRuntime } from "./openviking-runtime-installer.js";
import { runtimeTreeIdentity } from "./openviking-runtime-tree.mjs";

/** Full real runtime copies, ephemeral test trust only. Never reads operator keys
 * or installs into a user profile. Caller owns the exclusive temporary directory. */
export async function installNativeTeamFixture(python: string, temporary: string, signal: AbortSignal,
  bootstrapDirectory = fileURLToPath(new URL("../../../eng/capabilities/openviking-runtime/", import.meta.url))) {
  const source = join(temporary, "runtime-source"), parent = join(temporary, "runtimes");
  const runtime = join(source, "runtime"), original = dirname(dirname(python));
  const originalTree = await runtimeTreeIdentity(original, signal);
  await mkdir(source, { mode: 0o700 }); await mkdir(parent, { mode: 0o700 });
  await cp(original, runtime, { recursive: true, verbatimSymlinks: true, force: false,
    errorOnExist: true, mode: constants.COPYFILE_FICLONE,
    filter: () => { signal.throwIfAborted(); return true; } });
  assert.deepEqual(await runtimeTreeIdentity(runtime, signal), originalTree);
  for (const [revision, names] of [
    ["v1", ["team_index_worker.py", "team_model_transport.py", "team_model_channel.py"]],
    ["query/v1", ["team_query_worker.py"]]
  ] as const) {
    const target = join(runtime, "newmoney-team", revision);
    await mkdir(target, { recursive: true, mode: 0o700 });
    for (const name of names) {
      // Only this newly copied test tree is updated to current source bootstrap.
      await copyFile(join(bootstrapDirectory, name), join(target, name));
    }
  }
  const tree = await runtimeTreeIdentity(runtime, signal);
  const keys = generateKeyPairSync("ed25519");
  const manifest = Buffer.from(JSON.stringify({ schema: "new-money.openviking-runtime.v1", platform: "darwin",
    arch: "arm64", pythonVersion: "3.12.10", openvikingVersion: "0.4.16", sdkVersion: "0.1.10", treeSha256: tree.sha256 }));
  await writeFile(join(source, "manifest.json"), manifest, { flag: "wx", mode: 0o600 });
  const signature = sign(null, manifest, keys.privateKey);
  await writeFile(join(source, "manifest.sig"), signature, { flag: "wx", mode: 0o600 });
  const options = { source, parent, signal, trustedKey: keys.publicKey };
  const index = await installOpenVikingRuntime({ ...options, purpose: "team-index-v1" });
  const query = await installOpenVikingRuntime({ ...options, purpose: "team-query-v1" });
  assert.equal(index.activated, false); assert.equal(query.activated, false);
  assert.deepEqual(index.tree, tree); assert.deepEqual(query.tree, tree);
  const installed = createInstalledLocalMemory({ memoryRoot: temporary,
    installationRoot: join(parent, "private-not-installed"), teamInstallationRoot: index.installationRoot,
    queryInstallationRoot: query.installationRoot, trustedKey: keys.publicKey,
    encryption: { isAvailable: () => false, encrypt() { throw new Error("No private settings writes"); },
      decrypt() { throw new Error("No private settings reads"); } },
    models: { async resolve() { throw new Error("No private provider access"); } }
  });
  return { ...installed, async assertUnchanged(checkSignal = signal) {
    assert.deepEqual(await runtimeTreeIdentity(original, checkSignal), originalTree);
    for (const installation of [index, query]) {
      assert.deepEqual(await runtimeTreeIdentity(join(installation.installationRoot, "runtime"), checkSignal), tree);
      assert.deepEqual(await readFile(join(installation.installationRoot, "manifest.json")), manifest);
      assert.deepEqual(await readFile(join(installation.installationRoot, "manifest.sig")), signature);
    }
    console.info("Ephemeral signed native index/query verified", { tree, originalTree, productionTrust: "UNVERIFIED" });
  } };
}
